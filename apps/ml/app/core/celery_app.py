from celery import Celery
from celery.signals import worker_process_init
from app.core.config import settings

celery_app = Celery(
    "ml_studio",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.tasks.train_task", "app.tasks.annotate_task"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)


@worker_process_init.connect
def _install_security_hook(**kwargs):
    """Install the audit hook in every forked worker process before any task runs."""
    from app.core.worker_security import install
    install()
    _prewarm_yolo_weights()


def _prewarm_yolo_weights() -> None:
    """Download YOLO base weights at worker startup so training tasks don't
    trigger external network connections mid-job.  Failures are silently ignored
    — the training task will download them on-demand as a fallback."""
    import structlog as _structlog
    _log = _structlog.get_logger(__name__)
    try:
        import torch as _torch
        _gpu = _torch.cuda.is_available()
    except Exception:
        _gpu = False

    # Pre-warm only the models that will actually be used given available hardware.
    # On CPU only nano models are used; on GPU small + medium.
    if _gpu:
        _MODELS = ["yolov8s.pt", "yolov8m.pt", "yolov8s-obb.pt", "yolov8m-obb.pt"]
    else:
        _MODELS = ["yolov8n.pt", "yolov8n-obb.pt"]

    try:
        from ultralytics import YOLO
        for name in _MODELS:
            try:
                YOLO(name)  # downloads to ~/.cache/ultralytics/ if not present
                _log.info("yolo_weight_cached", model=name)
            except Exception as exc:
                _log.warning("yolo_weight_cache_failed", model=name, error=str(exc))
    except ImportError:
        pass  # ultralytics not installed in this worker variant
