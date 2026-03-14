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


async def scan_and_register_plugins(owner_email: Optional[str] = None) -> int:
    """Scan plugin directory, load trainer classes, sync to DB. Returns count registered.

    owner_email: if set, new registrations are attributed to this user (user-uploaded plugins).
                 System scans (no user) leave owner_email=None (visible to all engineers).
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
            await _upsert_db_registration(cls, str(py_file), owner_email=owner_email)
            count += 1

    logger.info("trainer_plugins_scanned", count=count, dir=str(plugin_dir))
    return count


async def _upsert_db_registration(cls: Type[BaseTrainer], plugin_file: str, owner_email: Optional[str] = None) -> None:
    name = cls.trainer_name()
    existing = await TrainerRegistration.find_one(TrainerRegistration.name == name)
    now = utc_now()
    info = cls.to_dict()
    if existing:
        await existing.set({
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
        })
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
        )
        await reg.insert()
