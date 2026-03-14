"""Browser WebSocket frame serializer for Pipecat sandbox calls.

Browser sends raw 16-bit signed PCM at 16 kHz as binary WebSocket frames.
Server sends the same format back.
"""
import audioop
from pipecat.frames.frames import AudioRawFrame, Frame, InputAudioRawFrame
from pipecat.serializers.base_serializer import FrameSerializer


class BrowserFrameSerializer(FrameSerializer):
    """Convert between raw binary PCM (16 kHz, 16-bit, mono) and Pipecat frames."""

    # ── Pipecat → Browser (outbound TTS audio) ───────────────────────────────

    async def serialize(self, frame: Frame) -> bytes | None:  # type: ignore[override]
        if not isinstance(frame, AudioRawFrame):
            return None
        pcm = frame.audio
        if frame.sample_rate != 16000:
            pcm, _ = audioop.ratecv(pcm, 2, 1, frame.sample_rate, 16000, None)
        return pcm

    # ── Browser → Pipecat (inbound mic audio) ────────────────────────────────

    async def deserialize(self, data: bytes | str) -> Frame | None:  # type: ignore[override]
        if not isinstance(data, bytes) or len(data) < 2:
            return None
        return InputAudioRawFrame(audio=data, sample_rate=16000, num_channels=1)
