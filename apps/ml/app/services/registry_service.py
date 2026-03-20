"""
Dynamic trainer discovery and registration.

Scans TRAINER_PLUGIN_DIR for Python files, imports them, and finds
classes that inherit from BaseTrainer. Persists registrations in MongoDB.
"""
import hashlib
import importlib.util
import inspect
import sys
from pathlib import Path
from typing import Dict, Optional, Type

import structlog

from app.abstract.base_trainer import BaseTrainer
from app.core.config import settings
from app.models.trainer_registration import TrainerRegistration
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)

# In-process registry: trainer_name -> class
_TRAINER_CLASSES: Dict[str, Type[BaseTrainer]] = {}

# Metadata header keys recognized from file comments
_METADATA_KEYS = {
    "name": "Name",
    "version": "Version",
    "author": "Author",
    "author email": "Author Email",
    "author url": "Author URL",
    "git": "Git",
    "description": "Description",
    "commercial": "Commercial",
    "downloadable": "Downloadable",
    "protect model": "Protect Model",
    "icon": "Icon",
    "license": "License",
    "tags": "Tags",
}


def _parse_metadata_header(source: str) -> Dict[str, str]:
    """
    Read lines from top of file that start with '#' and parse 'Key: Value' format.
    Stops when a line doesn't start with '#'.
    Returns a dict with normalized keys matching _METADATA_KEYS values.
    """
    metadata: Dict[str, str] = {}
    for line in source.splitlines():
        stripped = line.strip()
        if not stripped.startswith("#"):
            break
        content = stripped.lstrip("#").strip()
        if ":" not in content:
            continue
        raw_key, _, value = content.partition(":")
        normalized = raw_key.strip().lower()
        if normalized in _METADATA_KEYS:
            metadata[_METADATA_KEYS[normalized]] = value.strip()
    return metadata


def _compute_file_hash(org_id: str, file_bytes: bytes) -> str:
    """SHA-256 hash namespaced by org_id."""
    return hashlib.sha256((org_id or "system").encode() + b":" + file_bytes).hexdigest()


def register_class(cls: Type[BaseTrainer], plugin_file: str = "") -> None:
    """Register a trainer class in-process."""
    name = cls.trainer_name()
    _TRAINER_CLASSES[name] = cls
    logger.info("trainer_class_registered", name=name, class_path=f"{cls.__module__}.{cls.__name__}")


def get_trainer_class(name: str) -> Optional[Type[BaseTrainer]]:
    return _TRAINER_CLASSES.get(name)


def list_trainer_classes() -> Dict[str, Type[BaseTrainer]]:
    return dict(_TRAINER_CLASSES)


def _load_module_from_file(path: Path) -> list[Type[BaseTrainer]]:
    """Import a .py file and return all BaseTrainer subclasses found in it."""
    module_name = f"ml_plugin_{path.stem}"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        return []
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)  # type: ignore[union-attr]
    except Exception as exc:
        logger.error("trainer_plugin_load_failed", file=str(path), error=str(exc))
        return []

    found = []
    for _, obj in inspect.getmembers(module, inspect.isclass):
        if not (issubclass(obj, BaseTrainer) and obj is not BaseTrainer and hasattr(obj, "name")):
            continue
        ds = getattr(obj, "data_source", None)
        if ds is not None and not hasattr(ds, "describe"):
            logger.error(
                "trainer_plugin_invalid_data_source",
                file=str(path),
                trainer=getattr(obj, "name", repr(obj)),
                data_source=repr(ds),
                hint="data_source must be a DataSource instance (e.g. DatasetDataSource(...)), not a string",
            )
            continue
        found.append(obj)
    return found


