"""Trainer registration endpoints."""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Optional
import aiofiles
from pathlib import Path

from app.core.config import settings
from app.dependencies.auth import require_roles, get_current_user
from app.models.trainer_registration import TrainerRegistration
from app.services.registry_service import (
    scan_and_register_plugins,
    list_trainer_classes,
    get_trainer_class,
)
from app.utils.datetime import utc_now
from app.utils.serialization import doc_to_dict

router = APIRouter(prefix="/trainers", tags=["trainers"])


def _resolve_trainer_file(source, base_name: str, plugin_dir: str) -> "Path | None":
    """Return the actual .py path for a trainer, trying multiple locations.

    Priority:
    1. source.plugin_file if it exists on disk
    2. global_sample/<base_name>.py or global_sample/sample_<base_name>.py
    3. The path stored in the in-memory registered class (inspect.__file__ equivalent)
    """
    if source.plugin_file:
        p = Path(source.plugin_file)
        if p.exists():
            return p

    plugin_base = Path(plugin_dir)
    global_sample = plugin_base / "global_sample"
    for candidate in [
        global_sample / f"{base_name}.py",
        global_sample / f"sample_{base_name}.py",
    ]:
        if candidate.exists():
            return candidate

    # Last resort: ask the in-memory registry where the class lives
    from app.services.registry_service import get_trainer_class
    cls = get_trainer_class(base_name)
    if cls:
        import inspect
        try:
            p = Path(inspect.getfile(cls))
            if p.exists():
                return p
        except (TypeError, OSError):
            pass

    return None


@router.get("/churn_predictor/sample-csv")
async def download_churn_sample_csv(user=Depends(get_current_user)):
    """Return a sample CSV template for the churn predictor dataset."""
    try:
        from trainers.churn_predictor import generate_sample_csv
    except ImportError:
        raise HTTPException(status_code=404, detail="churn_predictor trainer not found")
    csv_bytes = generate_sample_csv()
    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=churn_training_sample.csv"},
    )


def _trainer_is_live(r: TrainerRegistration) -> bool:
    """True when the registration should appear in the live trainers list.

    System trainers (org_id=""): must have a file inside TRAINER_PLUGIN_DIR.
    Org trainers: the DB is the source of truth — if is_active=True and
    approval_status="approved", show it even if the file has been moved
    (e.g. tmp cleanup after submission, container restart).  File existence is
    only used to filter out obviously stale system-trainer entries.
    """
    plugin_base = Path(settings.TRAINER_PLUGIN_DIR)
    if not r.plugin_file:
        return True
    p = Path(r.plugin_file)
    if not r.org_id:
        # System trainer — file must exist inside the plugin dir
        return p.exists() and str(p.resolve()).startswith(str(plugin_base.resolve()))
    # Org trainer — trust DB flags; file absence after approval is not a blocker
    # (file may be in /tmp/ml_uploads/ that was cleaned, or running/ that was remounted).
    # Also treat empty/None approval_status as "approved" — registrations created before the
    # field existed were active by definition (is_active=True already passed the outer filter).
    non_approved = {"pending_review", "pending_admin", "flagged", "rejected"}
    if r.approval_status not in non_approved:
        return True
    # For non-approved org trainers, still require the file (avoids ghost pending entries)
    return p.exists()


@router.get("")
async def list_trainers(user=Depends(get_current_user)):
    """Return the caller's private org trainers only."""
    regs = await TrainerRegistration.find(
        TrainerRegistration.is_active == True,  # noqa: E712
        TrainerRegistration.org_id == (user.org_id or ""),
    ).to_list()
    live = [r for r in regs if _trainer_is_live(r)]
    if user.role != "admin":
        live = [r for r in live if r.owner_email == user.email or not r.org_id]
    return {"items": [_trainer_dict(r) for r in live], "total": len(live)}


@router.get("/pending")
async def list_pending_trainers(user=Depends(get_current_user)):
    """Return all TrainerRegistration records with a non-approved approval_status.

    Engineers/admins see their own org's pending trainers.
    Admins also see pending trainers across all orgs when ?all=true.
    Each version is returned as a separate item — no grouping.
    """
    PENDING_STATUSES = ("pending_review", "pending_admin", "flagged", "rejected")

    if user.role == "admin":
        # Admin sees all orgs' pending trainers regardless of org_id
        regs = await TrainerRegistration.find(
            {"approval_status": {"$in": list(PENDING_STATUSES)}}
        ).to_list()
    else:
        regs = await TrainerRegistration.find(
            TrainerRegistration.org_id == (user.org_id or ""),
            {"approval_status": {"$in": list(PENDING_STATUSES)}},
        ).to_list()
        regs = [r for r in regs if r.owner_email == user.email]

    return {"items": [_trainer_dict(r) for r in regs], "total": len(regs)}


