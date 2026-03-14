"""
WebSocket SSH console proxy.

Accepts a WebSocket connection with JWT token (query param), then opens an
asyncssh PTY session to the device's Tailscale IP and bridges data.

Protocol:
  Binary WS frames from client → SSH stdin
  SSH stdout/stderr            → binary WS frames to client
  Text JSON from client        → {"type":"resize","cols":N,"rows":N}
  Text JSON from client        → {"type":"ping"}
"""
import asyncio
import json
from typing import Optional

import structlog
from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from jose import JWTError, jwt

from app.core.config import settings
from app.dependencies.auth import get_current_user, CurrentUser
from app.models.device import Device

try:
    import asyncssh
    _ASYNCSSH_OK = True
except ImportError:
    _ASYNCSSH_OK = False

_log = structlog.get_logger()
router = APIRouter(prefix="/devices", tags=["console"])


@router.get("/console-pubkey")
async def get_console_pubkey(current_user: CurrentUser = Depends(get_current_user)):
    """Return the IoT service SSH public key so devices can add it to authorized_keys."""
    from fastapi import HTTPException
    import os as _os
    pub_path = settings.ssh_console_key_path + ".pub"
    if not _os.path.exists(pub_path):
        raise HTTPException(status_code=404, detail="SSH console key not yet generated — restart the IoT service")
    return {"public_key": open(pub_path).read().strip(), "note": "Add this to /root/.ssh/authorized_keys on the device"}

_ANSI_RED    = "\x1b[31m"
_ANSI_YELLOW = "\x1b[33m"
_ANSI_GREEN  = "\x1b[32m"
_ANSI_RESET  = "\x1b[0m"


