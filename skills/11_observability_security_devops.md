# Observability, Security & DevOps

Observability:
- Prometheus metrics (API, workers, queues, billing, payments)
- Grafana dashboards and Alertmanager rules
- OpenTelemetry traces across API → RabbitMQ → worker → Mongo/Redis/OpenSearch
- Structured JSON logs with correlation IDs

Security:
- OAuth/JWT, RBAC, org isolation, PII encryption and redaction
- Webhook signature verification, rate limiting, fraud anomaly signals
- Audit logs for sensitive actions

DevOps:
- Docker compose networking (service-name discovery; no localhost)
- Kubernetes readiness (stateless pods, config via env/secrets, autoscaling)
- MinIO local S3, production S3-compatible storage, CDN for media
