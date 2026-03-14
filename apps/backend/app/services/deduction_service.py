"""
Deduction service — manage deposit deductions for move-out.
Each deduction creates a debit ledger entry; deletion reverses it.
"""
import structlog

from app.core.exceptions import ResourceNotFoundError
from app.dependencies.auth import CurrentUser
from app.models.deposit_deduction import DepositDeduction
from app.models.ledger_entry import LedgerEntry
from app.repositories.deduction_repository import deduction_repository
from app.repositories.ledger_repository import ledger_repository
from app.repositories.lease_repository import lease_repository
from app.schemas.deduction import DeductionCreateRequest, DeductionResponse, DeductionSummary
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)


def _to_response(d: DepositDeduction) -> DeductionResponse:
    return DeductionResponse(
        id=str(d.id),
        org_id=d.org_id,
        lease_id=d.lease_id,
        tenant_id=d.tenant_id,
        category=d.category,
        description=d.description,
        amount=d.amount,
        evidence_keys=d.evidence_keys,
        approved_by=d.approved_by,
        created_at=d.created_at,
        updated_at=d.updated_at,
    )


async def add_deduction(
    lease_id: str,
    request: DeductionCreateRequest,
    current_user: CurrentUser,
) -> DeductionResponse:
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)

    deduction = DepositDeduction(
        org_id=current_user.org_id,
        lease_id=lease_id,
        tenant_id=lease.tenant_id,
        category=request.category,
        description=request.description,
        amount=request.amount,
        approved_by=current_user.user_id,
    )
    await deduction_repository.create(deduction)

    # Create a debit ledger entry for this deduction
    last_balance = await ledger_repository.last_balance(lease_id, current_user.org_id)
    entry = LedgerEntry(
        org_id=current_user.org_id,
        lease_id=lease_id,
        property_id=lease.property_id,
        tenant_id=lease.tenant_id,
        payment_id=None,
        type="debit",
        category="deduction",
        amount=request.amount,
        description=f"Deposit deduction: {request.description} ({request.category})",
        running_balance=last_balance - request.amount,
    )
    await ledger_repository.create(entry)

    logger.info(
        "deduction_added",
        action="add_deduction",
        resource_type="deposit_deduction",
        resource_id=deduction.id,
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        status="success",
    )
    return _to_response(deduction)


async def list_deductions(lease_id: str, current_user: CurrentUser) -> DeductionSummary:
    lease = await lease_repository.get_by_id(lease_id, current_user.org_id)
    if not lease:
        raise ResourceNotFoundError("Lease", lease_id)
    items = await deduction_repository.list_by_lease(lease_id, current_user.org_id)
    total = sum(d.amount for d in items)
    return DeductionSummary(items=[_to_response(d) for d in items], total=total)


async def delete_deduction(
    deduction_id: str,
    current_user: CurrentUser,
) -> None:
    deduction = await deduction_repository.get_by_id(deduction_id, current_user.org_id)
    if not deduction:
        raise ResourceNotFoundError("DepositDeduction", deduction_id)

    # Reverse ledger entry
    last_balance = await ledger_repository.last_balance(deduction.lease_id, current_user.org_id)
    lease = await lease_repository.get_by_id(deduction.lease_id, current_user.org_id)
    if lease:
        entry = LedgerEntry(
            org_id=current_user.org_id,
            lease_id=deduction.lease_id,
            property_id=lease.property_id,
            tenant_id=deduction.tenant_id,
            type="credit",
            category="deduction",
            amount=deduction.amount,
            description=f"Deduction reversal: {deduction.description}",
            running_balance=last_balance + deduction.amount,
        )
        await ledger_repository.create(entry)

    # Soft-delete
    deduction.deleted_at = utc_now()
    await deduction_repository.save(deduction)

    logger.info(
        "deduction_deleted",
        action="delete_deduction",
        resource_type="deposit_deduction",
        resource_id=deduction_id,
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        status="success",
    )
