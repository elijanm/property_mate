from typing import List, Optional

from app.models.inspection_report import InspectionReport
from app.utils.datetime import utc_now
from beanie import Document, PydanticObjectId

class InspectionRepository:
    async def create(self, report: InspectionReport) -> InspectionReport:
        await report.insert()
        return report

    async def get_by_id(self, report_id: str, org_id: str) -> Optional[InspectionReport]:
        return await InspectionReport.find_one(
            InspectionReport.id == PydanticObjectId(report_id),
            InspectionReport.org_id == org_id,
            InspectionReport.deleted_at == None,  # noqa: E711
        )

    async def get_by_token(self, token: str) -> Optional[InspectionReport]:
        """Public access — no org_id filter; token is the auth mechanism."""
        return await InspectionReport.find_one(
            InspectionReport.token == token,
            InspectionReport.deleted_at == None,  # noqa: E711
        )

    async def list_by_lease(self, lease_id: str, org_id: str) -> List[InspectionReport]:
        return await InspectionReport.find(
            InspectionReport.org_id == org_id,
            InspectionReport.lease_id == lease_id,
            InspectionReport.deleted_at == None,  # noqa: E711
        ).sort("-created_at").to_list()

    async def save(self, report: InspectionReport) -> InspectionReport:
        report.updated_at = utc_now()
        await report.save()
        return report


inspection_repository = InspectionRepository()
