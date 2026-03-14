"""Paystack webhook signature verification."""
import hmac
import hashlib

from app.core.config import settings


def verify_webhook_signature(payload: bytes, signature: str) -> bool:
    """Verify Paystack webhook X-Paystack-Signature header."""
    expected = hmac.new(
        settings.PAYSTACK_SECRET_KEY.encode(),
        payload,
        hashlib.sha512,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)
