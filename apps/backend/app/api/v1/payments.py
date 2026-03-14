from typing import Any, Dict, List

from fastapi import APIRouter, Depends

from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.schemas.payment import LedgerEntryResponse, PaymentCreateRequest, PaymentResponse, PaymentSummary, RefundRequest
from app.services import payment_service

router = APIRouter(tags=["payments"])


@router.post(
    "/leases/{lease_id}/payments",
    response_model=PaymentResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def record_payment(
    lease_id: str,
    request: PaymentCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> PaymentResponse:
    return await payment_service.record_payment(lease_id, request, current_user)


@router.get(
    "/leases/{lease_id}/payments",
    response_model=PaymentSummary,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_payments(
    lease_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> PaymentSummary:
    result= await payment_service.list_payments(lease_id, current_user)
    if hasattr(result, "id"):
      result.id = str(result.id)
    return result


@router.get(
    "/leases/{lease_id}/ledger",
    response_model=List[LedgerEntryResponse],
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_ledger(
    lease_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> List[LedgerEntryResponse]:
    result= await payment_service.get_ledger(lease_id, current_user)
    # if hasattr(result, "id"):
    #   result.id = str(result.id)

    return result



@router.post(
    "/payments/mpesa/stk-callback",
    status_code=200,
)
async def mpesa_stk_callback(body: Dict[str, Any]) -> Dict[str, str]:
    """Daraja STK push callback — no auth (Safaricom calls this directly)."""
    await payment_service.handle_stk_callback(body)
    return {"ResultCode": "0", "ResultDesc": "Accepted"}


@router.post(
    "/leases/{lease_id}/refund",
    response_model=PaymentResponse,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def initiate_refund(
    lease_id: str,
    request: RefundRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> PaymentResponse:
    return await payment_service.initiate_refund(lease_id, request, current_user)


@router.post(
    "/payments/mpesa/voice-stk",
    status_code=200,
    dependencies=[Depends(require_roles("superadmin"))],
)
async def voice_trigger_stk(
    request: dict,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Voice agent calls this to push an STK prompt to the tenant's phone."""
    return await payment_service.trigger_voice_stk(request, current_user)


@router.get(
    "/payments/mpesa/stk/{checkout_request_id}",
    status_code=200,
    dependencies=[Depends(require_roles("superadmin"))],
)
async def get_stk_status(
    checkout_request_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Poll the status of a pending STK push transaction."""
    return await payment_service.get_stk_status(checkout_request_id, current_user)
