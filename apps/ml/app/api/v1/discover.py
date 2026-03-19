"""Public discovery endpoints — no authentication required."""
from typing import Any, Dict, List
from fastapi import APIRouter, Query

from app.models.training_config import TrainingConfig as TrainingConfigDoc
from app.models.ml_user import MLUser
from app.models.model_deployment import ModelDeployment
from app.models.dataset import DatasetProfile, DatasetEntry
from app.utils.s3_url import generate_presigned_url

router = APIRouter(prefix="/discover", tags=["discover"])


async def _get_cfg() -> TrainingConfigDoc | None:
    return await TrainingConfigDoc.find_one(TrainingConfigDoc.key == "global")


# ── Engineers ──────────────────────────────────────────────────────────────────

@router.get("/engineers")
async def list_engineers(
    search: str = Query("", description="Search by name or email"),
):
    """Return all engineers/admins. In demo_mode all are shown; otherwise only published ones."""
    cfg = await _get_cfg()
    if not (cfg.discovery_enabled if cfg else True):
        return []

    users = await MLUser.find(
        {"role": {"$in": ["engineer", "admin"]}, "deleted_at": None}
    ).to_list()

    results = []
    for u in users:
        if search and search.lower() not in (u.full_name + u.email).lower():
            continue

        # Count their models + datasets
        model_count = await ModelDeployment.find(
            ModelDeployment.org_id == u.org_id,
            ModelDeployment.status == "active",
        ).count()
        dataset_count = await DatasetProfile.find(
            DatasetProfile.org_id == u.org_id,
            DatasetProfile.deleted_at == None,  # noqa: E711
        ).count()

        # Collect unique frameworks from their model tags
        models = await ModelDeployment.find(
            ModelDeployment.org_id == u.org_id,
            ModelDeployment.status == "active",
        ).to_list()
        frameworks: List[str] = []
        for m in models:
            fw = m.tags.get("framework") or m.tags.get("Framework") or ""
            if fw and fw not in frameworks:
                frameworks.append(fw)

        results.append({
            "id": str(u.id),
            "name": u.full_name or u.email.split("@")[0],
            "email_domain": "@" + u.email.split("@")[-1] if "@" in u.email else "",
            "role": u.role,
            "org_id": u.org_id,
            "model_count": model_count,
            "dataset_count": dataset_count,
            "frameworks": frameworks[:6],
            "joined_at": u.created_at.isoformat() if hasattr(u, "created_at") and u.created_at else None,
        })

    # Sort by model_count desc
    results.sort(key=lambda x: x["model_count"], reverse=True)
    return results


@router.get("/engineers/{engineer_id}")
async def get_engineer(engineer_id: str):
    """Full profile for a single engineer — their models, datasets, frameworks."""
    from beanie import PydanticObjectId
    cfg = await _get_cfg()
    if not (cfg.discovery_enabled if cfg else True):
        return {}

    try:
        uid = PydanticObjectId(engineer_id)
    except Exception:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Engineer not found")

    u = await MLUser.find_one({"_id": uid, "role": {"$in": ["engineer", "admin"]}})
    if not u:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Engineer not found")

    models = await ModelDeployment.find(
        ModelDeployment.org_id == u.org_id,
        ModelDeployment.status == "active",
    ).sort("-deployed_at").to_list()

    datasets = await DatasetProfile.find(
        DatasetProfile.org_id == u.org_id,
        {"deleted_at": None},
    ).sort(-DatasetProfile.created_at).to_list()

    def _model_out(m: ModelDeployment) -> Dict[str, Any]:
        return {
            "id": str(m.id),
            "trainer_name": m.trainer_name,
            "version": m.version,
            "status": m.status,
            "tags": m.tags,
            "category": m.category,
            "metrics": m.metrics,
            "created_at": m.deployed_at.isoformat() if m.deployed_at else None,
        }

    def _dataset_out(d: DatasetProfile) -> Dict[str, Any]:
        field_types = list({f.type for f in d.fields})
        return {
            "id": str(d.id),
            "name": d.name,
            "slug": d.slug,
            "description": d.description,
            "category": d.category,
            "entry_count_cache": d.entry_count_cache,
            "field_count": len(d.fields),
            "field_types": field_types,
            "status": d.status,
            "fields": [{"id": f.id, "type": f.type, "label": f.label} for f in d.fields],
        }

    frameworks: List[str] = []
    for m in models:
        fw = m.tags.get("framework") or m.tags.get("Framework") or ""
        if fw and fw not in frameworks:
            frameworks.append(fw)

    return {
        "id": str(u.id),
        "name": u.full_name or u.email.split("@")[0],
        "email_domain": "@" + u.email.split("@")[-1] if "@" in u.email else "",
        "role": u.role,
        "org_id": u.org_id,
        "frameworks": frameworks,
        "model_count": len(models),
        "dataset_count": len(datasets),
        "models": [_model_out(m) for m in models[:20]],
        "datasets": [_dataset_out(d) for d in datasets[:20]],
        "joined_at": u.created_at.isoformat() if hasattr(u, "created_at") and u.created_at else None,
    }


