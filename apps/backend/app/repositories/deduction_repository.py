from typing import List, Optional

from app.models.deposit_deduction import DepositDeduction
from app.utils.datetime import utc_now
from beanie import Document, PydanticObjectId


class DeductionRepository:
    async def create(self, deduction: DepositDeduction) -> DepositDeduction:
        await deduction.insert()
        return deduction

    async def get_by_id(self, deduction_id: str, org_id: str) -> Optional[DepositDeduction]:
        return await DepositDeduction.find_one(
            DepositDeduction.id == PydanticObjectId(deduction_id),
            DepositDeduction.org_id == org_id,
            DepositDeduction.deleted_at == None,  # noqa: E711
        )

    async def list_by_lease(self, lease_id: str, org_id: str) -> List[DepositDeduction]:
        return await DepositDeduction.find(
            DepositDeduction.org_id == org_id,
            DepositDeduction.lease_id == lease_id,
            DepositDeduction.deleted_at == None,  # noqa: E711
        ).sort("-created_at").to_list()

    async def save(self, deduction: DepositDeduction) -> DepositDeduction:
        deduction.updated_at = utc_now()
        await deduction.save()
        return deduction


deduction_repository = DeductionRepository()
