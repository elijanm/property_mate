"""Pipecat voice pipeline for a single call session.

Architecture:
    WebSocket (Telnyx) ─► TelnyxSerializer ─► VAD ─► Deepgram STT
                                ▲                           │
                                │                   LLM Context Aggregator
                                │                           │
                  TTS (configurable) ◄── LLM (configurable, with tools)
                                                            │
                                                     ToolExecutor

One pipeline instance per call; it runs until the WebSocket closes or an
EndFrame is emitted (e.g. by the hangup/transfer tool).
"""
import asyncio
import json
import time
import structlog
from fastapi import WebSocket

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    AudioRawFrame,
    EndFrame,
    InputAudioRawFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    StartFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from pipecat.services.deepgram.stt import DeepgramSTTService, LiveOptions
from pipecat.services.llm_service import FunctionCallParams
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)

from app.agent.llm_factory import create_llm_service
from app.agent.prompts import build_system_prompt, get_initial_greeting
from app.agent.tools import TOOL_DEFINITIONS, ToolExecutor
from app.core.config import settings
from app.core.database import get_db
from app.models.conversation import (
    CallSessionDocument,
    make_tool_call_record,
    make_transcript_turn,
)
from app.core import active_calls as _active_calls
from app.services import api_logger
from app.services.notification import (
    notify_call_ended,
    notify_call_updated,
    notify_keyword_alert,
    notify_unresolved_call,
)
from app.services.recording import CallRecorder
from app.telnyx_utils.browser_serializer import BrowserFrameSerializer
from app.telnyx_utils.serializer import TelnyxFrameSerializer

# Keywords that warrant an immediate dashboard alert
_LEGAL_KEYWORDS = frozenset([
    "lawyer", "attorney", "court", "sue", "lawsuit", "legal action",
    "police", "evict", "eviction", "hdrc", "arbitration", "tribunal",
    "consumer protection", "ombudsman", "report you",
])

logger = structlog.get_logger(__name__)


class _AudioRecorderProcessor(FrameProcessor):
    """Passthrough processor that feeds inbound PCM into CallRecorder."""

    def __init__(self, recorder: "CallRecorder") -> None:
        super().__init__()
        self._recorder = recorder
        self._pipe_started = False

    async def process_frame(self, frame, direction: FrameDirection) -> None:
        # Control frames: let super() handle state transitions.
        # For StartFrame, super() sets the base-class __started flag (required
        # by push_frame's _check_started guard). We must NOT return early here —
        # we fall through to push_frame below so downstream processors also
        # receive StartFrame and initialize themselves.
        if isinstance(frame, (StartFrame, EndFrame)):
            if isinstance(frame, StartFrame):
                self._pipe_started = True
            await super().process_frame(frame, direction)
            # Fall through to push_frame — StartFrame/EndFrame must propagate.

        # Record inbound PCM regardless of started state.
        if isinstance(frame, InputAudioRawFrame):
            self._recorder.add_inbound(frame.audio)

        # Only push after StartFrame so _check_started sees __started=True.
        # Pre-start frames (early audio, VAD events) are dropped silently.
        if self._pipe_started:
            await self.push_frame(frame, direction)


def _create_tts_service(cfg: dict, sample_rate: int = 8000):
    """Create TTS service.  Values in *cfg* (InstalledApp.config) win over env."""
    provider = cfg.get("tts_provider") or settings.TTS_PROVIDER

    if provider == "elevenlabs":
        from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
        return ElevenLabsTTSService(
            api_key=cfg.get("elevenlabs_api_key") or settings.ELEVENLABS_API_KEY,
            voice_id=cfg.get("tts_voice") or settings.ELEVENLABS_VOICE_ID,
            model=cfg.get("elevenlabs_model") or settings.ELEVENLABS_MODEL,
            sample_rate=sample_rate,
        )
    if provider == "deepgram":
        from pipecat.services.deepgram.tts import DeepgramTTSService
        return DeepgramTTSService(
            api_key=cfg.get("deepgram_api_key") or settings.DEEPGRAM_API_KEY,
            voice=cfg.get("tts_voice") or settings.DEEPGRAM_TTS_VOICE,
            sample_rate=sample_rate,
        )
    from pipecat.services.openai.tts import OpenAITTSService
    return OpenAITTSService(
        api_key=cfg.get("llm_api_key") or settings.LLM_API_KEY,
        voice=cfg.get("tts_voice") or settings.OPENAI_TTS_VOICE,
        model=settings.OPENAI_TTS_MODEL,
        sample_rate=sample_rate,
    )