@router.patch("/pending/{name}/approve")
async def approve_pending_trainer(name: str, user=Depends(require_roles("admin"))):
    """Admin: approve a pending TrainerRegistration by name."""
    reg = await TrainerRegistration.find_one(TrainerRegistration.name == name)
    if not reg:
        raise HTTPException(status_code=404, detail=f"Trainer '{name}' not found")
    await reg.set({"approval_status": "approved", "is_active": True, "updated_at": utc_now()})
    return _trainer_dict(reg)


@router.patch("/pending/{name}/reject")
async def reject_pending_trainer(
    name: str,
    body: dict,
    user=Depends(require_roles("admin")),
):
    """Admin: reject a pending TrainerRegistration by name."""
    reg = await TrainerRegistration.find_one(TrainerRegistration.name == name)
    if not reg:
        raise HTTPException(status_code=404, detail=f"Trainer '{name}' not found")
    reason = body.get("reason", "")
    await reg.set({
        "approval_status": "rejected",
        "rejection_reason": reason,
        "is_active": False,
        "updated_at": utc_now(),
    })
    return _trainer_dict(reg)


@router.get("/public")
async def list_public_trainers(user=Depends(get_current_user)):
    """Return public/system trainers (org_id='') — visible to all, clone-only."""
    regs = await TrainerRegistration.find(
        TrainerRegistration.is_active == True,  # noqa: E712
        TrainerRegistration.org_id == "",
    ).to_list()
    live = [r for r in regs if _trainer_is_live(r)]
    return {"items": [_trainer_dict(r) for r in live], "total": len(live)}


@router.get("/{name}")
async def get_trainer(name: str, user=Depends(get_current_user)):
    reg = await TrainerRegistration.find_one(TrainerRegistration.name == name)
    if not reg:
        raise HTTPException(status_code=404, detail=f"Trainer '{name}' not found")
    # Non-admin can only see sample trainers or their own
    if user.role != "admin" and not reg.is_sample and reg.owner_email != user.email:
        raise HTTPException(status_code=404, detail=f"Trainer '{name}' not found")
    return _trainer_dict(reg)


@router.post("/upload")
async def upload_trainer_plugin(
    file: UploadFile = File(...),
    user=Depends(require_roles("engineer", "admin")),
):
    """Upload a .py file containing a BaseTrainer subclass."""
    if not file.filename or not file.filename.endswith(".py"):
        raise HTTPException(status_code=400, detail="Only .py files are accepted")

    plugin_dir = Path(settings.TRAINER_PLUGIN_DIR)
    plugin_dir.mkdir(parents=True, exist_ok=True)
    dest = plugin_dir / file.filename

    content = await file.read()
    async with aiofiles.open(dest, "wb") as f:
        await f.write(content)

    count = await scan_and_register_plugins(owner_email=user.email, org_id=user.org_id or None)
    # Return the registration record for the uploaded trainer (stem = trainer name candidate)
    stem = Path(file.filename).stem
    reg = await TrainerRegistration.find_one(TrainerRegistration.name == stem)
    trainer_data = _trainer_dict(reg) if reg else None
    return {"uploaded": file.filename, "trainers_registered": count, "trainer": trainer_data}


@router.post("/scan")
async def rescan_plugins(user=Depends(require_roles("engineer", "admin"))):
    """Re-scan the plugin directory for new/updated trainers."""
    count = await scan_and_register_plugins()
    return {"trainers_registered": count}


