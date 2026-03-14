# Skill: Repo Layout + Docker Compose

Goal:
Keep dev/prod consistent and easy.

Rules:
- docker-compose is located at infra/docker/compose.yml
- Prometheus config at infra/docker/prometheus/prometheus.yml
- Grafana provisioning at infra/docker/grafana/provisioning
- Mongo init scripts at infra/docker/mongo/init.js

Compose must include:
- backend
- worker
- frontend
- redis
- mongodb
- rabbitmq
- opensearch
- prometheus
- grafana
- alertmanager
- otel-collector
- minio

Naming:
Services should be named exactly as their role:
backend, worker, frontend, mongodb, redis, rabbitmq, opensearch, prometheus, grafana, alertmanager.

Networking:
Use a single compose network so services can refer by name.
No localhost inside containers.