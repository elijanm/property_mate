"""Worker service Prometheus metrics."""
from prometheus_client import Counter, Gauge, Histogram

TASKS_PROCESSED_TOTAL = Counter(
    'worker_tasks_processed_total',
    'Total tasks processed by queue and status',
    ['queue', 'status'],  # status: success | error | retry
)
TASK_DURATION_SECONDS = Histogram(
    'worker_task_duration_seconds',
    'Task processing duration in seconds',
    ['queue', 'task_type'],
    buckets=[0.1, 0.5, 1.0, 5.0, 15.0, 30.0, 60.0, 300.0, 600.0],
)
ACTIVE_TASKS = Gauge(
    'worker_active_tasks',
    'Number of tasks currently being processed',
    ['queue'],
)
RABBITMQ_MESSAGES_CONSUMED_TOTAL = Counter(
    'worker_rabbitmq_messages_consumed_total',
    'Total RabbitMQ messages consumed',
    ['queue'],
)
RABBITMQ_MESSAGES_FAILED_TOTAL = Counter(
    'worker_rabbitmq_messages_failed_total',
    'Total RabbitMQ messages that failed processing',
    ['queue'],
)

import time as _time


def task_metrics_wrap(queue_name: str, task_type: str, handler):
    """Wrap an aio_pika message handler to record consumption/duration metrics."""
    async def _wrapped(message) -> None:
        RABBITMQ_MESSAGES_CONSUMED_TOTAL.labels(queue=queue_name).inc()
        ACTIVE_TASKS.labels(queue=queue_name).inc()
        _t0 = _time.monotonic()
        try:
            await handler(message)
            TASKS_PROCESSED_TOTAL.labels(queue=queue_name, status="success").inc()
        except Exception:
            TASKS_PROCESSED_TOTAL.labels(queue=queue_name, status="error").inc()
            RABBITMQ_MESSAGES_FAILED_TOTAL.labels(queue=queue_name).inc()
            raise
        finally:
            ACTIVE_TASKS.labels(queue=queue_name).dec()
            TASK_DURATION_SECONDS.labels(queue=queue_name, task_type=task_type).observe(
                _time.monotonic() - _t0
            )
    return _wrapped
