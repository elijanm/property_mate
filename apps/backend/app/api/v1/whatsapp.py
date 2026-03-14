"""WhatsApp Notifications — instance management + webhook receiver."""
from typing import Any, Dict, List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

logger = structlog.get_logger(__name__)

from app.core.s3 import generate_presigned_url
from app.dependencies.auth import CurrentUser, get_current_user, require_roles
from app.models.whatsapp_event import WhatsAppEvent
from app.models.whatsapp_instance import WhatsAppInstance
from app.repositories.whatsapp_event_repository import whatsapp_event_repository
from app.services import whatsapp_service

# ── Schemas ──────────────────────────────────────────────────────────────────

class CreateInstanceRequest(BaseModel):
    property_id: str
    name: str


class InstanceResponse(BaseModel):
    id: str
    org_id: str
    property_id: str
    name: str
    status: str
    phone_number: Optional[str]
    push_name: Optional[str]
    qr_code: Optional[str]
    created_at: str
    updated_at: str

    @classmethod
    def from_doc(cls, doc: WhatsAppInstance) -> "InstanceResponse":
        return cls(
            id=str(doc.id),
            org_id=doc.org_id,
            property_id=doc.property_id,
            name=doc.name,
            status=doc.status,
            phone_number=doc.phone_number,
            push_name=doc.push_name,
            qr_code=doc.qr_code,
            created_at=doc.created_at.isoformat(),
            updated_at=doc.updated_at.isoformat(),
        )


class EventResponse(BaseModel):
    id: str
    instance_id: str
    event_type: str
    payload: Dict[str, Any]
    media_url: Optional[str] = None
    media_content_type: Optional[str] = None
    received_at: str

    @classmethod
    async def from_doc(cls, doc: WhatsAppEvent) -> "EventResponse":
        media_url: Optional[str] = None
        if doc.media_key:
            try:
                media_url = await generate_presigned_url(doc.media_key)
            except Exception:
                pass
        return cls(
            id=str(doc.id),
            instance_id=doc.instance_id,
            event_type=doc.event_type,
            payload=doc.payload,
            media_url=media_url,
            media_content_type=doc.media_content_type,
            received_at=doc.received_at.isoformat(),
        )


# ── Instance management router ───────────────────────────────────────────────

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])


