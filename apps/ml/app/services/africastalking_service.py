"""Africa's Talking airtime topup integration."""
import httpx
import structlog
from app.core.config import settings

logger = structlog.get_logger(__name__)
_AT_BASE = "https://api.africastalking.com/version1"


async def send_airtime(phone: str, amount: float, currency_code: str = "KES") -> str:
    """Send airtime via Africa's Talking. Returns transaction ID. Raises on failure."""
    if not settings.AT_API_KEY or settings.AT_API_KEY == "":
        raise ValueError("AT_API_KEY not configured")

    payload = {
        "username": settings.AT_USERNAME,
        "recipients": f"[{{\"phoneNumber\":\"{phone}\",\"amount\":\"{currency_code} {amount:.2f}\"}}]",
    }
    headers = {
        "apiKey": settings.AT_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(f"{_AT_BASE}/airtime/send", headers=headers, data=payload)
    if resp.status_code >= 400:
        raise ValueError(f"AT API error {resp.status_code}: {resp.text}")
    data = resp.json()
    responses = data.get("responses", [{}])
    if not responses:
        raise ValueError("No response from AT airtime API")
    result = responses[0]
    if result.get("status") not in ("Success", "Sent"):
        raise ValueError(result.get("errorMessage", "AT airtime send failed"))
    return result.get("transactionId", "")
