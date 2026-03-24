"""HTTP client for MLDock API.

All tools go through mldock_request(). It:
- Injects the Bearer token from the session file.
- On 401: clears session and returns { "auth_error": True } so Claude can prompt re-login.
- On non-2xx: raises McpError with the server's error message.
"""
from typing import Any, Optional

import httpx

from .auth import AuthError, clear_session, get_base_url, get_token


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


async def mldock_request(
    method: str,
    path: str,
    *,
    json_body: Optional[dict] = None,
    files: Optional[dict] = None,
    data: Optional[dict] = None,
    require_auth: bool = True,
    timeout: float = 60.0,
) -> Any:
    """
    Make an authenticated request to the MLDock API.

    Returns parsed JSON on success.
    Returns { "auth_error": True, "message": "..." } on 401.
    Raises ApiError on other non-2xx responses.
    Raises ApiError with connection details on network errors.
    """
    base_url = get_base_url()
    url = f"{base_url}/api/v1{path}"

    headers: dict = {"Accept": "application/json"}

    if require_auth:
        try:
            token = get_token()
            headers["Authorization"] = f"Bearer {token}"
        except AuthError as e:
            return {"auth_error": True, "message": str(e)}

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            if files:
                # multipart/form-data (trainer upload)
                response = await client.request(
                    method, url, headers=headers, files=files, data=data
                )
            elif json_body is not None:
                headers["Content-Type"] = "application/json"
                response = await client.request(
                    method, url, headers=headers, json=json_body
                )
            else:
                response = await client.request(method, url, headers=headers)

        if response.status_code == 401:
            clear_session()
            return {
                "auth_error": True,
                "message": (
                    "Session expired or invalid. "
                    "Call mldock_login or run /mldock-login to authenticate."
                ),
            }

        if response.status_code == 402:
            raise ApiError(402, "Insufficient wallet balance. Top up your MLDock wallet to use this feature.")

        if response.status_code == 403:
            raise ApiError(403, "Access denied. This action requires engineer or admin role.")

        if response.status_code == 404:
            raise ApiError(404, f"Not found: {path}")

        if not response.is_success:
            # Try to parse structured error body
            try:
                body = response.json()
                msg = (
                    body.get("detail")
                    or body.get("error", {}).get("message")
                    or body.get("message")
                    or response.text[:300]
                )
            except Exception:
                msg = response.text[:300]
            raise ApiError(response.status_code, str(msg))

        if response.headers.get("content-type", "").startswith("application/json"):
            return response.json()
        return {"raw": response.text}

    except httpx.ConnectError:
        raise ApiError(0, f"Cannot connect to {base_url}. Check MLDOCK_BASE_URL.")
    except httpx.TimeoutException:
        raise ApiError(0, f"Request to {url} timed out after {timeout}s.")
