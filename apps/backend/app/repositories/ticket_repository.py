"""General-purpose ticket repository for the comprehensive Ticket model.

The legacy MaintenanceTicket (meter discrepancy) repository lives in
maintenance_ticket_repository.py and is imported as `ticket_repository` there
for backward compat with inspection_service.py.
"""
from typing import Any, Dict, List, Optional, Tuple

from app.core.database import get_motor_db
from app.models.ticket import Ticket
from app.utils.datetime import utc_now
from beanie import Document, PydanticObjectId

class TicketRepository:
    async def next_reference_number(self, org_id: str) -> str:
        """Atomically increment ticket_counter and return TKT-XXXXXX string."""
        col = get_motor_db()["orgs"]
        result = await col.find_one_and_update(
            {"org_id": org_id},
            {"$inc": {"ticket_counter": 1}},
            return_document=True,
        )
        counter = result.get("ticket_counter", 1) if result else 1
        return f"TKT-{counter:06d}"

    async def create(self, ticket: Ticket) -> Ticket:
        await ticket.insert()
        return ticket

    async def get_by_id(self, ticket_id: str, org_id: str) -> Optional[Ticket]:
        return await Ticket.find_one(
            Ticket.id == PydanticObjectId(ticket_id),
            Ticket.org_id == org_id,
            Ticket.deleted_at == None,  # noqa: E711
        )

    async def get_by_token(self, token: str) -> Optional[Ticket]:
        """Public access — no org_id filter; token is the auth mechanism."""
        return await Ticket.find_one(
            Ticket.submission_token == token,
            Ticket.deleted_at == None,  # noqa: E711
        )

    async def list(
        self,
        org_id: Optional[str],
        property_id: Optional[str] = None,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
        unit_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
        assigned_to: Optional[str] = None,
        category: Optional[str] = None,
        status: Optional[str] = None,
        priority: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[Ticket], int]:
        filters: List[Any] = [Ticket.deleted_at == None]  # noqa: E711
        if org_id:
            filters.insert(0, Ticket.org_id == org_id)
        if entity_type and entity_id:
            filters.append(Ticket.entity_type == entity_type)
            filters.append(Ticket.entity_id == entity_id)
        elif property_id:
            filters.append(Ticket.property_id == property_id)
        if unit_id:
            filters.append(Ticket.unit_id == unit_id)
        if tenant_id:
            filters.append(Ticket.tenant_id == tenant_id)
        if assigned_to:
            filters.append(Ticket.assigned_to == assigned_to)
        if category:
            filters.append(Ticket.category == category)
        if status:
            filters.append(Ticket.status == status)
        if priority:
            filters.append(Ticket.priority == priority)

        query = Ticket.find(*filters).sort("-created_at")
        total = await query.count()
        skip = (page - 1) * page_size
        items = await query.skip(skip).limit(page_size).to_list()
        return items, total

    async def count_by_status(
        self,
        org_id: str,
        property_id: Optional[str] = None,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
    ) -> Dict[str, int]:
        filters: List[Any] = [Ticket.org_id == org_id, Ticket.deleted_at == None]  # noqa: E711
        if entity_type and entity_id:
            filters.append(Ticket.entity_type == entity_type)
            filters.append(Ticket.entity_id == entity_id)
        elif property_id:
            filters.append(Ticket.property_id == property_id)
        all_tickets = await Ticket.find(*filters).to_list()
        counts: Dict[str, int] = {
            "open": 0, "assigned": 0, "in_progress": 0,
            "pending_review": 0, "resolved": 0, "closed": 0, "cancelled": 0,
        }
        for t in all_tickets:
            if t.status in counts:
                counts[t.status] += 1
        return counts

    async def update(self, ticket: Ticket, fields: Dict[str, Any]) -> Ticket:
        for k, v in fields.items():
            setattr(ticket, k, v)
        ticket.updated_at = utc_now()
        await ticket.save()
        return ticket

    async def soft_delete(self, ticket: Ticket) -> Ticket:
        ticket.deleted_at = utc_now()
        await ticket.save()
        return ticket


ticket_repository = TicketRepository()
