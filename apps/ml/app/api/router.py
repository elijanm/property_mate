from fastapi import APIRouter
from app.api.v1 import trainers, training, inference, evaluation, models, config, feedback, sse, security, monitoring
from app.api.v1 import auth, api_keys, ab_tests, alert_rules, batch, audit, experiments, explain, users, wallet, admin
from app.api.v1 import datasets, collect, editor, annotate
from app.api.v1 import staff, annotator_portal
from app.api.v1 import billing
from app.api.v1 import discover
from app.api.v1 import consent
from app.api.v1 import watermark
from app.api.v1 import trainer_submissions, marketplace, clients
from app.api.v1 import org_config
from app.api.v1 import mlflow_proxy
from app.api.v1 import url_datasets
from app.api.v1 import trainer_api

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(editor.router)
api_router.include_router(annotate.router)
api_router.include_router(staff.router)
api_router.include_router(annotator_portal.router)
api_router.include_router(trainers.router)
api_router.include_router(training.router)
api_router.include_router(inference.router)
api_router.include_router(evaluation.router)
api_router.include_router(models.router)
api_router.include_router(config.router)
api_router.include_router(feedback.router)
api_router.include_router(sse.router)
api_router.include_router(security.router)
api_router.include_router(monitoring.router)
api_router.include_router(auth.router)
api_router.include_router(api_keys.router)
api_router.include_router(ab_tests.router)
api_router.include_router(alert_rules.router)
api_router.include_router(batch.router)
api_router.include_router(audit.router)
api_router.include_router(experiments.router)
api_router.include_router(explain.router)
api_router.include_router(users.router)
api_router.include_router(wallet.router)
api_router.include_router(admin.router)
api_router.include_router(datasets.router)
api_router.include_router(collect.router)
api_router.include_router(billing.router)
api_router.include_router(discover.router)
api_router.include_router(consent.router)
api_router.include_router(watermark.router)
api_router.include_router(trainer_submissions.router)
api_router.include_router(marketplace.router)
api_router.include_router(clients.router)
api_router.include_router(org_config.router)
api_router.include_router(mlflow_proxy.router)
api_router.include_router(url_datasets.router)
api_router.include_router(trainer_api.router)
