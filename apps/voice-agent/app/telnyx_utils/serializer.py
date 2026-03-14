"""Telnyx media-stream WebSocket frame serializer for Pipecat.

Telnyx media streaming protocol:
  • Telnyx → us: JSON with event "start" | "media" | "stop"
  • us → Telnyx: JSON with event "media" containing base64-encoded mulaw audio

Audio format: 8 kHz, mono, μ-law (PCMU).  We decode to 16-bit PCM for the
Pipecat pipeline and re-encode to mulaw before sending back.
"""
import audioop
import base64
import json
from pipecat.frames.frames import AudioRawFrame, EndFrame, Frame, InputAudioRawFrame
from pipecat.serializers.base_serializer import FrameSerializer


class TelnyxFrameSerializer(FrameSerializer):
    """Convert between Telnyx WebSocket JSON messages and Pipecat audio frames."""

    def __init__(self, stream_sid: str = "", **kwargs) -> None:
        super().__init__(**kwargs)
        self._stream_sid = stream_sid

    # ── Pipecat → Telnyx (outbound TTS audio) ────────────────────────────────

    async def serialize(self, frame: Frame) -> str | bytes | None:  # type: ignore[override]
        """Convert a PCM AudioRawFrame to a Telnyx media JSON message."""
        if not isinstance(frame, AudioRawFrame):
            return None
        # Resample to 8 kHz if the TTS produces higher-rate audio
        pcm = frame.audio
        src_rate = frame.sample_rate
        if src_rate != 8000:
            pcm, _ = audioop.ratecv(pcm, 2, 1, src_rate, 8000, None)
        # Encode 16-bit PCM → mulaw
        mulaw = audioop.lin2ulaw(pcm, 2)
        payload = base64.b64encode(mulaw).decode("utf-8")
        return json.dumps({
            "event": "media",
            "streamSid": self._stream_sid,
            "media": {"payload": payload},
        })

    # ── Telnyx → Pipecat (inbound caller audio) ───────────────────────────────

    async def deserialize(self, data: str | bytes) -> Frame | None:  # type: ignore[override]
        """Parse a Telnyx WebSocket message into a Pipecat frame."""
        try:
            msg = json.loads(data)
        except (json.JSONDecodeError, TypeError):
            return None

        event = msg.get("event")

        if event == "start":
            start = msg.get("start") or {}
            self._stream_sid = start.get("stream_sid") or start.get("streamSid") or ""
            return None  # no audio frame from start event

        if event == "media":
            media = msg.get("media") or {}
            # Telnyx sends both inbound and outbound tracks; only process inbound
            track = media.get("track", "inbound")
            if track == "outbound":
                return None
            payload = media.get("payload")
            if not payload:
                return None
            mulaw = base64.b64decode(payload)
            # Decode mulaw → 16-bit PCM
            pcm = audioop.ulaw2lin(mulaw, 2)
            return InputAudioRawFrame(audio=pcm, sample_rate=8000, num_channels=1)

        if event == "stop":
            return EndFrame()

        return None
