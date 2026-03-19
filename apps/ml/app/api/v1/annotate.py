"""Auto-annotation API — projects, images, annotations, training, export."""
from typing import Optional, List
from fastapi import APIRouter, Depends, UploadFile, File, Form
from pydantic import BaseModel

from app.dependencies.auth import RequireEngineer
from app.models.ml_user import MLUser
import app.services.annotation_service as svc

router = APIRouter(prefix="/annotate", tags=["annotate"])


# ── schemas ────────────────────────────────────────────────────────────────────

class ProjectCreateRequest(BaseModel):
    name: str
    description: str = ""
    classes: List[str] = ["object"]
    annotation_type: str = "box"       # box | polygon | line


class ProjectUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    classes: Optional[List[str]] = None
    # Training hyper-parameters
    auto_finetune: Optional[bool] = None
    finetune_lr: Optional[float] = None
    base_lr: Optional[float] = None
    train_imgsz: Optional[int] = None
    min_annotations_to_train: Optional[int] = None


class AnnotationIn(BaseModel):
    id: Optional[str] = None
    type: str = "box"
    label: str
    coords: list
    confidence: Optional[float] = None
    approved: bool = True
    source: str = "manual"


class SaveAnnotationsRequest(BaseModel):
    annotations: List[AnnotationIn]


class ApprovePredictionsRequest(BaseModel):
    annotation_ids: Optional[List[str]] = None   # None = approve all


class ExportDatasetRequest(BaseModel):
    format: str = "yolo-detect"   # yolo-detect | yolo-obb | yolo-seg
    train: float = 0.8
    val: float = 0.2
    test: float = 0.0             # 0.0 = no test split


# ── projects ──────────────────────────────────────────────────────────────────

@router.get("/projects")
async def list_projects(user: MLUser = RequireEngineer):
    return await svc.list_projects(user.org_id)


@router.post("/projects")
async def create_project(body: ProjectCreateRequest, user: MLUser = RequireEngineer):
    return await svc.create_project(
        org_id=user.org_id,
        name=body.name,
        description=body.description,
        classes=body.classes,
        annotation_type=body.annotation_type,
        created_by=str(user.id),
    )


@router.get("/projects/{project_id}")
async def get_project(project_id: str, user: MLUser = RequireEngineer):
    p = await svc.get_project(user.org_id, project_id)
    return svc._project_to_dict(p)


@router.patch("/projects/{project_id}")
async def update_project(project_id: str, body: ProjectUpdateRequest, user: MLUser = RequireEngineer):
    return await svc.update_project(
        user.org_id, project_id,
        name=body.name,
        description=body.description,
        classes=body.classes,
    )


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(project_id: str, user: MLUser = RequireEngineer):
    await svc.delete_project(user.org_id, project_id)


# ── images ────────────────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/images")
async def add_images(
    project_id: str,
    files: List[UploadFile] = File(...),
    user: MLUser = RequireEngineer,
):
    return await svc.add_images(user.org_id, project_id, files)


@router.get("/projects/{project_id}/images")
async def list_images(
    project_id: str,
    status: Optional[str] = None,
    quality: Optional[str] = None,
    include_archived: bool = False,
    user: MLUser = RequireEngineer,
):
    return await svc.list_images(user.org_id, project_id, status, quality, include_archived)


@router.get("/projects/{project_id}/images/{image_id}")
async def get_image(project_id: str, image_id: str, user: MLUser = RequireEngineer):
    return await svc.get_image(user.org_id, project_id, image_id)


@router.delete("/projects/{project_id}/images/{image_id}", status_code=204)
async def delete_image(project_id: str, image_id: str, user: MLUser = RequireEngineer):
    await svc.delete_image(user.org_id, project_id, image_id)


class ArchiveImageRequest(BaseModel):
    archived: bool = True


@router.post("/projects/{project_id}/images/{image_id}/archive")
async def archive_image(
    project_id: str,
    image_id: str,
    body: ArchiveImageRequest = ArchiveImageRequest(),
    user: MLUser = RequireEngineer,
):
    return await svc.archive_image(user.org_id, project_id, image_id, body.archived)


@router.get("/projects/{project_id}/images/{image_id}/similar")
async def similar_images(
    project_id: str,
    image_id: str,
    threshold: int = 12,
    user: MLUser = RequireEngineer,
):
    return await svc.find_similar_images(user.org_id, project_id, image_id, threshold)


# ── annotations ───────────────────────────────────────────────────────────────

@router.put("/projects/{project_id}/images/{image_id}/annotations")
async def save_annotations(
    project_id: str,
    image_id: str,
    body: SaveAnnotationsRequest,
    user: MLUser = RequireEngineer,
):
    return await svc.save_annotations(
        user.org_id, project_id, image_id,
        [a.model_dump() for a in body.annotations],
    )


@router.post("/projects/{project_id}/images/{image_id}/approve")
async def approve_predictions(
    project_id: str,
    image_id: str,
    body: ApprovePredictionsRequest,
    user: MLUser = RequireEngineer,
):
    return await svc.approve_predictions(
        user.org_id, project_id, image_id, body.annotation_ids
    )


# ── model versions ────────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/models/{version_id}/activate")
async def set_active_model_version(project_id: str, version_id: str, user: MLUser = RequireEngineer):
    return await svc.set_active_model_version(user.org_id, project_id, version_id)


@router.post("/projects/{project_id}/models/{version_id}/cancel")
async def cancel_model_version(project_id: str, version_id: str, user: MLUser = RequireEngineer):
    return await svc.cancel_model_version(user.org_id, project_id, version_id)


@router.delete("/projects/{project_id}/models/{version_id}")
async def delete_model_version(project_id: str, version_id: str, user: MLUser = RequireEngineer):
    return await svc.delete_model_version(user.org_id, project_id, version_id)


# ── training ──────────────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/train")
async def trigger_training(project_id: str, user: MLUser = RequireEngineer):
    return await svc.trigger_training(user.org_id, project_id)


@router.get("/projects/{project_id}/train/{version_id}")
async def training_status(project_id: str, version_id: str, user: MLUser = RequireEngineer):
    return await svc.get_training_status(user.org_id, project_id, version_id)


@router.post("/projects/{project_id}/predict")
async def run_predictions(project_id: str, user: MLUser = RequireEngineer):
    """Re-run the active model on all images that have no manual annotations."""
    return await svc.run_predictions_now(user.org_id, project_id)


@router.post("/projects/{project_id}/images/{image_id}/predict")
async def predict_single_image(project_id: str, image_id: str, user: MLUser = RequireEngineer):
    """Run the active model on a single image."""
    return await svc.predict_single_image(user.org_id, project_id, image_id)


# ── export ────────────────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/export/dataset")
async def export_dataset(
    project_id: str,
    body: ExportDatasetRequest = ExportDatasetRequest(),
    user: MLUser = RequireEngineer,
):
    return await svc.export_dataset(
        user.org_id, project_id,
        fmt=body.format,
        train_ratio=body.train,
        val_ratio=body.val,
        test_ratio=body.test,
        requester_email=user.email,
    )


@router.get("/projects/{project_id}/export/jobs/{job_id}")
async def get_export_job(project_id: str, job_id: str, user: MLUser = RequireEngineer):
    return await svc.get_export_job(user.org_id, job_id)


@router.post("/projects/{project_id}/export/model")
async def export_model(project_id: str, user: MLUser = RequireEngineer):
    return await svc.export_model(user.org_id, project_id)
