from celery import Celery
from celery.signals import worker_process_init
from app.core.config import settings

celery_app = Celery(
    "ml_studio",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.tasks.train_task"],
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