def _decode_token(token: str):
    """Return (user_id, org_id, role) or raise ValueError."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise ValueError(f"invalid token: {exc}") from exc
    user_id = payload.get("sub")
    org_id  = payload.get("org_id")
    role    = payload.get("role")
    if not user_id or not role:
        raise ValueError("token missing sub/role claims")
    if role != "superadmin" and not org_id:
        raise ValueError("token missing org_id")
    return user_id, org_id, role


async def _find_device(device_id: str) -> Optional[Device]:
    try:
        oid = PydanticObjectId(device_id)
        d = await Device.find_one({"_id": oid, "deleted_at": None})
        if d:
            return d
    except Exception:
        pass
    return await Device.find_one({
        "$or": [{"device_uid": device_id}, {"mqtt_client_id": device_id}],
        "deleted_at": None,
    })


@router.websocket("/{device_id}/console")
async def device_console(
    websocket: WebSocket,
    device_id: str,
    token: str = Query(...),
    cols: int = Query(default=80, ge=10, le=512),
    rows: int = Query(default=24, ge=4, le=256),
):
    """WebSocket SSH console proxy — bridges xterm.js to device SSH via Tailscale."""

    if not _ASYNCSSH_OK:
        await websocket.accept()
        await websocket.send_bytes(
            b"\r\nasyncssh is not installed on the IoT service.\r\n"
            b"Add 'asyncssh>=2.17.0' to pyproject.toml and rebuild.\r\n"
        )
        await websocket.close(code=1011)
        return

    # ── 1. Validate JWT ────────────────────────────────────────────────────
    try:
        user_id, org_id, role = _decode_token(token)
    except ValueError:
        await websocket.close(code=4401)
        return

    # ── 2. Find device ─────────────────────────────────────────────────────
    device = await _find_device(device_id)
    if not device:
        await websocket.close(code=4404)
        return

    if role != "superadmin" and device.org_id != org_id:
        await websocket.close(code=4403)
        return

    # ── 3. Require Tailscale IP ────────────────────────────────────────────
    if not device.tailscale_ip:
        await websocket.accept()
        await websocket.send_bytes(
            (
                f"\r\n{_ANSI_YELLOW}Device '{device.device_uid}' has no Tailscale/VPN IP.{_ANSI_RESET}\r\n"
                f"Register the device with Headscale and click '↺ Sync Tailscale' first.\r\n"
            ).encode()
        )
        await websocket.close(code=4003)
        return

    await websocket.accept()
    log = _log.bind(
        action="ssh_console",
        device_id=str(device.id),
        device_uid=device.device_uid,
        user_id=user_id,
        org_id=org_id,
        tailscale_ip=device.tailscale_ip,
    )
    log.info("ssh_console_connecting")

    # ── 4. Build asyncssh kwargs ───────────────────────────────────────────
    connect_kw: dict = dict(
        host=device.tailscale_ip,
        port=22,
        username=settings.ssh_console_username,
        known_hosts=None,       # trusted VPN network — skip host key verification
        connect_timeout=15,
    )
    if settings.ssh_console_key_path:
        connect_kw["client_keys"] = [settings.ssh_console_key_path]

    # ── 5. SSH connect + PTY ───────────────────────────────────────────────
    try:
        async with asyncssh.connect(**connect_kw) as conn:
            async with conn.create_process(
                term_type="xterm-256color",
                term_size=(cols, rows),
            ) as proc:
                log.info("ssh_console_established", status="active")
                await websocket.send_bytes(
                    f"{_ANSI_GREEN}Connected to {device.device_uid} ({device.tailscale_ip}){_ANSI_RESET}\r\n".encode()
                )

                async def _ws_to_ssh() -> None:
                    """Forward WebSocket frames to SSH stdin."""
                    try:
                        while True:
                            msg = await websocket.receive()
                            if msg["type"] == "websocket.disconnect":
                                break
                            raw_bytes = msg.get("bytes")
                            raw_text  = msg.get("text")
                            if raw_bytes:
                                proc.stdin.write(raw_bytes.decode("utf-8", errors="replace"))
                            elif raw_text:
                                try:
                                    cmd = json.loads(raw_text)
                                    if cmd.get("type") == "resize":
                                        proc.change_terminal_size(
                                            max(1, int(cmd.get("cols", 80))),
                                            max(1, int(cmd.get("rows", 24))),
                                        )
                                except (json.JSONDecodeError, ValueError, KeyError):
                                    proc.stdin.write(raw_text)
                    except Exception:
                        pass
                    finally:
                        try:
                            proc.stdin.write_eof()
                        except Exception:
                            pass

                async def _ssh_to_ws() -> None:
                    """Forward SSH stdout to WebSocket."""
                    try:
                        while True:
                            chunk = await proc.stdout.read(4096)
                            if not chunk:
                                break
                            data = chunk if isinstance(chunk, bytes) else chunk.encode("utf-8", errors="replace")
                            await websocket.send_bytes(data)
                    except Exception:
                        pass

                await asyncio.gather(_ws_to_ssh(), _ssh_to_ws(), return_exceptions=True)
                log.info("ssh_console_ended", status="completed")

    except asyncssh.DisconnectError as exc:
        _safe_send(websocket, f"\r\n{_ANSI_RED}SSH disconnected: {exc.reason}{_ANSI_RESET}\r\n")
    except (asyncssh.PermissionDenied, asyncssh.BadHostKeyError) as exc:
        _safe_send(websocket, f"\r\n{_ANSI_RED}SSH auth failed: {exc}{_ANSI_RESET}\r\n")
        log.warning("ssh_console_auth_failed", error=str(exc))
    except OSError as exc:
        _safe_send(websocket, f"\r\n{_ANSI_RED}Cannot reach {device.tailscale_ip}: {exc}{_ANSI_RESET}\r\n")
        log.warning("ssh_console_unreachable", error=str(exc))
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.error("ssh_console_error", error=str(exc))
        _safe_send(websocket, f"\r\n{_ANSI_RED}Error: {exc}{_ANSI_RESET}\r\n")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


def _safe_send(ws: WebSocket, msg: str) -> None:
    """Fire-and-forget best-effort send — used in error paths."""
    try:
        import asyncio as _asyncio
        loop = _asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(ws.send_bytes(msg.encode()))
    except Exception:
        pass
