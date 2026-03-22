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


def _load_module_from_file(path: Path, org_id: str = "") -> list[Type[BaseTrainer]]:
    """Import a .py file and return all BaseTrainer subclasses found in it."""
    # Include org_id in the module name so trainers from different orgs with
    # the same filename don't collide in sys.modules.
    org_prefix = f"_{org_id}" if org_id else ""
    module_name = f"ml_plugin{org_prefix}_{path.stem}"
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


async def _request_package_install(trainer_name: str, packages: list, owner_email: str, org_id: str) -> None:
    """Create an AdminTicket requesting admin approval to install missing packages."""
    try:
        from app.models.admin_ticket import AdminTicket
        # Avoid duplicate open tickets for the same trainer + package set
        existing = await AdminTicket.find_one({
            "category": "package_install_request",
            "related_id": trainer_name,
            "status": {"$in": ["open", "reviewing"]},
        })
        if existing:
            return
        ticket = AdminTicket(
            category="package_install_request",
            title=f"Package install required: {trainer_name}",
            body=(
                f"Trainer **{trainer_name}** declares the following pip packages that are not "
                f"installed in the environment:\n\n"
                + "\n".join(f"- `{p}`" for p in packages)
                + "\n\nApprove to install them in the background."
            ),
            related_id=trainer_name,
            org_id=org_id,
            owner_email=owner_email,
            severity="medium",
            status="open",
            metadata={
                "trainer_name": trainer_name,
                "packages": packages,
                "install_result": None,
            },
        )
        await ticket.insert()
        logger.info(
            "package_install_ticket_created",
            trainer=trainer_name,
            packages=packages,
        )
    except Exception as exc:
        logger.warning("package_install_ticket_create_failed", trainer=trainer_name, error=str(exc))


