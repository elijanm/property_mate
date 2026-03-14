"""Stream and save call audio recordings to S3/MinIO.

Both the caller's inbound audio and the agent's outbound (TTS) audio are
captured with monotonic timestamps and mixed into a single mono WAV at
finalise() time.  When the two streams overlap they are summed and clamped
to the int16 range, producing a natural-sounding full-duplex recording.

Usage:
    recorder = CallRecorder(call_control_id, org_id)
    recorder.add_inbound(pcm_bytes)    # inbound: caller audio frame
    recorder.add_outbound(pcm_bytes)   # outbound: TTS audio frame
    key = await recorder.finalise()    # mix, encode WAV, upload, return S3 key
"""
import io
import time
import wave
from datetime import datetime, timezone
from typing import Optional

import aioboto3
import numpy as np
import structlog

from app.core.config import settings

logger = structlog.get_logger(__name__)

SAMPLE_WIDTH = 2   # 16-bit PCM
CHANNELS = 1


class CallRecorder:
    """Captures inbound + outbound PCM streams and uploads a mixed WAV to S3."""

    def __init__(
        self,
        call_control_id: str,
        org_id: str | None = None,
        enabled: bool | None = None,
        sample_rate: int = 8000,
    ) -> None:
        self.call_control_id = call_control_id
        self.org_id = org_id or "global"
        self._sample_rate = sample_rate
        self._enabled = settings.RECORDING_ENABLED if enabled is None else enabled
        self._start: float = time.monotonic()
        # Each entry: (monotonic_offset_seconds, raw_pcm_bytes)
        self._inbound: list[tuple[float, bytes]] = []
        self._outbound: list[tuple[float, bytes]] = []

    # ── Public API ────────────────────────────────────────────────────────────

    def add_inbound(self, pcm: bytes) -> None:
        """Add a raw PCM chunk from the caller."""
        if self._enabled and pcm:
            self._inbound.append((time.monotonic() - self._start, pcm))

    def add_outbound(self, pcm: bytes) -> None:
        """Add a raw PCM chunk from the TTS (agent voice)."""
        if self._enabled and pcm:
            self._outbound.append((time.monotonic() - self._start, pcm))

    # Legacy name kept for backward compatibility
    def add_chunk(self, pcm: bytes) -> None:
        self.add_inbound(pcm)

    def total_bytes(self) -> int:
        return sum(len(c) for _, c in self._inbound) + sum(len(c) for _, c in self._outbound)

    async def finalise(self) -> Optional[str]:
        if not self._enabled or (not self._inbound and not self._outbound):
            return None

        try:
            wav_buf = self._build_mixed_wav()
            key = self._s3_key()
            await self._upload(key, wav_buf)
            logger.info(
                "recording_uploaded",
                action="finalise_recording",
                resource_type="call_session",
                resource_id=self.call_control_id,
                s3_key=key,
                bytes=len(wav_buf),
                inbound_chunks=len(self._inbound),
                outbound_chunks=len(self._outbound),
                status="success",
            )
            return key
        except Exception as exc:
            logger.error(
                "recording_upload_failed",
                action="finalise_recording",
                resource_type="call_session",
                resource_id=self.call_control_id,
                error=str(exc),
                status="error",
            )
            return None

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _build_mixed_wav(self) -> bytes:
        """Mix inbound and outbound streams into a single mono WAV.

        Inbound (caller mic) is written first; outbound (TTS) then overwrites
        those regions.  This prevents microphone echo of the AI voice from being
        summed with the clean TTS signal, which was the source of distortion.
        """
        # Work out total sample count needed across both streams.
        total_samples = 0
        for ts, chunk in self._inbound + self._outbound:
            end = int(ts * self._sample_rate) + len(chunk) // SAMPLE_WIDTH
            if end > total_samples:
                total_samples = end

        buffer = np.zeros(total_samples, dtype=np.int16)

        # Layer 1 — inbound (caller voice)
        for ts, chunk in self._inbound:
            pos = int(ts * self._sample_rate)
            samples = np.frombuffer(chunk, dtype="<i2")
            end = pos + len(samples)
            if end > total_samples:
                samples = samples[: total_samples - pos]
            buffer[pos : pos + len(samples)] = samples

        # Layer 2 — outbound (TTS) overwrites: clean signal takes priority
        for ts, chunk in self._outbound:
            pos = int(ts * self._sample_rate)
            samples = np.frombuffer(chunk, dtype="<i2")
            end = pos + len(samples)
            if end > total_samples:
                samples = samples[: total_samples - pos]
            buffer[pos : pos + len(samples)] = samples

        mixed = buffer

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(CHANNELS)
            wf.setsampwidth(SAMPLE_WIDTH)
            wf.setframerate(self._sample_rate)
            wf.writeframes(mixed.tobytes())
        return buf.getvalue()

    def _s3_key(self) -> str:
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        return f"{self.org_id}/call_recordings/{ts}_{self.call_control_id}.wav"

    async def _upload(self, key: str, data: bytes) -> None:
        session = aioboto3.Session()
        async with session.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT_URL,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            region_name=settings.S3_REGION,
        ) as s3:
            await s3.put_object(
                Bucket=settings.S3_BUCKET,
                Key=key,
                Body=data,
                ContentType="audio/wav",
                Metadata={"call_control_id": self.call_control_id, "org_id": self.org_id},
            )