class _MetricsCapture(FrameProcessor):
    """Passthrough that tallies LLM token usage, TTS chars, and assistant turns."""

    def __init__(self, on_assistant_turn=None) -> None:
        super().__init__()
        self.prompt_tokens: int = 0
        self.completion_tokens: int = 0
        self.tts_chars: int = 0
        self._pipe_started = False
        self._on_assistant_turn = on_assistant_turn
        self._current_turn_chunks: list[str] = []

    async def process_frame(self, frame, direction: FrameDirection) -> None:
        # Control frames: super() handles state (StartFrame sets __started).
        # Fall through so StartFrame/EndFrame are also forwarded downstream.
        if isinstance(frame, (StartFrame, EndFrame)):
            if isinstance(frame, StartFrame):
                self._pipe_started = True
            await super().process_frame(frame, direction)
            # Fall through to push_frame — StartFrame/EndFrame must propagate.

        # Collect metrics (best-effort — never block frame propagation)
        try:
            from pipecat.frames.frames import MetricsFrame, TextFrame  # type: ignore
            from pipecat.metrics.metrics import LLMUsageMetricsData  # type: ignore
            if isinstance(frame, MetricsFrame):
                for metric in (frame.data or []):
                    if isinstance(metric, LLMUsageMetricsData):
                        self.prompt_tokens += metric.value.prompt_tokens
                        self.completion_tokens += metric.value.completion_tokens
            if isinstance(frame, LLMFullResponseStartFrame):
                self._current_turn_chunks = []
            if isinstance(frame, TextFrame) and direction == FrameDirection.DOWNSTREAM:
                self.tts_chars += len(frame.text or "")
                if frame.text:
                    self._current_turn_chunks.append(frame.text)
            if isinstance(frame, LLMFullResponseEndFrame) and self._on_assistant_turn:
                full_text = "".join(self._current_turn_chunks).strip()
                if full_text:
                    await self._on_assistant_turn(full_text)
                self._current_turn_chunks = []
        except Exception:
            pass

        # Only push after StartFrame so _check_started sees __started=True.
        # Pre-start frames are dropped silently.
        if self._pipe_started:
            await self.push_frame(frame, direction)


class _TranscriptCapture(FrameProcessor):
    """Captures final STT TranscriptionFrame and calls an async callback."""

    def __init__(self, on_transcript) -> None:
        super().__init__()
        self._on_transcript = on_transcript
        self._pipe_started = False

    async def process_frame(self, frame, direction: FrameDirection) -> None:
        if isinstance(frame, (StartFrame, EndFrame)):
            if isinstance(frame, StartFrame):
                self._pipe_started = True
            await super().process_frame(frame, direction)
            # Fall through to push_frame.

        # Capture final user transcriptions (best-effort).
        try:
            from pipecat.frames.frames import TranscriptionFrame  # type: ignore
            if isinstance(frame, TranscriptionFrame) and frame.text and frame.text.strip():
                await self._on_transcript(frame.text.strip())
        except Exception:
            pass

        if self._pipe_started:
            await self.push_frame(frame, direction)


class _OutboundAudioRecorder(FrameProcessor):
    """Captures outbound AudioRawFrame (TTS output) into the CallRecorder."""

    def __init__(self, recorder: "CallRecorder") -> None:
        super().__init__()
        self._recorder = recorder
        self._pipe_started = False

    async def process_frame(self, frame, direction: FrameDirection) -> None:
        if isinstance(frame, (StartFrame, EndFrame)):
            if isinstance(frame, StartFrame):
                self._pipe_started = True
            await super().process_frame(frame, direction)
            # Fall through to push_frame.

        # Capture outbound PCM (agent TTS).
        if isinstance(frame, AudioRawFrame) and not isinstance(frame, InputAudioRawFrame):
            self._recorder.add_outbound(frame.audio)

        if self._pipe_started:
            await self.push_frame(frame, direction)