async def scan_and_register_plugins(
    owner_email: Optional[str] = None,
    org_id: Optional[str] = None,
    only_file: Optional[Path] = None,
    first_run: bool = False,
) -> int:
    """Scan plugin directory, load trainer classes, sync to DB. Returns count registered.

    owner_email: if set, new registrations are attributed to this user (user-uploaded plugins).
                 System scans (no user) leave owner_email=None (visible to all engineers).
    org_id: if set, datasets are created under this org so they appear on the user's Datasets page.
            System scans (no user) leave org_id=None → datasets created with org_id="" (shared).
    only_file: if set, only process this single file (used when user saves a specific trainer).
    first_run: if True, process all files in the directory (used on first startup).
               If False and only_file is None, only process files already registered in the DB.
    """
    from app.models.trainer_registration import TrainerRegistration

    plugin_dir = Path(settings.TRAINER_PLUGIN_DIR)
    if not plugin_dir.exists():
        plugin_dir.mkdir(parents=True, exist_ok=True)
        logger.info("trainer_plugin_dir_created", path=str(plugin_dir))
        return 0

    # global_sample/ holds platform-provided public templates.
    # Always scan it on every startup so new templates added to the image are picked up.
    global_sample_dir = plugin_dir / "global_sample"
    if global_sample_dir.exists():
        for py_file in sorted(global_sample_dir.rglob("*.py")):
            if py_file.name.startswith("_"):
                continue
            try:
                classes = _load_module_from_file(py_file, org_id="")
            except Exception as exc:
                logger.error("global_sample_scan_failed", file=str(py_file), error=str(exc))
                continue
            try:
                file_bytes = py_file.read_bytes()
                file_source = file_bytes.decode("utf-8", errors="replace")
                file_metadata = _parse_metadata_header(file_source)
            except Exception:
                file_bytes = None
                file_metadata = {}
            for cls in classes:
                try:
                    register_class(cls, plugin_file=str(py_file))
                    await _upsert_db_registration(
                        cls, str(py_file),
                        owner_email=None,
                        org_id=None,  # org_id="" → public
                        metadata=file_metadata,
                        file_bytes=file_bytes,
                    )
                except Exception as exc:
                    logger.error("global_sample_register_failed", file=str(py_file), cls=cls.__name__, error=str(exc))

    # Build the set of files to process for the regular scan
    if only_file is not None:
        # Targeted registration: only the file the user just saved/uploaded
        candidate_files = [only_file] if only_file.exists() else []
    elif first_run:
        # First ever startup: register org trainers from running/ only.
        # Public trainers are always handled by the global_sample/ scan above.
        running_dir = plugin_dir / "running"
        if running_dir.exists():
            candidate_files = sorted(running_dir.rglob("*.py"))
        else:
            candidate_files = []
    else:
        # Normal startup: only re-register files already known to DB
        registered_paths = {
            r.plugin_file
            async for r in TrainerRegistration.find(TrainerRegistration.plugin_file != None)  # noqa: E711
        }
        candidate_files = [
            Path(p) for p in registered_paths
            if p and Path(p).exists()
        ]

    count = 0
    for py_file in candidate_files:
        if py_file.name.startswith("_"):
            continue
        try:
            classes = _load_module_from_file(py_file, org_id=org_id or "")
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
            # Check declared requirements; create an AdminTicket for missing packages
            missing_pkgs = []
            for req in getattr(cls, "requirements", []):
                pkg = req.split(">=")[0].split("==")[0].split("[")[0].strip()
                try:
                    found = importlib.util.find_spec(pkg.replace("-", "_"))
                    if found is None:
                        missing_pkgs.append(req)
                except Exception:
                    missing_pkgs.append(req)
            if missing_pkgs:
                await _request_package_install(cls.trainer_name(), missing_pkgs, owner_email or "", org_id or "")
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
            # Look for THIS org's copy only — never share the public (org_id="") dataset,
            # because entries uploaded by the user must be scoped to their org.
            profile = await db["dataset_profiles"].find_one(
                {"slug": ds.slug, "org_id": effective_org, "deleted_at": None}
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

    # Public = system/global_sample trainers (org_id=""), private = org-owned
    _visibility = "private" if effective_org else "public"

    # Derive plugin version and base_name from the trainer name.
    # Names ending in _vN (e.g. image_cosine_similarity_v2) are plugin version N.
    # The base file (no suffix) is plugin version 0.
    import re as _re
    _m = _re.search(r'_v(\d+)$', name)
    _plugin_version = int(_m.group(1)) if _m else 0
    _base_name = name[:_m.start()] if _m else name

    # Compute a short human-readable alias: prefer org slug, fall back to email prefix
    if not effective_org:
        alias = name  # system trainer: /inference/iris_classifier
    else:
        from app.models.org_config import OrgConfig
        org_cfg = await OrgConfig.find_one(OrgConfig.org_id == effective_org)
        org_slug = org_cfg.slug if org_cfg and org_cfg.slug else None
        if org_slug:
            alias = f"{org_slug}/{name}"
        elif owner_email:
            prefix = owner_email.split("@")[0].lower().replace(".", "_")
            alias = f"{prefix}/{name}"
        else:
            alias = f"{effective_org[:8]}/{name}"

    # Compute file hash for change detection
    new_hash = _compute_file_hash(effective_org, file_bytes or b"")

    existing = await TrainerRegistration.find_one(
        TrainerRegistration.name == name,
        TrainerRegistration.org_id == (effective_org or ""),
    )
    now = utc_now()
    info = cls.to_dict()

    if existing and file_bytes is not None and existing.submission_hash == new_hash:
        _approved_statuses = ("approved",)
        if existing.approval_status in _approved_statuses and existing.is_active:
            # File unchanged and already approved — skip DB write, class already loaded in memory.
            logger.debug(
                "trainer_scan_skipped_no_changes",
                trainer=name,
                hash=new_hash[:12],
            )
            return

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
        # System trainers (org_id="") are platform-managed — always trusted.
        # Never lock them into pending_review on rescan; auto-repair if stuck.
        is_system_trainer = not effective_org
        # Clones of public trainers are trusted — never require re-review on rescan
        is_public_clone = getattr(existing, "cloned_from_org_id", None) == ""
        approval_status = existing.approval_status
        is_active = True
        if is_system_trainer or is_public_clone:
            # Repair: if a previous scan accidentally flagged a trusted trainer, reset it.
            if approval_status in ("pending_review", "pending_admin", "flagged"):
                approval_status = "approved"
        elif file_bytes is not None and existing.submission_hash and existing.submission_hash != new_hash:
            # Org trainer whose file changed since last approval → require re-review
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
            "plugin_version": _plugin_version,
            "base_name": _base_name,
            "visibility": _visibility,
            **meta_fields,
        }
        # When a user explicitly uploads, stamp ownership so it appears in their list
        if owner_email:
            update["owner_email"] = owner_email
        if org_id:
            update["org_id"] = org_id
        # Preserve org-owned namespace/alias during a system-wide scan (no org context).
        # Without this, every app restart and every code-save strips the org slug from
        # user trainers, making them appear as system trainers in integration/API docs.
        is_system_scan = not effective_org
        existing_is_org_owned = existing.namespace and existing.namespace not in ("system", "")
        if is_system_scan and existing_is_org_owned:
            update.pop("namespace", None)
            update.pop("full_name", None)
            update.pop("alias", None)
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
            plugin_version=_plugin_version,
            base_name=_base_name,
            visibility=_visibility,
            **meta_fields,
        )
        await reg.insert()