@router.get(
    "/instances",
    response_model=List[InstanceResponse],
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_instances(
    property_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> List[InstanceResponse]:
    instances = await whatsapp_service.list_instances(property_id, current_user)
    return [InstanceResponse.from_doc(i) for i in instances]


@router.post(
    "/instances",
    response_model=InstanceResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def create_instance(
    req: CreateInstanceRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> InstanceResponse:
    try:
        instance = await whatsapp_service.create_instance(req.property_id, req.name, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return InstanceResponse.from_doc(instance)


@router.get(
    "/instances/{instance_id}",
    response_model=InstanceResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_instance(
    instance_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> InstanceResponse:
    from app.repositories.whatsapp_instance_repository import whatsapp_instance_repository
    instance = await whatsapp_instance_repository.get_by_id(instance_id, current_user.org_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Instance not found")
    return InstanceResponse.from_doc(instance)


@router.post(
    "/instances/{instance_id}/connect",
    response_model=InstanceResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def connect_instance(
    instance_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> InstanceResponse:
    try:
        instance = await whatsapp_service.connect_instance(instance_id, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return InstanceResponse.from_doc(instance)


@router.get(
    "/instances/{instance_id}/qr",
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_qr(
    instance_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, Any]:
    try:
        qr = await whatsapp_service.get_qr(instance_id, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"qr_code": qr}


@router.post(
    "/instances/{instance_id}/disconnect",
    response_model=InstanceResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def disconnect_instance(
    instance_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> InstanceResponse:
    try:
        instance = await whatsapp_service.disconnect_instance(instance_id, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return InstanceResponse.from_doc(instance)


@router.post(
    "/instances/{instance_id}/logout",
    response_model=InstanceResponse,
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def logout_instance(
    instance_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> InstanceResponse:
    try:
        instance = await whatsapp_service.logout_instance(instance_id, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return InstanceResponse.from_doc(instance)


@router.delete(
    "/instances/{instance_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles("owner", "superadmin"))],
)
async def delete_instance(
    instance_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    try:
        await whatsapp_service.delete_instance(instance_id, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get(
    "/instances/{instance_id}/events",
    response_model=List[EventResponse],
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def list_events(
    instance_id: str,
    limit: int = 100,
    skip: int = 0,
    current_user: CurrentUser = Depends(get_current_user),
) -> List[EventResponse]:
    import asyncio
    events = await whatsapp_event_repository.list_by_instance(
        instance_id, current_user.org_id, limit=limit, skip=skip
    )
    return await asyncio.gather(*[EventResponse.from_doc(e) for e in events])


# ── Interaction schemas ───────────────────────────────────────────────────────

class CheckNumberRequest(BaseModel):
    phone: str

class MarkReadRequest(BaseModel):
    id: List[str]
    chat: str  # JID e.g. "254700000000@s.whatsapp.net"

class ReactRequest(BaseModel):
    id: str
    chat: str
    reaction: str  # emoji e.g. "👍"; empty string to remove reaction

class SendTextRequest(BaseModel):
    phone: str
    body: str
    id: Optional[str] = None

class SendMediaRequest(BaseModel):
    """Generic media send — caller sets the relevant field (image/audio/video/document)."""
    phone: str
    caption: Optional[str] = None
    filename: Optional[str] = None
    # Pass media as base64 string or public URL — one of the following:
    image: Optional[str] = None
    audio: Optional[str] = None
    video: Optional[str] = None
    document: Optional[str] = None
    id: Optional[str] = None

class SendButtonsRequest(BaseModel):
    phone: str
    content: str
    footer: Optional[str] = None
    buttons: List[Dict[str, Any]]
    id: Optional[str] = None

class SendListRequest(BaseModel):
    phone: str
    title: str
    text: str
    button_text: str
    sections: List[Dict[str, Any]]
    id: Optional[str] = None

class SendPollRequest(BaseModel):
    phone: str
    question: str
    options: List[str]
    max_answer: int = 1
    id: Optional[str] = None

class SetPresenceRequest(BaseModel):
    phone: str
    presence: str  # composing | paused | available | unavailable | recording


def _build_send_body(req: BaseModel) -> Dict[str, Any]:
    """Convert snake_case request model to PascalCase WuzAPI body."""
    mapping = {
        "phone": "Phone", "body": "Body", "id": "Id",
        "caption": "Caption", "filename": "FileName",
        "image": "Image", "audio": "Audio", "video": "Video", "document": "Document",
        "content": "Content", "footer": "Footer", "buttons": "Buttons",
        "title": "Title", "text": "Text", "button_text": "ButtonText", "sections": "Sections",
        "question": "Question", "options": "Options", "max_answer": "MaxAnswer",
        "presence": "Presence",
    }
    return {
        mapping[k]: v
        for k, v in req.model_dump(exclude_none=True).items()
        if k in mapping
    }


# ── Interaction routes ────────────────────────────────────────────────────────

@router.post(
    "/instances/{instance_id}/check-number",
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def check_number(
    instance_id: str,
    req: CheckNumberRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, Any]:
    try:
        return await whatsapp_service.check_number(instance_id, req.phone, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post(
    "/instances/{instance_id}/user-info",
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def get_user_info(
    instance_id: str,
    req: CheckNumberRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, Any]:
    try:
        return await whatsapp_service.get_user_info(instance_id, req.phone, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post(
    "/instances/{instance_id}/mark-read",
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def mark_read(
    instance_id: str,
    req: MarkReadRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, Any]:
    try:
        return await whatsapp_service.mark_read(
            instance_id,
            {"Id": req.id, "Chat": req.chat},
            current_user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post(
    "/instances/{instance_id}/react",
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def react(
    instance_id: str,
    req: ReactRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, Any]:
    try:
        return await whatsapp_service.react(
            instance_id,
            {"Id": req.id, "Chat": req.chat, "Reaction": req.reaction},
            current_user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post(
    "/instances/{instance_id}/send/text",
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def send_text(
    instance_id: str,
    req: SendTextRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, Any]:
    try:
        return await whatsapp_service.send_text(instance_id, _build_send_body(req), current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post(
    "/instances/{instance_id}/send/image",
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def send_image(
    instance_id: str,
    req: SendMediaRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, Any]:
    try:
        return await whatsapp_service.send_image(instance_id, _build_send_body(req), current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post(
    "/instances/{instance_id}/send/audio",
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def send_audio(
    instance_id: str,
    req: SendMediaRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, Any]:
    try:
        return await whatsapp_service.send_audio(instance_id, _build_send_body(req), current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post(
    "/instances/{instance_id}/send/document",
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def send_document(
    instance_id: str,
    req: SendMediaRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, Any]:
    try:
        return await whatsapp_service.send_document(instance_id, _build_send_body(req), current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post(
    "/instances/{instance_id}/send/video",
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def send_video(
    instance_id: str,
    req: SendMediaRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, Any]:
    try:
        return await whatsapp_service.send_video(instance_id, _build_send_body(req), current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post(
    "/instances/{instance_id}/send/buttons",
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def send_buttons(
    instance_id: str,
    req: SendButtonsRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, Any]:
    try:
        return await whatsapp_service.send_buttons(instance_id, _build_send_body(req), current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post(
    "/instances/{instance_id}/send/list",
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def send_list(
    instance_id: str,
    req: SendListRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, Any]:
    try:
        return await whatsapp_service.send_list(instance_id, _build_send_body(req), current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post(
    "/instances/{instance_id}/send/poll",
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def send_poll(
    instance_id: str,
    req: SendPollRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, Any]:
    try:
        return await whatsapp_service.send_poll(instance_id, _build_send_body(req), current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post(
    "/instances/{instance_id}/presence",
    dependencies=[Depends(require_roles("owner", "agent", "superadmin"))],
)
async def set_presence(
    instance_id: str,
    req: SetPresenceRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> Dict[str, Any]:
    try:
        return await whatsapp_service.set_presence(instance_id, _build_send_body(req), current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# ── Webhook receiver ─────────────────────────────────────────────────────────

webhook_router = APIRouter(prefix="/webhooks", tags=["whatsapp-webhook"])


@webhook_router.post("/whatsapp/{webhook_token}", include_in_schema=False)
async def receive_whatsapp_webhook(
    webhook_token: str,
    request: Request,
) -> Dict[str, str]:
    """Public endpoint — no auth. Receives events from WuzAPI."""
    import asyncio
    import json as _json

    body = await request.body()
    content_type = request.headers.get("content-type", "")
    logger.info("whatsapp_webhook_received",
                webhook_token=webhook_token,
                content_type=content_type,
                body_len=len(body),
                body_preview=body[:300].decode("utf-8", errors="replace"))

    payload: dict = {}
    try:
        if "application/json" in content_type:
            payload = _json.loads(body) if body else {}
        else:
            # WuzAPI sends application/x-www-form-urlencoded with fields:
            #   instanceName=<token>&jsonData=<url-encoded-json>&userID=<id>
            from urllib.parse import parse_qs, unquote_plus
            form = parse_qs(body.decode("utf-8", errors="replace"))
            json_data_list = form.get("jsonData", [])
            if json_data_list:
                payload = _json.loads(json_data_list[0])
            else:
                # fallback: try raw JSON anyway
                payload = _json.loads(body) if body else {}
    except Exception as exc:
        logger.warning("whatsapp_webhook_parse_failed",
                       webhook_token=webhook_token,
                       exc_info=exc)
        payload = {}

    # Fire-and-forget processing (don't block WuzAPI's webhook call)
    asyncio.create_task(whatsapp_service.process_webhook(webhook_token, payload))
    return {"ok": "true"}
