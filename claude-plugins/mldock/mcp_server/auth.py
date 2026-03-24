"""Session management — stores JWT token to ~/.mldock/session.json.

The password is NEVER stored. Only the JWT token, user info, and base URL are persisted.
All tools call get_token() to retrieve the current token before making API calls.
"""
import json
import os
import stat
from datetime import datetime, timezone
from typing import Optional

from .constants import SESSION_FILE


class AuthError(Exception):
    """Raised when no valid session exists."""


def load_session() -> Optional[dict]:
    """Read session from disk. Returns None if missing or unreadable."""
    try:
        if SESSION_FILE.exists():
            data = json.loads(SESSION_FILE.read_text(encoding="utf-8"))
            if data.get("token") and data.get("base_url"):
                return data
    except Exception:
        pass
    return None


def save_session(token: str, user: dict, base_url: str) -> None:
    """Persist session to disk with restricted permissions (owner read/write only)."""
    SESSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "token": token,
        "base_url": base_url.rstrip("/"),
        "user": user,
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }
    SESSION_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    # Restrict to owner only: -rw-------
    SESSION_FILE.chmod(stat.S_IRUSR | stat.S_IWUSR)


def clear_session() -> None:
    """Delete the session file (e.g. on 401)."""
    try:
        SESSION_FILE.unlink(missing_ok=True)
    except Exception:
        pass


def get_token() -> str:
    """Return current JWT token or raise AuthError."""
    session = load_session()
    if not session:
        raise AuthError(
            "Not logged in. Use the mldock_login tool or run /mldock-login to authenticate."
        )
    return session["token"]


def get_base_url() -> str:
    """Return base URL from session, falling back to env/default."""
    from .constants import DEFAULT_BASE_URL
    session = load_session()
    return session["base_url"] if session else DEFAULT_BASE_URL
