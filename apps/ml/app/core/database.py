from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient
from app.core.config import settings
import structlog

logger = structlog.get_logger(__name__)


def get_db():
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    return client[settings.MONGODB_DATABASE]


async def init_db():
    from app.models.training_job import TrainingJob
    from app.models.model_deployment import ModelDeployment
    from app.models.inference_log import InferenceLog
    from app.models.trainer_registration import TrainerRegistration
    from app.models.training_config import TrainingConfig
    from app.models.inference_feedback import InferenceFeedback
    from app.models.ip_record import IPRecord
    from app.models.request_log import RequestLog
    from app.models.performance_snapshot import PerformanceSnapshot
    from app.models.drift_baseline import DriftBaseline
    from app.models.drift_alert import DriftAlert
    from app.models.ml_user import MLUser
    from app.models.api_key import ApiKey
    from app.models.ab_test import ABTest
    from app.models.alert_rule import AlertRule, AlertFire
    from app.models.batch_job import BatchJob
    from app.models.audit_log import AuditLog
    from app.models.wallet import Wallet, WalletTransaction
    from app.models.dataset import DatasetProfile, DatasetCollector, DatasetEntry
    from app.models.consent import ConsentTemplate, ConsentRecord
    from app.models.watermark import OrgWatermarkConfig, UserWatermarkConfig
    from app.models.annotation import AnnotationProject
    from app.models.annotation_export_job import AnnotationExportJob
    from app.models.platform_ledger import PlatformLedger
    from app.models.ml_plan import MLPricingConfig, MLPlan, MLUserPlan
    from app.models.annotator import AnnotatorProfile, RewardRedemption
    from app.models.platform_reward_config import PlatformRewardConfig
    from app.models.trainer_submission import TrainerSubmission
    from app.models.trainer_violation import TrainerViolation
    from app.models.admin_ticket import AdminTicket
    from app.models.org_config import OrgConfig
    from app.models.revenue_ledger import RevenueLedger

    client = AsyncIOMotorClient(settings.MONGODB_URL)
    await init_beanie(
        database=client[settings.MONGODB_DATABASE],
        document_models=[
            TrainingJob,
            ModelDeployment,
            InferenceLog,
            TrainerRegistration,
            TrainingConfig,
            InferenceFeedback,
            IPRecord,
            RequestLog,
            PerformanceSnapshot,
            DriftBaseline,
            DriftAlert,
            MLUser,
            ApiKey,
            ABTest,
            AlertRule,
            AlertFire,
            BatchJob,
            AuditLog,
            Wallet,
            WalletTransaction,
            DatasetProfile,
            DatasetCollector,
            DatasetEntry,
            ConsentTemplate,
            ConsentRecord,
            OrgWatermarkConfig,
            UserWatermarkConfig,
            AnnotationProject,
            AnnotationExportJob,
            PlatformLedger,
            MLPricingConfig,
            MLPlan,
            MLUserPlan,
            AnnotatorProfile,
            RewardRedemption,
            PlatformRewardConfig,
            TrainerSubmission,
            TrainerViolation,
            AdminTicket,
            OrgConfig,
            RevenueLedger,
        ],
    )
    logger.info("ml_db_initialized", database=settings.MONGODB_DATABASE)
