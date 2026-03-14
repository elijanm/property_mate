from typing import List, Optional, Tuple

from app.models.lease import Lease
from app.utils.datetime import utc_now
from beanie import Document, PydanticObjectId

class LeaseRepository:
    async def create(self, lease: Lease) -> Lease:
        await lease.insert()
        return lease

    async def get_by_id(self, lease_id: str, org_id: str) -> Optional[Lease]:
        return await Lease.find_one(
            Lease.id == PydanticObjectId(lease_id),
            Lease.org_id == org_id,
            Lease.deleted_at == None,  # noqa: E711
        )

    async def get_active_for_unit(self, unit_id: str, org_id: str) -> Optional[Lease]:
        return await Lease.find_one(
            Lease.unit_id == unit_id,
            Lease.org_id == org_id,
            Lease.status == "active",
            Lease.deleted_at == None,  # noqa: E711
        )

    async def list(
        self,
        org_id: Optional[str],
        property_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
        unit_id: Optional[str] = None,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 20,
    ) -> Tuple[List[Lease], int]:
        filters = [Lease.deleted_at == None]  # noqa: E711
        if org_id:
            filters.insert(0, Lease.org_id == org_id)
        if property_id:
            filters.append(Lease.property_id == property_id)
        if tenant_id:
            filters.append(Lease.tenant_id == tenant_id)
        if unit_id:
            filters.append(Lease.unit_id == unit_id)
        if status:
            filters.append(Lease.status == status)

        query = Lease.find(*filters).sort("-created_at")
        total = await query.count()
        items = await query.skip(skip).limit(limit).to_list()
        return items, total

    async def list_active_by_org(self, org_id: str) -> List[Lease]:
        """Return all active (non-deleted) leases for an org."""
        return await Lease.find(
            Lease.org_id == org_id,
            Lease.status == "active",
            Lease.deleted_at == None,  # noqa: E711
        ).to_list()

    async def list_by_property(self, property_id: str, org_id: str) -> List[Lease]:
        """Return all non-deleted leases for a given property."""
        return await Lease.find(
            Lease.org_id == org_id,
            Lease.property_id == property_id,
            Lease.deleted_at == None,  # noqa: E711
        ).to_list()

    async def save(self, lease: Lease) -> Lease:
        lease.updated_at = utc_now()
        await lease.save()
        return lease


lease_repository = LeaseRepository()
