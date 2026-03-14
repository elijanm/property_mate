from typing import Any, Dict, List, Optional, Tuple

from beanie import PydanticObjectId

from app.models.vendor_application import VendorApplication
from app.models.vendor_contract import VendorContract
from app.models.vendor_listing import VendorListing
from app.models.vendor_profile import VendorProfile
from app.utils.datetime import utc_now


# ── VendorProfile ─────────────────────────────────────────────────────────────

class VendorProfileRepository:
    async def create(self, profile: VendorProfile) -> VendorProfile:
        await profile.insert()
        return profile

    async def get_by_id(self, vendor_id: str, org_id: str) -> Optional[VendorProfile]:
        return await VendorProfile.find_one(
            VendorProfile.id == PydanticObjectId(vendor_id),
            VendorProfile.org_id == org_id,
            VendorProfile.deleted_at == None,  # noqa: E711
        )

    async def get_by_id_no_org(self, vendor_id: str) -> Optional[VendorProfile]:
        """Used by superadmin or internal cross-org lookups."""
        return await VendorProfile.find_one(
            VendorProfile.id == PydanticObjectId(vendor_id),
            VendorProfile.deleted_at == None,  # noqa: E711
        )

    async def get_by_invite_token(self, token: str) -> Optional[VendorProfile]:
        return await VendorProfile.find_one(
            VendorProfile.invite_token == token,
            VendorProfile.deleted_at == None,  # noqa: E711
        )

    async def get_by_setup_token(self, token: str) -> Optional[VendorProfile]:
        return await VendorProfile.find_one(
            VendorProfile.setup_link_token == token,
            VendorProfile.deleted_at == None,  # noqa: E711
        )

    async def get_by_user_id(self, user_id: str, org_id: str) -> Optional[VendorProfile]:
        return await VendorProfile.find_one(
            VendorProfile.user_id == user_id,
            VendorProfile.org_id == org_id,
            VendorProfile.deleted_at == None,  # noqa: E711
        )

    async def list(
        self,
        org_id: str,
        status: Optional[str] = None,
        category: Optional[str] = None,
        search: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[VendorProfile], int]:
        filters: List[Any] = [
            VendorProfile.org_id == org_id,
            VendorProfile.deleted_at == None,  # noqa: E711
        ]
        if status:
            filters.append(VendorProfile.status == status)
        if category:
            filters.append({"service_categories": category})
        # text search on company_name / contact_name
        if search:
            import re
            regex = re.compile(search, re.IGNORECASE)
            filters.append(
                {"$or": [{"company_name": regex}, {"contact_name": regex}]}
            )

        query = VendorProfile.find(*filters)
        total = await query.count()
        items = await query.skip((page - 1) * page_size).limit(page_size).to_list()
        return items, total

    async def counts(self, org_id: str) -> Dict[str, int]:
        statuses = ["draft", "pending_review", "approved", "suspended", "inactive", "rejected"]
        result: Dict[str, int] = {"total": 0}
        for s in statuses:
            n = await VendorProfile.find(
                VendorProfile.org_id == org_id,
                VendorProfile.status == s,
                VendorProfile.deleted_at == None,  # noqa: E711
            ).count()
            result[s] = n
            result["total"] += n
        return result

    async def update(self, profile: VendorProfile) -> VendorProfile:
        profile.updated_at = utc_now()
        await profile.save()
        return profile

    async def soft_delete(self, profile: VendorProfile) -> VendorProfile:
        profile.deleted_at = utc_now()
        profile.updated_at = utc_now()
        await profile.save()
        return profile


# ── VendorListing ─────────────────────────────────────────────────────────────