async def scan_and_register_plugins(owner_email: Optional[str] = None, org_id: Optional[str] = None) -> int:
    """Scan plugin directory, load trainer classes, sync to DB. Returns count registered.

    owner_email: if set, new registrations are attributed to this user (user-uploaded plugins).
                 System scans (no user) leave owner_email=None (visible to all engineers).
    org_id: if set, datasets are created under this org so they appear on the user's Datasets page.
            System scans (no user) leave org_id=None → datasets created with org_id="" (shared).
    """
    plugin_dir = Path(settings.TRAINER_PLUGIN_DIR)
    if not plugin_dir.exists():
        plugin_dir.mkdir(parents=True, exist_ok=True)
        logger.info("trainer_plugin_dir_created", path=str(plugin_dir))
        return 0

    count = 0
    for py_file in sorted(plugin_dir.glob("*.py")):
        if py_file.name.startswith("_"):
            continue
        try:
            classes = _load_module_from_file(py_file)
        except Exception as exc:
            logger.error("trainer_plugin_scan_failed", file=str(py_file), error=str(exc))
            continue
        try:
            file_bytes = py_file.read_bytes()
            file_source = file_bytes.decode("utf-8", errors="replace")
            file_metadata = _parse_metadata_header(file_source)
        except Exception:
            file_bytes = b""
            file_metadata = {}
        for cls in classes:
            try:
                register_class(cls, plugin_file=str(py_file))
                await _upsert_db_registration(
                    cls, str(py_file),
                    owner_email=owner_email,
                    org_id=org_id,
                    metadata=file_metadata,
                    file_bytes=file_bytes,
                )
                await _ensure_trainer_datasets(cls, org_id=org_id)
            except Exception as exc:
                logger.error("trainer_plugin_register_failed", file=str(py_file),
                             trainer=getattr(cls, "name", repr(cls)), error=str(exc))
                continue
            # Warn if any declared requirements aren't importable
            for req in getattr(cls, "requirements", []):
                pkg = req.split(">=")[0].split("==")[0].split("[")[0].strip()
                try:
                    importlib.util.find_spec(pkg.replace("-", "_"))
                except Exception:
                    logger.warning(
                        "trainer_missing_requirement",
                        trainer=cls.trainer_name(),
                        package=pkg,
                    )
            count += 1

    logger.info("trainer_plugins_scanned", count=count, dir=str(plugin_dir))
    return count


async def _ensure_trainer_datasets(cls: Type[BaseTrainer], org_id: Optional[str] = None) -> None:
    """Auto-create any datasets declared with auto_create_spec on the trainer's DatasetDataSource.

    org_id: the acting user's org. When provided, the dataset is created under this org so it
            appears on their Datasets page. System scans pass None → org_id="" (shared).
    """
    try:
        from app.abstract.data_source import DatasetDataSource
    except ImportError:
        return

    ds = getattr(cls, "data_source", None)
    if not isinstance(ds, DatasetDataSource):
        return
    if not ds.slug or not ds.auto_create_spec:
        return

    # Determine the org to scope the dataset to
    effective_org = org_id or ""

    try:
        from motor.motor_asyncio import AsyncIOMotorClient
        from app.core.config import settings as _s

        client = AsyncIOMotorClient(_s.MONGODB_URL)
        db = client[_s.MONGODB_DATABASE]
        try:
            # Look for this org's copy first; fall back to checking system dataset (org_id="")
            profile = await db["dataset_profiles"].find_one(
                {"slug": ds.slug, "org_id": {"$in": [effective_org, ""]}, "deleted_at": None}
            )
            if not profile:
                # Create a new dataset scoped to this org (visible on their Datasets page)
                await ds._auto_create_dataset(db, ds.slug, effective_org)
                logger.info(
                    "trainer_dataset_auto_created",
                    slug=ds.slug,
                    trainer=cls.trainer_name(),
                    org_id=effective_org,
                )
            elif not profile.get("fields"):
                # Dataset exists but has no fields — patch from auto_create_spec
                new_fields = ds._build_fields_from_spec()
                if new_fields:
                    from app.utils.datetime import utc_now as _utc_now
                    await db["dataset_profiles"].update_one(
                        {"_id": profile["_id"]},
                        {"$set": {"fields": new_fields, "updated_at": _utc_now()}},
                    )
                    logger.info(
                        "trainer_dataset_fields_patched",
                        slug=ds.slug,
                        trainer=cls.trainer_name(),
                        field_count=len(new_fields),
                    )
            elif effective_org and str(profile.get("org_id", "")) != effective_org:
                # A system dataset exists (org_id="") but this org has none yet — create their copy
                org_profile = await db["dataset_profiles"].find_one(
                    {"slug": ds.slug, "org_id": effective_org, "deleted_at": None}
                )
                if not org_profile:
                    await ds._auto_create_dataset(db, ds.slug, effective_org)
                    logger.info(
                        "trainer_dataset_org_copy_created",
                        slug=ds.slug,
                        trainer=cls.trainer_name(),
                        org_id=effective_org,
                    )
        finally:
            client.close()
    except Exception as exc:
        logger.warning(
            "trainer_dataset_auto_create_failed",
            slug=getattr(ds, "slug", None),
            error=str(exc),
        )


