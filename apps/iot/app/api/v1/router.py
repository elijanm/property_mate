from fastapi import APIRouter
from app.api.v1 import (
    devices, device_types, gateways, commands, telemetry,
    ssh_requests, ssh_audit, tailscale, sync,
    quarantine, alert_rules, ota, fleets, console,
)
from app.api.v1.internal import emqx_hooks

api_router = APIRouter(prefix="/api/v1")

# Public API (require JWT)
api_router.include_router(devices.router)
api_router.include_router(device_types.router)
api_router.include_router(gateways.router)
api_router.include_router(commands.router)
api_router.include_router(telemetry.router)
api_router.include_router(ssh_requests.router)
api_router.include_router(ssh_audit.router)
api_router.include_router(tailscale.router)
api_router.include_router(sync.router)
api_router.include_router(quarantine.router)
api_router.include_router(alert_rules.router)
api_router.include_router(ota.router)
api_router.include_router(fleets.router)
api_router.include_router(console.router)  # WebSocket SSH console

# Internal (EMQX auth hooks — protected by X-Internal-Secret header)
api_router.include_router(emqx_hooks.router)
