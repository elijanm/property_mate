"""
Trainer Marketplace API.

Exposes publicly approved trainers and allows cloning into own org namespace.
"""
from __future__ import annotations

import copy
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from beanie.operators import In

from app.dependencies.auth import get_current_user, require_roles
from app.models.ml_user import MLUser
from app.models.trainer_registration import TrainerRegistration
from app.utils.datetime import utc_now

router = APIRouter(tags=["marketplace"])


def _trainer_dict(t: TrainerRegistration) -> dict:
    return {
        "id": str(t.id),
        "name": t.name,
        "full_name": t.full_name,
        "namespace": t.namespace,
        "version": t.version,
        "description": t.description,
        "framework": t.framework,
        "tags": t.tags,
        "author": t.author,
        "author_email": t.author_email,
        "author_url": t.author_url,
        "git_url": t.git_url,
        "commercial": t.commercial,
        "downloadable": t.downloadable,
        "protect_model": t.protect_model,
        "icon_url": t.icon_url,
        "license": t.license,
        "clone_depth": t.clone_depth,
        "parent_trainer_id": t.parent_trainer_id,
        "approval_status": t.approval_status,
        "is_active": t.is_active,
        "org_id": t.org_id,
        "owner_email": t.owner_email,
        "registered_at": t.registered_at.isoformat() if t.registered_at else None,
    }


@router.get("/marketplace/trainers")
async def list_marketplace_trainers(
    current_user: MLUser = Depends(get_current_user),
    search: Optional[str] = Query(None),
    tags: Optional[str] = Query(None, description="Comma-separated tag keys"),
    category: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """
    List all public, approved, active trainers available in the marketplace.
    Includes built-in system trainers and user-published trainers.
    """
    skip = (page - 1) * page_size

    filters = [
        TrainerRegistration.commercial == "public",
        TrainerRegistration.approval_status == "approved",
        TrainerRegistration.is_active == True,
    ]

    all_trainers = await TrainerRegistration.find(*filters).to_list()

    # Apply text search filter
    if search:
        search_lower = search.lower()
        all_trainers = [
            t for t in all_trainers
            if search_lower in t.name.lower()
            or search_lower in t.description.lower()
            or search_lower in t.author.lower()
            or any(search_lower in v.lower() for v in t.tags.values())
        ]

    # Apply tags filter
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
        all_trainers = [
            t for t in all_trainers
            if any(k in t.tags for k in tag_list)
        ]

    # Apply category filter (mapped from framework or tags)
    if category:
        all_trainers = [
            t for t in all_trainers
            if t.framework.lower() == category.lower()
            or category.lower() in t.tags.get("category", "").lower()
        ]

    total = len(all_trainers)
    paginated = all_trainers[skip: skip + page_size]

    return {"items": [_trainer_dict(t) for t in paginated], "total": total}


@router.post("/marketplace/trainers/{trainer_id}/clone")
async def clone_trainer(
    trainer_id: str,
    current_user: MLUser = Depends(get_current_user),
):
    """
    Clone a marketplace trainer into the current user's org namespace.
    Creates a new TrainerRegistration with the org_id and namespace set to the user's org.
    Does not copy the actual plugin file if protect_model is True.
    """
    source = await TrainerRegistration.get(trainer_id)
    if not source:
        raise HTTPException(status_code=404, detail="Trainer not found")

    if source.approval_status != "approved" or not source.is_active:
        raise HTTPException(status_code=400, detail="Trainer is not available for cloning")

    if source.commercial != "public":
        raise HTTPException(status_code=403, detail="This trainer is not publicly cloneable")

    org_id = current_user.org_id or ""
    namespace = org_id if org_id else "user"
    clone_name = f"{source.name}_clone"
    full_name = f"{namespace}/{clone_name}"

    # Prevent duplicate clones
    existing = await TrainerRegistration.find_one(
        TrainerRegistration.name == clone_name,
        TrainerRegistration.org_id == org_id,
    )
    if existing:
        return {
            "ok": True,
            "trainer_id": str(existing.id),
            "name": existing.name,
            "message": "Clone already exists",
        }

    now = utc_now()

    cloned = TrainerRegistration(
        name=clone_name,
        version=source.version,
        description=f"[Clone of {source.full_name or source.name}] {source.description}",
        framework=source.framework,
        schedule=source.schedule,
        data_source_info=source.data_source_info,
        class_path=source.class_path,
        plugin_file=None if source.protect_model else source.plugin_file,
        tags=dict(source.tags),
        org_id=org_id,
        owner_email=current_user.email,
        namespace=namespace,
        full_name=full_name,
        author=source.author,
        author_email=source.author_email,
        author_url=source.author_url,
        git_url=source.git_url,
        commercial="private",   # clones default to private
        downloadable=False,
        protect_model=False,
        icon_url=source.icon_url,
        license=source.license,
        parent_trainer_id=str(source.id),
        clone_depth=source.clone_depth + 1,
        approval_status="approved",
        is_active=True,
        output_display=list(source.output_display),
        derived_metrics=list(source.derived_metrics),
        registered_at=now,
        updated_at=now,
    )
    await cloned.insert()

    return {
        "ok": True,
        "trainer_id": str(cloned.id),
        "name": cloned.name,
    }