def _estimate_cost(
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    tts_chars: int,
    tts_provider: str,
    duration_seconds: int,
) -> dict:
    """Return a cost breakdown dict (USD) based on token counts and call duration."""
    m = model.lower()
    # LLM cost — USD per million tokens
    if "gpt-4o-mini" in m:
        pr, cr = 0.15, 0.60
    elif "gpt-4o" in m or "gpt4o" in m:
        pr, cr = 2.50, 10.00
    elif "claude-3-5-sonnet" in m or "claude-sonnet-4" in m or "claude-sonnet" in m:
        pr, cr = 3.00, 15.00
    elif "claude-3-haiku" in m or "claude-haiku" in m:
        pr, cr = 0.25, 1.25
    elif "claude-3-opus" in m or "claude-opus" in m:
        pr, cr = 15.00, 75.00
    else:
        pr, cr = 2.50, 10.00  # conservative default

    llm_cost = (prompt_tokens * pr + completion_tokens * cr) / 1_000_000

    # TTS cost — USD per character
    if tts_provider == "elevenlabs":
        tts_cost = tts_chars * 0.00003   # ~$0.30 per 10 K chars (Turbo v2.5)
    elif tts_provider == "deepgram":
        tts_cost = tts_chars * 0.000015  # $15 per 1 M chars
    else:
        tts_cost = tts_chars * 0.000015  # OpenAI TTS-1: $15/1 M chars

    # STT cost — Deepgram Nova-2 phone: $0.0059 / min
    stt_minutes = duration_seconds / 60
    stt_cost = stt_minutes * 0.0059

    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
        "tts_characters": tts_chars,
        "stt_minutes": round(stt_minutes, 2),
        "llm_cost_usd": round(llm_cost, 6),
        "tts_cost_usd": round(tts_cost, 6),
        "stt_cost_usd": round(stt_cost, 6),
        "total_cost_usd": round(llm_cost + tts_cost + stt_cost, 6),
    }


