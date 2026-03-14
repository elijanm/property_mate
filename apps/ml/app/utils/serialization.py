"""Helpers for serializing Beanie Documents to JSON-safe dicts."""
from beanie import Document


def doc_to_dict(doc: Document) -> dict:
    """Convert a Beanie Document to a dict with id serialized as a plain string."""
    d = doc.model_dump()
    d["id"] = str(doc.id)
    return d
