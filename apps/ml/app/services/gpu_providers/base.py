"""Abstract GPU provider interface."""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Any


@dataclass
class RemoteJobHandle:
    provider: str
    remote_id: str
    extra: dict = field(default_factory=dict)


@dataclass
class RemoteJobStatus:
    state: str   # queued | running | completed | failed | cancelled
    progress: float = 0.0
    log_lines: list[str] = field(default_factory=list)
    error: Optional[str] = None
    # RunPod runtime metrics (GPU/CPU/memory utilisation sampled during polling)
    pod_metrics: dict = field(default_factory=dict)


@dataclass
class RemoteTrainingResult:
    metrics: dict[str, float]
    model_bytes: Optional[bytes]   # pickled model; None if stored directly in S3
    model_s3_key: Optional[str]    # set if provider uploaded directly to S3
    log_lines: list[str] = field(default_factory=list)


class BaseGpuProvider(ABC):
    name: str

    @abstractmethod
    async def dispatch(
        self,
        trainer_name: str,
        trainer_code: str,        # full Python source of the trainer file
        config: dict,
        injected_data: Optional[bytes],
        org_id: str,
        job_id: str,
    ) -> RemoteJobHandle: ...

    @abstractmethod
    async def get_status(self, handle: RemoteJobHandle) -> RemoteJobStatus: ...

    @abstractmethod
    async def get_result(self, handle: RemoteJobHandle) -> RemoteTrainingResult: ...

    @abstractmethod
    async def cancel(self, handle: RemoteJobHandle) -> None: ...
