"""Org-level spare parts catalog — global across all framework contracts."""
from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import List, Optional

from beanie import PydanticObjectId
from fastapi import APIRouter, Body, Depends, HTTPException, Query, UploadFile, File, status
from pydantic import BaseModel

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.models.framework import PartsCatalogItem

router = APIRouter(prefix="/parts-catalog", tags=["parts-catalog"])

_ROLES = ["owner", "agent", "superadmin"]


# ── Schemas ───────────────────────────────────────────────────────────────────

class PartsCatalogItemCreate(BaseModel):
    part_name: str
    part_number: Optional[str] = None
    category: Optional[str] = None
    unit: str = "unit"
    unit_cost: Optional[float] = None
    notes: Optional[str] = None


class PartsCatalogItemUpdate(BaseModel):
    part_name: Optional[str] = None
    part_number: Optional[str] = None
    category: Optional[str] = None
    unit: Optional[str] = None
    unit_cost: Optional[float] = None
    notes: Optional[str] = None


class PartsCatalogItemResponse(BaseModel):
    id: str
    org_id: str
    part_name: str
    part_number: Optional[str] = None
    category: Optional[str] = None
    unit: str
    unit_cost: Optional[float] = None
    notes: Optional[str] = None
    created_at: str
    updated_at: str


class BulkImportRequest(BaseModel):
    items: List[PartsCatalogItemCreate]


def _to_response(item: PartsCatalogItem) -> PartsCatalogItemResponse:
    return PartsCatalogItemResponse(
        id=str(item.id),
        org_id=item.org_id,
        part_name=item.part_name,
        part_number=item.part_number,
        category=item.category,
        unit=item.unit,
        unit_cost=item.unit_cost,
        notes=item.notes,
        created_at=item.created_at.isoformat(),
        updated_at=item.updated_at.isoformat(),
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get(
    "",
    response_model=List[PartsCatalogItemResponse],
    dependencies=[Depends(require_roles(*_ROLES))],
)
async def list_parts(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> List[PartsCatalogItemResponse]:
    filters = [
        PartsCatalogItem.org_id == current_user.org_id,
        PartsCatalogItem.deleted_at == None,
    ]
    if category:
        filters.append(PartsCatalogItem.category == category)

    items = await PartsCatalogItem.find(*filters).sort(PartsCatalogItem.part_name).to_list()

    if search:
        s = search.lower()
        items = [i for i in items if s in i.part_name.lower() or (i.part_number and s in i.part_number.lower())]

    return [_to_response(i) for i in items]


@router.post(
    "",
    response_model=PartsCatalogItemResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def create_part(
    request: PartsCatalogItemCreate,
    current_user: CurrentUser = Depends(get_current_user),
) -> PartsCatalogItemResponse:
    item = PartsCatalogItem(
        org_id=current_user.org_id,
        part_name=request.part_name,
        part_number=request.part_number,
        category=request.category,
        unit=request.unit,
        unit_cost=request.unit_cost,
        notes=request.notes,
    )
    await item.insert()
    return _to_response(item)


@router.post(
    "/bulk",
    response_model=List[PartsCatalogItemResponse],
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def bulk_import_parts(
    request: BulkImportRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> List[PartsCatalogItemResponse]:
    """Bulk-create parts from a parsed table (paste or CSV upload)."""
    docs = [
        PartsCatalogItem(
            org_id=current_user.org_id,
            part_name=i.part_name,
            part_number=i.part_number,
            category=i.category,
            unit=i.unit,
            unit_cost=i.unit_cost,
            notes=i.notes,
        )
        for i in request.items
        if i.part_name.strip()
    ]
    if docs:
        await PartsCatalogItem.insert_many(docs)
    return [_to_response(d) for d in docs]


@router.post(
    "/upload-csv",
    response_model=List[PartsCatalogItemResponse],
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def upload_csv(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> List[PartsCatalogItemResponse]:
    """Upload a CSV file. Expected columns: Part Name, Part Number, Category, Unit, Notes"""
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")  # handle Excel BOM
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    # Normalize header names (case-insensitive, strip spaces)
    docs = []
    for row in reader:
        norm = {k.strip().lower().replace(" ", "_"): v.strip() for k, v in row.items()}
        part_name = norm.get("part_name") or norm.get("name") or norm.get("description") or ""
        if not part_name:
            continue
        raw_cost = norm.get("unit_cost") or norm.get("cost") or norm.get("price") or None
        unit_cost: Optional[float] = None
        if raw_cost:
            try:
                unit_cost = float(raw_cost.replace(",", ""))
            except ValueError:
                pass
        docs.append(PartsCatalogItem(
            org_id=current_user.org_id,
            part_name=part_name,
            part_number=norm.get("part_number") or norm.get("part_no") or norm.get("p/n") or None,
            category=norm.get("category") or None,
            unit=norm.get("unit") or norm.get("uom") or "unit",
            unit_cost=unit_cost,
            notes=norm.get("notes") or norm.get("remarks") or None,
        ))
    if docs:
        await PartsCatalogItem.insert_many(docs)
    return [_to_response(d) for d in docs]


@router.patch(
    "/{item_id}",
    response_model=PartsCatalogItemResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def update_part(
    item_id: str,
    request: PartsCatalogItemUpdate,
    current_user: CurrentUser = Depends(get_current_user),
) -> PartsCatalogItemResponse:
    item = await PartsCatalogItem.find_one(
        PartsCatalogItem.id == PydanticObjectId(item_id),
        PartsCatalogItem.org_id == current_user.org_id,
        PartsCatalogItem.deleted_at == None,
    )
    if not item:
        raise HTTPException(status_code=404, detail="Part not found")
    if request.part_name is not None:
        item.part_name = request.part_name
    if request.part_number is not None:
        item.part_number = request.part_number
    if request.category is not None:
        item.category = request.category
    if request.unit is not None:
        item.unit = request.unit
    if request.unit_cost is not None:
        item.unit_cost = request.unit_cost
    if request.notes is not None:
        item.notes = request.notes
    item.updated_at = datetime.utcnow()
    await item.save()
    return _to_response(item)


@router.delete(
    "/{item_id}",
    status_code=204,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def delete_part(
    item_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    item = await PartsCatalogItem.find_one(
        PartsCatalogItem.id == PydanticObjectId(item_id),
        PartsCatalogItem.org_id == current_user.org_id,
        PartsCatalogItem.deleted_at == None,
    )
    if not item:
        raise HTTPException(status_code=404, detail="Part not found")
    item.deleted_at = datetime.utcnow()
    await item.save()