# ── Models marketplace ─────────────────────────────────────────────────────────

@router.get("/models")
async def list_public_models(
    search: str = Query("", description="Search by name or trainer"),
    framework: str = Query("", description="Filter by framework tag"),
    category: str = Query("", description="Filter by category key"),
):
    cfg = await _get_cfg()
    if not (cfg.discovery_enabled if cfg else True):
        return []

    models = await ModelDeployment.find(ModelDeployment.status == "active").to_list()

    results = []
    for m in models:
        name = m.trainer_name or ""
        if search and search.lower() not in name.lower():
            continue
        fw = m.tags.get("framework") or m.tags.get("Framework") or ""
        if framework and framework.lower() not in fw.lower():
            continue
        cat_key = m.category.get("key", "") if isinstance(m.category, dict) else ""
        if category and category.lower() not in cat_key.lower():
            continue

        # Fetch publisher name
        publisher = await MLUser.find_one(MLUser.org_id == m.org_id)
        publisher_name = ""
        if publisher:
            publisher_name = publisher.full_name or publisher.email.split("@")[0]

        results.append({
            "id": str(m.id),
            "trainer_name": m.trainer_name,
            "version": m.version,
            "status": m.status,
            "tags": m.tags,
            "category": m.category,
            "metrics": m.metrics,
            "input_schema": m.input_schema,
            "output_schema": m.output_schema,
            "org_id": m.org_id,
            "publisher_name": publisher_name,
            "publisher_id": str(publisher.id) if publisher else None,
            "created_at": m.deployed_at.isoformat() if m.deployed_at else None,
        })

    results.sort(key=lambda x: x["created_at"] or "", reverse=True)
    return results


# ── Datasets marketplace ───────────────────────────────────────────────────────

@router.get("/datasets")
async def list_public_datasets(
    search: str = Query("", description="Search by name, slug or category"),
    field_type: str = Query("", description="Filter by field type (image/video/text/number)"),
):
    cfg = await _get_cfg()
    if not (cfg.discovery_enabled if cfg else True):
        return []

    datasets = await DatasetProfile.find({"deleted_at": None}).to_list()

    results = []
    for d in datasets:
        if search and search.lower() not in (d.name + (d.slug or "") + d.category + d.description).lower():
            continue
        field_types = [f.type for f in d.fields]
        if field_type and field_type not in field_types:
            continue

        publisher = await MLUser.find_one(MLUser.org_id == d.org_id)
        publisher_name = ""
        if publisher:
            publisher_name = publisher.full_name or publisher.email.split("@")[0]

        results.append({
            "id": str(d.id),
            "name": d.name,
            "slug": d.slug,
            "description": d.description,
            "category": d.category,
            "status": d.status,
            "entry_count_cache": d.entry_count_cache,
            "field_types": list(set(field_types)),
            "field_count": len(d.fields),
            "fields": [{"id": f.id, "type": f.type, "label": f.label} for f in d.fields],
            "org_id": d.org_id,
            "publisher_name": publisher_name,
            "publisher_id": str(publisher.id) if publisher else None,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "visibility": d.visibility,
            "points_enabled": d.points_enabled,
        })

    results.sort(key=lambda x: x["entry_count_cache"], reverse=True)
    return results
