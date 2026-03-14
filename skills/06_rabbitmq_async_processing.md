# RabbitMQ & Async Processing

- Durable queues, retry queues (exponential backoff), DLQ topology
- Idempotent consumers (dedupe via Redis + Mongo unique constraints)
- Concurrency and prefetch tuning; worker autoscaling by queue depth
- Observability: processing latency, retry counts, DLQ alarms