async def _upsert_db_registration(
    cls: Type[BaseTrainer],
    plugin_file: str,
    owner_email: Optional[str] = None,
    org_id: Optional[str] = None,
    metadata: Optional[Dict[str, str]] = None,
    file_bytes: Optional[bytes] = None,
) -> None:
    metadata = metadata or {}
    name = cls.trainer_name()
    effective_org = org_id or ""
    namespace = effective_org if effective_org else "system"
    full_name = f"{namespace}/{name}"

    # Compute a short human-readable alias for the inference URL
    if not effective_org:
        alias = name  # system trainer: /inference/iris_classifier
    elif owner_email:
        prefix = owner_email.split("@")[0].lower().replace(".", "_")
        alias = f"{prefix}/{name}"  # user trainer: /inference/john/my_model
    else:
        alias = f"{effective_org[:8]}/{name}"

    # Compute file hash for change detection
    new_hash = _compute_file_hash(effective_org, file_bytes or b"")

    existing = await TrainerRegistration.find_one(TrainerRegistration.name == name)
    now = utc_now()
    info = cls.to_dict()

    # Map metadata header fields to model fields
    meta_fields: dict = {}
    if metadata.get("Author"):
        meta_fields["author"] = metadata["Author"]
    if metadata.get("Author Email"):
        meta_fields["author_email"] = metadata["Author Email"]
    if metadata.get("Author URL"):
        meta_fields["author_url"] = metadata["Author URL"]
    if metadata.get("Git"):
        meta_fields["git_url"] = metadata["Git"]
    if metadata.get("Commercial"):
        meta_fields["commercial"] = metadata["Commercial"].lower()
    if metadata.get("Downloadable"):
        meta_fields["downloadable"] = metadata["Downloadable"].lower() in ("true", "yes", "1")
    if metadata.get("Protect Model"):
        meta_fields["protect_model"] = metadata["Protect Model"].lower() in ("true", "yes", "1")
    if metadata.get("Icon"):
        meta_fields["icon_url"] = metadata["Icon"]
    if metadata.get("License"):
        meta_fields["license"] = metadata["License"]

    if existing:
        # Hash check: if file changed, mark as pending_review and deactivate
        approval_status = existing.approval_status
        is_active = True
        if file_bytes is not None and existing.submission_hash and existing.submission_hash != new_hash:
            approval_status = "pending_review"
            is_active = False

        update: dict = {
            "version": info["version"],
            "description": info["description"],
            "framework": info["framework"],
            "schedule": info["schedule"],
            "data_source_info": info["data_source"],
            "class_path": f"{cls.__module__}.{cls.__name__}",
            "plugin_file": plugin_file,
            "tags": info["tags"],
            "output_display": info.get("output_display", []),
            "derived_metrics": info.get("derived_metrics", []),
            "namespace": namespace,
            "full_name": full_name,
            "alias": alias,
            "submission_hash": new_hash,
            "approval_status": approval_status,
            "is_active": is_active,
            "updated_at": now,
            **meta_fields,
        }
        # When a user explicitly uploads, stamp ownership so it appears in their list
        if owner_email:
            update["owner_email"] = owner_email
        if org_id:
            update["org_id"] = org_id
        await existing.set(update)
    else:
        reg = TrainerRegistration(
            name=name,
            version=info["version"],
            description=info["description"],
            framework=info["framework"],
            schedule=info["schedule"],
            data_source_info=info["data_source"],
            class_path=f"{cls.__module__}.{cls.__name__}",
            plugin_file=plugin_file,
            tags=info["tags"],
            output_display=info.get("output_display", []),
            derived_metrics=info.get("derived_metrics", []),
            owner_email=owner_email,
            org_id=effective_org,
            namespace=namespace,
            full_name=full_name,
            alias=alias,
            submission_hash=new_hash,
            approval_status="approved",
            **meta_fields,
        )
        await reg.insert()
