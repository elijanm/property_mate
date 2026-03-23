"""Coupon validation and redemption."""
from typing import Optional
from fastapi import HTTPException
from app.models.coupon import Coupon, CouponRedemption
from app.utils.datetime import utc_now


async def get_coupon(code: str) -> Optional[Coupon]:
    return await Coupon.find_one({"code": code.upper().strip()})


async def validate_coupon(code: str) -> Coupon:
    """Raise 400 if code is invalid, expired, depleted, or inactive."""
    coupon = await get_coupon(code)
    if not coupon:
        raise HTTPException(status_code=400, detail="Invalid coupon code")
    if not coupon.is_active:
        raise HTTPException(status_code=400, detail="This coupon is no longer active")
    if coupon.expires_at:
        now = utc_now().replace(tzinfo=None)
        exp = coupon.expires_at.replace(tzinfo=None) if coupon.expires_at.tzinfo else coupon.expires_at
        if now > exp:
            raise HTTPException(status_code=400, detail="This coupon has expired")
    if coupon.max_uses > 0 and coupon.uses_count >= coupon.max_uses:
        raise HTTPException(status_code=400, detail="This coupon has reached its usage limit")
    return coupon


async def check_already_redeemed(coupon_code: str, user_email: str) -> bool:
    rec = await CouponRedemption.find_one({"coupon_code": coupon_code.upper(), "user_email": user_email})
    return rec is not None


async def redeem(coupon: Coupon, user_email: str, org_id: str) -> float:
    """
    Apply coupon credit to user's wallet. Returns credit amount.
    Idempotent — silently skips if already redeemed by this user.
    """
    from app.services import wallet_service

    # Double-redemption guard
    already = await check_already_redeemed(coupon.code, user_email)
    if already:
        return 0.0

    wallet = await wallet_service.get_or_create(user_email, org_id)
    await wallet_service.credit(
        wallet,
        coupon.credit_usd,
        reference=f"coupon:{coupon.code}",
        description=f"Coupon credit — {coupon.code}",
        is_standard=True,
    )

    # Record redemption
    await CouponRedemption(
        coupon_code=coupon.code,
        user_email=user_email,
        org_id=org_id,
        credit_usd=coupon.credit_usd,
    ).insert()

    # Increment usage count atomically
    await Coupon.find_one({"code": coupon.code}).update({"$inc": {"uses_count": 1}, "$set": {"updated_at": utc_now()}})

    return coupon.credit_usd