class VendorListingRepository:
    async def create(self, listing: VendorListing) -> VendorListing:
        await listing.insert()
        return listing

    async def get_by_id(self, listing_id: str, org_id: str) -> Optional[VendorListing]:
        return await VendorListing.find_one(
            VendorListing.id == PydanticObjectId(listing_id),
            VendorListing.org_id == org_id,
            VendorListing.deleted_at == None,  # noqa: E711
        )

    async def get_by_id_no_org(self, listing_id: str) -> Optional[VendorListing]:
        return await VendorListing.find_one(
            VendorListing.id == PydanticObjectId(listing_id),
            VendorListing.deleted_at == None,  # noqa: E711
        )

    async def list(
        self,
        org_id: str,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[VendorListing], int]:
        filters: List[Any] = [
            VendorListing.org_id == org_id,
            VendorListing.deleted_at == None,  # noqa: E711
        ]
        if status:
            filters.append(VendorListing.status == status)
        query = VendorListing.find(*filters)
        total = await query.count()
        items = await query.skip((page - 1) * page_size).limit(page_size).to_list()
        return items, total

    async def list_open_by_org(self, org_id: str) -> List[VendorListing]:
        """All open listings for an org — used by the public directory."""
        return await VendorListing.find(
            VendorListing.org_id == org_id,
            VendorListing.status == "open",
            VendorListing.deleted_at == None,  # noqa: E711
        ).to_list()

    async def update(self, listing: VendorListing) -> VendorListing:
        listing.updated_at = utc_now()
        await listing.save()
        return listing

    async def soft_delete(self, listing: VendorListing) -> VendorListing:
        listing.deleted_at = utc_now()
        listing.updated_at = utc_now()
        await listing.save()
        return listing


# ── VendorApplication ─────────────────────────────────────────────────────────

class VendorApplicationRepository:
    async def create(self, app: VendorApplication) -> VendorApplication:
        await app.insert()
        return app

    async def get_by_id(self, app_id: str, org_id: str) -> Optional[VendorApplication]:
        return await VendorApplication.find_one(
            VendorApplication.id == PydanticObjectId(app_id),
            VendorApplication.org_id == org_id,
            VendorApplication.deleted_at == None,  # noqa: E711
        )

    async def list(
        self,
        org_id: str,
        listing_id: Optional[str] = None,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[VendorApplication], int]:
        filters: List[Any] = [
            VendorApplication.org_id == org_id,
            VendorApplication.deleted_at == None,  # noqa: E711
        ]
        if listing_id:
            filters.append(VendorApplication.listing_id == listing_id)
        if status:
            filters.append(VendorApplication.status == status)
        query = VendorApplication.find(*filters)
        total = await query.count()
        items = await query.skip((page - 1) * page_size).limit(page_size).to_list()
        return items, total

    async def update(self, app: VendorApplication) -> VendorApplication:
        app.updated_at = utc_now()
        await app.save()
        return app


# ── VendorContract ────────────────────────────────────────────────────────────

class VendorContractRepository:
    async def create(self, contract: VendorContract) -> VendorContract:
        await contract.insert()
        return contract

    async def get_by_id(self, contract_id: str, org_id: str) -> Optional[VendorContract]:
        return await VendorContract.find_one(
            VendorContract.id == PydanticObjectId(contract_id),
            VendorContract.org_id == org_id,
            VendorContract.deleted_at == None,  # noqa: E711
        )

    async def get_by_vendor_token(self, token: str) -> Optional[VendorContract]:
        return await VendorContract.find_one(
            VendorContract.vendor_token == token,
            VendorContract.deleted_at == None,  # noqa: E711
        )

    async def list_for_vendor(
        self,
        vendor_profile_id: str,
        org_id: str,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[VendorContract], int]:
        filters: List[Any] = [
            VendorContract.org_id == org_id,
            VendorContract.vendor_profile_id == vendor_profile_id,
            VendorContract.deleted_at == None,  # noqa: E711
        ]
        query = VendorContract.find(*filters)
        total = await query.count()
        items = await query.skip((page - 1) * page_size).limit(page_size).to_list()
        return items, total

    async def update(self, contract: VendorContract) -> VendorContract:
        contract.updated_at = utc_now()
        await contract.save()
        return contract

    async def count_active(self, vendor_profile_id: str, org_id: str) -> int:
        return await VendorContract.find(
            VendorContract.org_id == org_id,
            VendorContract.vendor_profile_id == vendor_profile_id,
            VendorContract.status == "active",
            VendorContract.deleted_at == None,  # noqa: E711
        ).count()


vendor_profile_repository = VendorProfileRepository()
vendor_listing_repository = VendorListingRepository()
vendor_application_repository = VendorApplicationRepository()
vendor_contract_repository = VendorContractRepository()