async def _generate_summary_and_sentiment(
    transcript_turns: list[dict],
    actions_taken: list[str],
    cfg: dict,
) -> tuple[str | None, str | None]:
    """Call the LLM to generate a post-call summary and sentiment label."""
    import httpx as _httpx

    # Build a compact transcript text (last 30 turns max)
    turns_text = "\n".join(
        f"{t['role'].upper()}: {t['content']}"
        for t in transcript_turns[-30:]
        if t.get("content")
    )
    actions_text = "\n".join(f"- {a}" for a in actions_taken) if actions_taken else "None"

    prompt = (
        "You are a call-centre analyst. Summarise the following voice call transcript in 2-3 sentences. "
        "Then on a new line output exactly one word: 'positive', 'neutral', or 'negative' to describe the caller's sentiment.\n\n"
        f"TRANSCRIPT:\n{turns_text}\n\nACTIONS TAKEN:\n{actions_text}\n\n"
        "Output format:\nSUMMARY: <summary text>\nSENTIMENT: <positive|neutral|negative>"
    )

    provider = cfg.get("llm_provider") or settings.LLM_PROVIDER
    api_key = cfg.get("llm_api_key") or settings.LLM_API_KEY
    model = cfg.get("llm_model") or settings.LLM_MODEL
    # Strip whitespace — LLM_BASE_URL in .env is often set to "   " (spaces + inline comment)
    # which is truthy but not a valid URL; fall back to the provider default in that case.
    _raw_base = (cfg.get("llm_base_url") or settings.LLM_BASE_URL or "").strip()
    base_url = _raw_base or "https://api.openai.com/v1"

    if provider == "anthropic":
        base_url = "https://api.anthropic.com/v1"

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    if provider == "anthropic":
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

    try:
        async with _httpx.AsyncClient(timeout=20) as client:
            if provider == "anthropic":
                resp = await client.post(
                    f"{base_url}/messages",
                    headers=headers,
                    json={
                        "model": model,
                        "max_tokens": 256,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                )
            else:
                resp = await client.post(
                    f"{base_url}/chat/completions",
                    headers=headers,
                    json={
                        "model": model,
                        "max_tokens": 256,
                        "temperature": 0.3,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                )
            resp.raise_for_status()
            data = resp.json()

        if provider == "anthropic":
            text = (data.get("content") or [{}])[0].get("text", "")
        else:
            text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")

        summary: str | None = None
        sentiment: str | None = None
        for line in text.splitlines():
            line = line.strip()
            if line.upper().startswith("SUMMARY:"):
                summary = line[len("SUMMARY:"):].strip()
            elif line.upper().startswith("SENTIMENT:"):
                raw = line[len("SENTIMENT:"):].strip().lower()
                if raw in ("positive", "neutral", "negative"):
                    sentiment = raw
        return summary, sentiment
    except Exception as exc:
        logger.warning("summary_generation_failed", error=str(exc))
        return None, None


async def run_call_pipeline(
    *,
    websocket: WebSocket,
    call_control_id: str,
    caller_number: str,
    org_id: str | None,
    session_doc: dict,          # pre-built session document (already inserted)
    tenant_info: dict | None,   # pre-fetched tenant (may be None)
    lease_info: dict | None,
    open_tickets: list[dict],
    auto_mode: bool,
    browser_mode: bool = False,
    recording_enabled: bool = False,
    app_config: dict | None = None,  # InstalledApp.config from MongoDB (overrides .env)
) -> None:
    """Run the full Pipecat pipeline for one call. Blocks until the call ends."""
    db = get_db()
    session_id: str = session_doc["_id"]
    start_time = time.monotonic()

    # ── API call audit logging ────────────────────────────────────────────────
    api_logger.init_call_log()

    # ── Recording ────────────────────────────────────────────────────────────
    sample_rate = 16000 if browser_mode else 8000
    recorder = CallRecorder(
        call_control_id, org_id,
        enabled=recording_enabled,
        sample_rate=sample_rate,
    )

    # ── Shared mutable state ──────────────────────────────────────────────────
    transcript_turns: list[dict] = []
    tool_calls_record: list[dict] = []
    actions_taken: list[str] = []

    # ── Tool executor ─────────────────────────────────────────────────────────
    executor = ToolExecutor(
        call_control_id=call_control_id,
        org_id=org_id,
        caller_number=caller_number,
        actions_taken=actions_taken,
    )

    # ── WhatsApp background check ──────────────────────────────────────────────
    # Fire-and-forget: check if caller is on WA while the greeting plays.
    # _wa_available is set on executor; system prompt is rebuilt with it after check.
    import asyncio as _asyncio
    _wa_check_task = _asyncio.create_task(executor.check_whatsapp_availability())

    # ── App config (MongoDB) overrides env settings ────────────────────────────
    cfg: dict = app_config or {}
    company_name: str | None = cfg.get("company_name") or None
    agent_name: str | None = cfg.get("agent_name") or None

    # ── System prompt ─────────────────────────────────────────────────────────
    balance_due: float | None = None
    if tenant_info:
        balance_due = session_doc.get("balance_due")

    # Pass the caller's phone only when it's a real number (not the browser placeholder)
    known_phone = caller_number if caller_number and caller_number != "browser-sandbox" else None

    def _build_prompt() -> str:
        return build_system_prompt(
            tenant_name=tenant_info.get("name") if tenant_info else None,
            balance_due=balance_due,
            open_tickets=open_tickets,
            lease_info=lease_info,
            org_name=company_name,
            agent_name=agent_name,
            caller_phone=known_phone if not tenant_info else None,
            whatsapp_available=bool(executor._wa_instance_id),
        )

    system_prompt = _build_prompt()

    # Once the WA check resolves, refresh the system prompt in the LLM context
    async def _refresh_prompt_after_wa_check() -> None:
        try:
            await _wa_check_task
        except Exception:
            pass
        if executor._wa_instance_id:
            refreshed = _build_prompt()
            # Update the system message in the LLM context so the agent knows WA is available
            context.set_messages([
                {"role": "system", "content": refreshed},
                *[m for m in context.get_messages() if m.get("role") != "system"],
            ])

    # ── Pipecat services ──────────────────────────────────────────────────────
    serializer = BrowserFrameSerializer() if browser_mode else TelnyxFrameSerializer()

    # Browser calls use a longer VAD stop_secs to avoid echo from speakers being
    # mistaken for speech start and immediately interrupting the AI.
    # Telnyx phone calls use a tighter value for natural barge-in feel.
    vad_stop_secs = 1.5 if browser_mode else 0.8

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            audio_in_passthrough=True,
            vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=vad_stop_secs)),
            serializer=serializer,
        ),
    )

    stt_encoding = "linear16" if browser_mode else "mulaw"
    stt_sample_rate = 16000 if browser_mode else 8000
    stt = DeepgramSTTService(
        api_key=cfg.get("deepgram_api_key") or settings.DEEPGRAM_API_KEY,
        sample_rate=stt_sample_rate,
        live_options=LiveOptions(
            model=settings.DEEPGRAM_STT_MODEL,
            language=settings.DEEPGRAM_STT_LANGUAGE,
            smart_format=True,
            encoding=stt_encoding,
            channels=1,
        ),
    )

    llm = create_llm_service(cfg)
    tts_sample_rate = 16000 if browser_mode else 8000
    tts = _create_tts_service(cfg, sample_rate=tts_sample_rate)

    # ── LLM context ───────────────────────────────────────────────────────────
    tenant_greeting_name = tenant_info.get("name") if tenant_info else None
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": get_initial_greeting(
            company_name=company_name, agent_name=agent_name, tenant_name=tenant_greeting_name
        )},
    ]
    context = OpenAILLMContext(messages=messages, tools=TOOL_DEFINITIONS)
    context_aggregator = llm.create_context_aggregator(context)

    # Schedule prompt refresh once WA check resolves (context is now available)
    _asyncio.create_task(_refresh_prompt_after_wa_check())

    # ── Tool call handler (new FunctionCallParams API) ────────────────────────
    transfer_requested = False

    async def handle_function(params: FunctionCallParams) -> None:
        nonlocal transfer_requested
        logger.info(
            "tool_call",
            action=params.function_name,
            resource_type="call_session",
            resource_id=session_id,
            org_id=org_id,
        )
        args_dict = dict(params.arguments) if params.arguments else {}
        result_str = await executor.execute(params.function_name, args_dict)
        result_dict = json.loads(result_str)

        tool_calls_record.append(
            make_tool_call_record(params.function_name, args_dict, result_dict)
        )
        await db[CallSessionDocument.COLLECTION].update_one(
            {"_id": session_id},
            {"$push": {"tool_calls": tool_calls_record[-1]}},
        )

        if auto_mode and org_id:
            recent = " | ".join(
                t["content"] for t in transcript_turns[-4:] if t["role"] == "assistant"
            )
            await notify_call_updated(
                org_id=org_id,
                call_control_id=call_control_id,
                transcript=recent,
            )

        if params.function_name == "transfer_to_human" and result_dict.get("transferred"):
            transfer_requested = True

        await params.result_callback(result_str)

    # Register as catch-all handler (None matches any function name)
    llm.register_function(None, handle_function)

    # ── Transcript capture + keyword alerting via TranscriptionFrame ──────────
    # (on_utterance_end only fires when vad_events=True in Deepgram options;
    #  we use Silero VAD instead, so we capture TranscriptionFrame in-pipeline.)

    keyword_alerts: list[dict] = []

    async def _on_user_transcript(text: str) -> None:
        turn = make_transcript_turn("user", text)
        transcript_turns.append(turn)
        await db[CallSessionDocument.COLLECTION].update_one(
            {"_id": session_id},
            {"$push": {"transcript": turn}},
        )
        # Keyword alerting — fire WS notification on legal/risk phrases
        if auto_mode and org_id:
            text_lower = text.lower()
            for kw in _LEGAL_KEYWORDS:
                if kw in text_lower:
                    alert = {
                        "keyword": kw,
                        "context": text[:200],
                        "timestamp": turn["timestamp"],
                    }
                    keyword_alerts.append(alert)
                    await db[CallSessionDocument.COLLECTION].update_one(
                        {"_id": session_id},
                        {"$push": {"keyword_alerts": alert}},
                    )
                    await notify_keyword_alert(
                        org_id=org_id,
                        call_control_id=call_control_id,
                        keyword=kw,
                        context=text,
                    )
                    break  # one alert per utterance is enough

    transcript_capture = _TranscriptCapture(_on_user_transcript)

    # ── Assistant turn capture ─────────────────────────────────────────────────
    async def _on_assistant_turn(text: str) -> None:
        turn = make_transcript_turn("assistant", text)
        transcript_turns.append(turn)
        await db[CallSessionDocument.COLLECTION].update_one(
            {"_id": session_id},
            {"$push": {"transcript": turn}},
        )

    # ── Metrics capture ───────────────────────────────────────────────────────
    metrics_capture = _MetricsCapture(on_assistant_turn=_on_assistant_turn)

    # ── Pipeline ───────────────────────────────────────────────────────────────
    pipeline_stages = [transport.input()]
    if recording_enabled:
        pipeline_stages.append(_AudioRecorderProcessor(recorder))  # inbound audio
    pipeline_stages += [
        stt,
        transcript_capture,      # captures TranscriptionFrame for user turns
        context_aggregator.user(),
        llm,
        metrics_capture,
        tts,
    ]
    if recording_enabled:
        pipeline_stages.append(_OutboundAudioRecorder(recorder))   # outbound TTS audio
    pipeline_stages += [
        transport.output(),
        context_aggregator.assistant(),
    ]
    pipeline = Pipeline(pipeline_stages)

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            allow_interruptions=True,
            enable_metrics=True,
            enable_usage_metrics=True,   # enables LLM token + TTS char MetricsFrames
        ),
    )

    logger.info(
        "pipeline_started",
        action="run_call_pipeline",
        resource_type="call_session",
        resource_id=session_id,
        org_id=org_id,
        caller=caller_number,
        auto_mode=auto_mode,
        status="started",
    )

    # ── Run (blocks until call ends) ──────────────────────────────────────────
    _active_calls.register(call_control_id, task)
    runner = PipelineRunner()
    try:
        await runner.run(task)
    except Exception as exc:
        logger.error(
            "pipeline_error",
            action="run_call_pipeline",
            resource_id=session_id,
            error=str(exc),
            status="error",
        )
    finally:
        duration = int(time.monotonic() - start_time)

        recording_key = await recorder.finalise()

        # ── Post-call AI analysis ──────────────────────────────────────────────
        summary: str | None = None
        sentiment: str | None = None
        quality_score: int | None = None

        if transcript_turns:
            try:
                summary, sentiment = await _generate_summary_and_sentiment(
                    transcript_turns=transcript_turns,
                    actions_taken=actions_taken,
                    cfg=cfg,
                )
            except Exception as exc:
                logger.warning("post_call_analysis_failed", error=str(exc))

        # Quality score: 0–100
        # Base 50; +20 if duration > 60s (real conversation); +20 if actions taken;
        # +10 if no transfer; -30 if duration < 15s (caller hung up immediately)
        try:
            score = 50
            if duration > 60:
                score += 20
            elif duration < 15:
                score -= 30
            if actions_taken:
                score += 20
            if not transfer_requested:
                score += 10
            quality_score = max(0, min(100, score))
        except Exception:
            pass

        status = "transferred" if transfer_requested else "completed"
        await db[CallSessionDocument.COLLECTION].update_one(
            {"_id": session_id},
            CallSessionDocument.end_update(
                status=status,
                duration_seconds=duration,
                summary=summary,
                sentiment=sentiment,
                quality_score=quality_score,
                recording_key=recording_key,
                actions_taken=actions_taken,
            ),
        )

        # Unresolved call alert — short call with no actions and no summary
        if (
            org_id
            and auto_mode
            and not actions_taken
            and not transfer_requested
            and duration < 120
        ):
            try:
                await notify_unresolved_call(
                    org_id=org_id,
                    call_control_id=call_control_id,
                    caller_number=caller_number,
                    tenant_name=session_doc.get("tenant_name"),
                    duration_seconds=duration,
                )
            except Exception:
                pass

        # ── Compute and persist cost metrics ──────────────────────────────────
        try:
            cost_metrics = _estimate_cost(
                model=cfg.get("llm_model") or settings.LLM_MODEL,
                prompt_tokens=metrics_capture.prompt_tokens,
                completion_tokens=metrics_capture.completion_tokens,
                tts_chars=metrics_capture.tts_chars,
                tts_provider=cfg.get("tts_provider") or settings.TTS_PROVIDER,
                duration_seconds=duration,
            )
            await db[CallSessionDocument.COLLECTION].update_one(
                {"_id": session_id},
                {"$set": {"metrics": cost_metrics}},
            )
        except Exception as exc:
            logger.warning("metrics_save_failed", error=str(exc))

        # ── Persist API call audit log ─────────────────────────────────────
        try:
            captured_api_calls = api_logger.get_call_log()
            if captured_api_calls:
                await db[CallSessionDocument.COLLECTION].update_one(
                    {"_id": session_id},
                    {"$set": {"api_calls": captured_api_calls}},
                )
        except Exception as exc:
            logger.warning("api_calls_save_failed", error=str(exc))

        _active_calls.unregister(call_control_id)

        if org_id:
            await notify_call_ended(
                org_id=org_id,
                call_control_id=call_control_id,
                duration_seconds=duration,
                summary=summary,
                actions_taken=actions_taken,
            )

        logger.info(
            "pipeline_finished",
            action="run_call_pipeline",
            resource_id=session_id,
            duration_seconds=duration,
            quality_score=quality_score,
            status=status,
        )
