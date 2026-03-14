from typing import Optional

from beanie import PydanticObjectId


def safe_oid(id_str: str) -> Optional[PydanticObjectId]:
    """Safely convert a string to PydanticObjectId; returns None if invalid."""
    try:
        return PydanticObjectId(id_str) if id_str else None
    except Exception:
        return None
