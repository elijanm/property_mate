"""Repository for MaintenanceTicket (meter discrepancy disputes from inspection flow)."""
from typing import List, Optional

from app.models.maintenance_ticket import MaintenanceTicket
from app.utils.datetime import utc_now
from beanie import Document, PydanticObjectId


class MaintenanceTicketRepository:
    async def create(self, ticket: MaintenanceTicket) -> MaintenanceTicket:
        await ticket.insert()
        return ticket

    async def get_by_id(self, ticket_id: str, org_id: str) -> Optional[MaintenanceTicket]:
        return await MaintenanceTicket.find_one(
            MaintenanceTicket.id == PydanticObjectId(ticket_id),
            MaintenanceTicket.org_id == org_id,
            MaintenanceTicket.deleted_at == None,  # noqa: E711
        )

    async def list_by_lease(self, lease_id: str, org_id: str) -> List[MaintenanceTicket]:
        return await MaintenanceTicket.find(
            MaintenanceTicket.org_id == org_id,
            MaintenanceTicket.lease_id == lease_id,
            MaintenanceTicket.deleted_at == None,  # noqa: E711
        ).sort("-created_at").to_list()

    async def list_by_inspection(
        self, inspection_report_id: str, org_id: str
    ) -> List[MaintenanceTicket]:
        return await MaintenanceTicket.find(
            MaintenanceTicket.org_id == org_id,
            MaintenanceTicket.inspection_report_id == inspection_report_id,
            MaintenanceTicket.deleted_at == None,  # noqa: E711
        ).sort("-created_at").to_list()

    async def save(self, ticket: MaintenanceTicket) -> MaintenanceTicket:
        ticket.updated_at = utc_now()
        await ticket.save()
        return ticket


maintenance_ticket_repository = MaintenanceTicketRepository()
