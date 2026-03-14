from typing import List, Optional, Tuple

from app.models.user import User
from app.utils.datetime import utc_now
from app.utils.objectid import safe_oid


def _phone_variants(phone: str) -> list[str]:
    """Return all common format variants of a phone number for fuzzy lookup.

    Handles: +254723681977  <->  0723681977  <->  254723681977
    """
    phone = phone.strip()
    variants: set[str] = {phone}
    if phone.startswith("+"):
        bare = phone[1:]          # 254723681977
        variants.add(bare)
        if bare.startswith("254") and len(bare) >= 9:
            variants.add("0" + bare[3:])  # 0723681977
    elif phone.startswith("0") and len(phone) >= 9:
        variants.add("254" + phone[1:])   # 254723681977
        variants.add("+254" + phone[1:])  # +254723681977
    elif phone.startswith("254") and len(phone) >= 9:
        variants.add("+" + phone)         # +254723681977
        variants.add("0" + phone[3:])     # 0723681977
    return list(variants)


class UserRepository:
    """
    Users are a platform-level collection — no org_id filter is applied here.
    Lookup is by email (globally unique) or by id.
    Soft-delete filter is always applied.
    """

    async def get_by_email(self, email: str) -> Optional[User]:
        return await User.find_one(
            User.email == email,
            User.deleted_at == None,  # noqa: E711
        )

    async def get_by_id(self, user_id: str) -> Optional[User]:
        oid = safe_oid(user_id)
        if not oid:
            return None
        return await User.find_one(
            User.id == oid,
            User.deleted_at == None,  # noqa: E711
        )

    async def create(self, user: User) -> User:
        await user.insert()
        return user

    async def list_tenants(
        self,
        org_id: str | None,
        skip: int = 0,
        limit: int = 20,
        phone: str | None = None,
    ) -> Tuple[List[User], int]:
        filters: list = [{"role": "tenant"}, {"deleted_at": None}]
        if org_id:
            filters.append({"org_id": org_id})
        if phone:
            # Build $in list with all common phone format variants so that
            # +254723681977, 0723681977, and 254723681977 all match each other.
            filters.append({"phone": {"$in": _phone_variants(phone)}})
        query = User.find(*filters)
        total = await query.count()
        items = await query.skip(skip).limit(limit).to_list()
        return items, total

    async def get_tenant_by_id(self, user_id: str, org_id: Optional[str]) -> Optional[User]:
        oid = safe_oid(user_id)
        if not oid:
            return None
        filters: list = [User.id == oid, User.role == "tenant", User.deleted_at == None]  # noqa: E711
        if org_id:  # superadmin has org_id=None → bypass org scope (per RBAC rules)
            filters.append(User.org_id == org_id)
        return await User.find_one(*filters)

    async def list_by_org(self, org_id: str) -> List[User]:
        return await User.find(
            User.org_id == org_id,
            User.deleted_at == None,  # noqa: E711
        ).to_list()

    async def list_all_active(self) -> List[User]:
        return await User.find(User.deleted_at == None).to_list()  # noqa: E711

    async def update(self, user: User) -> User:
        user.updated_at = utc_now()
        await user.save()
        return user


user_repository = UserRepository()
