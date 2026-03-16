"""
Dynamic trainer discovery and registration.

Scans TRAINER_PLUGIN_DIR for Python files, imports them, and finds
classes that inherit from BaseTrainer. Persists registrations in MongoDB.
"""
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
        if (
            issubclass(obj, BaseTrainer)
            and obj is not BaseTrainer
            and hasattr(obj, "name")
            and hasattr(obj, "data_source")
        ):
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
        classes = _load_module_from_file(py_file)
        for cls in classes:
            register_class(cls, plugin_file=str(py_file))
            await _upsert_db_registration(cls, str(py_file), owner_email=owner_email, org_id=org_id)
            await _ensure_trainer_datasets(cls, org_id=org_id)
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
) -> None:
    name = cls.trainer_name()
    existing = await TrainerRegistration.find_one(TrainerRegistration.name == name)
    now = utc_now()
    info = cls.to_dict()
    if existing:
        update: dict = {
            "version": info["version"],
            "description": info["description"],
            "framework": info["framework"],
            "schedule": info["schedule"],
            "data_source_info": info["data_source"],
            "class_path": f"{cls.__module__}.{cls.__name__}",
            "plugin_file": plugin_file,
            "tags": info["tags"],
            "is_active": True,
            "updated_at": now,
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
            owner_email=owner_email,
            org_id=org_id or "",
        )
        await reg.insert()