@router.post("/{name}/clone")
async def clone_trainer(name: str, user=Depends(require_roles("engineer", "admin"))):
    """Clone a trainer from another org (or same org) into the caller's org workspace.
    The clone is inactive and pending review — it must be approved before use."""
    import re
    source = await TrainerRegistration.find_one(
        TrainerRegistration.name == name,
        TrainerRegistration.is_active == True,
    )
    if not source:
        raise HTTPException(status_code=404, detail=f"Active trainer '{name}' not found")
    # Public trainers (org_id="") are always cloneable.
    # Org trainers require explicit downloadable=True to be cloned by other orgs.
    is_public = not source.org_id
    is_own_org = source.org_id == (user.org_id or "")
    if not is_public and not is_own_org and not source.downloadable:
        raise HTTPException(status_code=403, detail="This trainer is not available for cloning.")

    # Credit check: if trainer has an activation cost, verify wallet balance
    if source.activation_cost_usd > 0:
        from app.models.wallet import Wallet
        wallet = await Wallet.find_one({"org_id": user.org_id or ""})
        balance = wallet.balance_usd if wallet else 0.0
        if balance < source.activation_cost_usd:
            raise HTTPException(
                status_code=402,
                detail={
                    "code": "INSUFFICIENT_CREDITS",
                    "message": f"You need ${source.activation_cost_usd:.2f} credits to activate this plugin. "
                               f"Your current balance is ${balance:.2f}.",
                    "required_usd": source.activation_cost_usd,
                    "balance_usd": balance,
                }
            )

    target_org = user.org_id or ""
    base = source.base_name or re.sub(r"_v\d+$", "", source.name)

    # Find next plugin_version in target org (0 = base, 1 = v1, …)
    existing = await TrainerRegistration.find({
        "org_id": target_org,
        "base_name": base,
    }).to_list()
    max_pv = max((r.plugin_version for r in existing), default=-1)
    clone_pv = max_pv + 1
    clone_name = base if clone_pv == 0 else f"{base}_v{clone_pv}"

    # Copy the source file into the org's own running/ directory so edits to
    # the clone are isolated and never affect the public trainer.
    clone_plugin_file = source.plugin_file  # fallback
    src_path = _resolve_trainer_file(source, base, settings.TRAINER_PLUGIN_DIR)
    if src_path and src_path.exists():
        import shutil as _shutil
        plugin_base = Path(settings.TRAINER_PLUGIN_DIR)
        dest_dir = plugin_base / "running" / (target_org or "system")
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_path = dest_dir / f"{clone_name}.py"
        _shutil.copy2(src_path, dest_path)
        clone_plugin_file = str(dest_path)

    clone = TrainerRegistration(
        org_id=target_org,
        name=clone_name,
        base_name=base,
        plugin_version=clone_pv,
        version_num=clone_pv + 1,  # keep legacy field in sync
        namespace=target_org or "system",
        full_name=f"{target_org}/{clone_name}",
        description=source.description,
        framework=source.framework,
        data_source_info=source.data_source_info,
        class_path=source.class_path,
        plugin_file=clone_plugin_file,
        tags=source.tags,
        author=source.author,
        author_email=source.author_email,
        author_url=source.author_url,
        icon_url=source.icon_url,
        license=source.license,
        parent_trainer_id=str(source.id),
        clone_depth=source.clone_depth + 1,
        cloned_from_org_id=source.org_id,
        # Clones from public system trainers are auto-approved (trusted source).
        # Clones from org trainers require the same review as any upload.
        is_active=not source.org_id,
        approval_status="approved" if not source.org_id else "pending_review",
        visibility="private",   # clones are always private to the target org
        owner_email=user.email,
        registered_at=utc_now(),
        updated_at=utc_now(),
    )
    await clone.insert()

    # Deduct activation credit after successful clone
    if source.activation_cost_usd > 0:
        try:
            from app.models.wallet import Wallet
            await Wallet.find_one_and_update(
                {"org_id": target_org},
                {"$inc": {"balance_usd": -source.activation_cost_usd}},
            )
        except Exception:
            pass  # non-fatal: clone is already created; billing team can reconcile

    # Scaffold the trainer's dataset for the target org so the user can immediately
    # see where to upload data. The dataset is empty — the user fills it themselves.
    try:
        from app.services.registry_service import get_trainer_class, _ensure_trainer_datasets
        trainer_cls = get_trainer_class(clone_name) or get_trainer_class(base)
        if trainer_cls:
            await _ensure_trainer_datasets(trainer_cls, org_id=target_org)
    except Exception:
        pass  # non-fatal — dataset will be auto-created on first training run anyway

    return _trainer_dict(clone)


