"""Input/output schema registry and validation."""
from typing import Any, Dict, Optional
import structlog
from fastapi import HTTPException

logger = structlog.get_logger(__name__)


def validate_against_schema(data: Dict[str, Any], schema: Dict[str, Any]) -> list[str]:
    """Validate dict against a simple field-type schema. Returns list of error messages."""
    errors = []
    required = schema.get("required", [])
    properties = schema.get("properties", {})

    for field in required:
        if field not in data:
            errors.append(f"Required field '{field}' is missing")

    for field, spec in properties.items():
        if field not in data:
            continue
        value = data[field]
        expected_type = spec.get("type")
        if expected_type == "number" and not isinstance(value, (int, float)):
            errors.append(f"Field '{field}' expected number, got {type(value).__name__}")
        elif expected_type == "string" and not isinstance(value, str):
            errors.append(f"Field '{field}' expected string, got {type(value).__name__}")
        elif expected_type == "boolean" and not isinstance(value, bool):
            errors.append(f"Field '{field}' expected boolean, got {type(value).__name__}")
        if "minimum" in spec and isinstance(value, (int, float)):
            if value < spec["minimum"]:
                errors.append(f"Field '{field}' value {value} < minimum {spec['minimum']}")
        if "maximum" in spec and isinstance(value, (int, float)):
            if value > spec["maximum"]:
                errors.append(f"Field '{field}' value {value} > maximum {spec['maximum']}")

    return errors
