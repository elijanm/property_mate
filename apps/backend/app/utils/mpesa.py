"""
Stateless Safaricom Daraja API helper.

Reads config from settings:
  mpesa_env              — "sandbox" | "production"
  mpesa_consumer_key
  mpesa_consumer_secret
  mpesa_shortcode
  mpesa_passkey
  mpesa_stk_callback_url
  mpesa_b2c_initiator_name
  mpesa_b2c_security_credential
  mpesa_b2c_queue_timeout_url
  mpesa_b2c_result_url
"""
import base64
from datetime import datetime
from typing import Any, Dict

import httpx
import structlog

from app.core.config import settings

logger = structlog.get_logger(__name__)

_SANDBOX_BASE = "https://sandbox.safaricom.co.ke"
_PROD_BASE = "https://api.safaricom.co.ke"


def _base_url() -> str:
    return _SANDBOX_BASE if settings.mpesa_env == "sandbox" else _PROD_BASE


async def get_access_token() -> str:
    """Fetch a short-lived Daraja OAuth2 Bearer token."""
    url = f"{_base_url()}/oauth/v1/generate?grant_type=client_credentials"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            url,
            auth=(settings.mpesa_consumer_key, settings.mpesa_consumer_secret),
        )
        resp.raise_for_status()
        return resp.json()["access_token"]


def _stk_password() -> tuple[str, str]:
    """Return (timestamp, base64_password) for STK push."""
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    raw = f"{settings.mpesa_shortcode}{settings.mpesa_passkey}{timestamp}"
    password = base64.b64encode(raw.encode()).decode()
    return timestamp, password


async def stk_push(
    phone: str,
    amount: float,
    account_ref: str,
    description: str,
    callback_url: str | None = None,
) -> Dict[str, Any]:
    """
    Initiate an STK push (C2B Lipa Na M-Pesa Online).

    Returns the full Daraja response dict, notably:
      CheckoutRequestID, MerchantRequestID, ResponseCode, ResponseDescription,
      CustomerMessage.
    Raises httpx.HTTPStatusError on non-2xx responses.
    """
    token = await get_access_token()
    timestamp, password = _stk_password()
    cb = callback_url or settings.mpesa_stk_callback_url

    payload = {
        "BusinessShortCode": settings.mpesa_shortcode,
        "Password": password,
        "Timestamp": timestamp,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": int(amount),
        "PartyA": phone,
        "PartyB": settings.mpesa_shortcode,
        "PhoneNumber": phone,
        "CallBackURL": cb,
        "AccountReference": account_ref,
        "TransactionDesc": description,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{_base_url()}/mpesa/stkpush/v1/processrequest",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        logger.info(
            "mpesa_stk_push",
            action="stk_push",
            phone=phone,
            amount=amount,
            checkout_request_id=data.get("CheckoutRequestID"),
            status="initiated",
        )
        return data


async def b2c_payment(
    phone: str,
    amount: float,
    remarks: str,
    occasion: str = "",
    timeout_url: str | None = None,
    result_url: str | None = None,
) -> Dict[str, Any]:
    """
    Initiate a B2C payment (Business to Customer).

    Returns the Daraja response dict, notably:
      ConversationID, OriginatorConversationID, ResponseCode, ResponseDescription.
    """
    token = await get_access_token()
    to_url = timeout_url or settings.mpesa_b2c_queue_timeout_url
    r_url = result_url or settings.mpesa_b2c_result_url

    payload = {
        "InitiatorName": settings.mpesa_b2c_initiator_name,
        "SecurityCredential": settings.mpesa_b2c_security_credential,
        "CommandID": "BusinessPayment",
        "Amount": int(amount),
        "PartyA": settings.mpesa_shortcode,
        "PartyB": phone,
        "Remarks": remarks,
        "QueueTimeOutURL": to_url,
        "ResultURL": r_url,
        "Occasion": occasion,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{_base_url()}/mpesa/b2c/v1/paymentrequest",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        logger.info(
            "mpesa_b2c_payment",
            action="b2c_payment",
            phone=phone,
            amount=amount,
            conversation_id=data.get("ConversationID"),
            status="initiated",
        )
        return data