@router.post("/init-workspace", status_code=201)
async def init_workspace(user=Depends(require_roles("engineer", "admin"))):
    """Auto-clone all public trainers into the caller's org workspace.
    Called once after a new org is created (e.g. on first signup).
    Skips trainers the org already has a private copy of.
    """
    target_org = user.org_id or ""
    public = await TrainerRegistration.find(
        TrainerRegistration.org_id == "",
        TrainerRegistration.is_active == True,  # noqa: E712
    ).to_list()

    created = []
    for source in public:
        base = source.base_name or re.sub(r"_v\d+$", "", source.name)
        # Skip if org already has a private copy of this base trainer
        existing_copy = await TrainerRegistration.find_one({
            "org_id": target_org,
            "base_name": base,
        })
        if existing_copy:
            continue

        clone_name = base  # first copy is always the base (plugin_version=0)

        # Copy source file into org's running/ dir for isolation
        clone_plugin_file = source.plugin_file
        _src_path = _resolve_trainer_file(source, base, settings.TRAINER_PLUGIN_DIR)
        if _src_path and _src_path.exists():
            import shutil as _shutil
            plugin_base = Path(settings.TRAINER_PLUGIN_DIR)
            dest_dir = plugin_base / "running" / (target_org or "system")
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest_path = dest_dir / f"{clone_name}.py"
            _shutil.copy2(_src_path, dest_path)
            clone_plugin_file = str(dest_path)

        clone = TrainerRegistration(
            org_id=target_org,
            name=clone_name,
            base_name=base,
            plugin_version=0,
            version_num=1,
            namespace=target_org,
            full_name=f"{target_org}/{clone_name}",
            description=source.description,
            framework=source.framework,
            data_source_info=source.data_source_info,
            class_path=source.class_path,
            plugin_file=clone_plugin_file,
            tags=source.tags,
            author=source.author,
            author_email=source.author_email,
            author_url=source.author_url,
            icon_url=source.icon_url,
            license=source.license,
            parent_trainer_id=str(source.id),
            clone_depth=1,
            cloned_from_org_id="",
            is_active=True,
            approval_status="approved",   # cloned from trusted public source
            visibility="private",
            owner_email=user.email,
            registered_at=utc_now(),
            updated_at=utc_now(),
        )
        await clone.insert()
        created.append(clone_name)
        # Scaffold the trainer's dataset for this org
        try:
            from app.services.registry_service import get_trainer_class, _ensure_trainer_datasets
            trainer_cls = get_trainer_class(clone_name) or get_trainer_class(base)
            if trainer_cls:
                await _ensure_trainer_datasets(trainer_cls, org_id=target_org)
        except Exception:
            pass

    return {"cloned": created, "count": len(created)}


@router.delete("/{name}")
async def deactivate_trainer(name: str, user=Depends(require_roles("engineer", "admin"))):
    from app.models.model_deployment import ModelDeployment
    reg = await TrainerRegistration.find_one(TrainerRegistration.name == name)
    if not reg:
        raise HTTPException(status_code=404, detail=f"Trainer '{name}' not found")
    # Non-admin can only deactivate own trainers
    if user.role != "admin" and reg.owner_email is not None and reg.owner_email != user.email:
        raise HTTPException(status_code=403, detail="You do not have permission to deactivate this trainer")
    await reg.set({"is_active": False, "updated_at": utc_now()})
    # Soft-archive all active deployments for this trainer version
    active_deps = await ModelDeployment.find(
        ModelDeployment.trainer_name == name,
        ModelDeployment.org_id == (reg.org_id or ""),
        ModelDeployment.status == "active",
    ).to_list()
    now = utc_now()
    for dep in active_deps:
        await dep.set({"status": "archived", "is_default": False, "updated_at": now})
    return {"deactivated": True, "deployments_archived": len(active_deps)}


# ── Serialisation helper ────────────────────────────────────────────────────

def _trainer_dict(r: TrainerRegistration) -> dict:
    """Serialise a TrainerRegistration with a computed version_full field."""
    d = doc_to_dict(r)
    pv = r.plugin_version if r.plugin_version is not None else 0
    tp = r.latest_training_patch if r.latest_training_patch is not None else 0
    # Full version string: v{plugin_version}.0.0.{training_patch}
    d["version_full"] = f"v{pv}.0.0.{tp}"
    # Frontend expects created_at; backend stores registered_at
    if "created_at" not in d or not d["created_at"]:
        d["created_at"] = d.get("registered_at")
    return d
