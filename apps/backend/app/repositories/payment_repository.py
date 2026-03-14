from typing import List, Optional

from app.models.payment import Payment
from app.utils.datetime import utc_now
from beanie import Document, PydanticObjectId


class PaymentRepository:
    async def create(self, payment: Payment) -> Payment:
        await payment.insert()
        return payment

    async def get_by_id(self, payment_id: str, org_id: str) -> Optional[Payment]:
        return await Payment.find_one(
            Payment.id == PydanticObjectId(payment_id),
            Payment.org_id == org_id,
            Payment.deleted_at == None,  # noqa: E711
        )

    async def get_by_checkout_request_id(self, checkout_request_id: str) -> Optional[Payment]:
        """Used by the Mpesa STK callback — no org_id filter (webhook context)."""
        return await Payment.find_one(
            Payment.mpesa_checkout_request_id == checkout_request_id,
            Payment.deleted_at == None,  # noqa: E711
        )

    async def list_by_lease(self, lease_id: str, org_id: str) -> List[Payment]:
        return await Payment.find(
            Payment.org_id == org_id,
            Payment.lease_id == lease_id,
            Payment.deleted_at == None,  # noqa: E711
        ).sort("-created_at").to_list()

    async def list_by_invoice(self, invoice_id: str, org_id: str) -> List[Payment]:
        return await Payment.find(
            Payment.org_id == org_id,
            Payment.invoice_id == invoice_id,
            Payment.deleted_at == None,  # noqa: E711
        ).sort("-created_at").to_list()

    async def save(self, payment: Payment) -> Payment:
        payment.updated_at = utc_now()
        await payment.save()
        return payment


payment_repository = PaymentRepository()
