"""PMS ML Service — FastAPI entry point."""
import asyncio
import structlog
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import init_db
from app.api.router import api_router
from app.services.registry_service import scan_and_register_plugins
from app.services.scheduler_service import start_scheduler, stop_scheduler
from app.services.auth_service import ensure_admin_exists, ensure_sample_model_deployed
from app.services.gpu_dispatch_service import resume_interrupted_gpu_jobs
from app.middleware.request_logger import RequestLoggerMiddleware
from app.utils.s3_url import ensure_bucket_exists

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("ml_service_starting", app=settings.APP_NAME, port=settings.PORT)
    await init_db()
    try:
        await asyncio.get_event_loop().run_in_executor(None, ensure_bucket_exists)
    except Exception as exc:
        logger.warning("bucket_init_failed", error=str(exc))
    # First-run detection: if no trainers are registered yet, do a full directory scan.
    # On subsequent startups, only refresh files already in the DB (don't silently add new ones).
    from app.models.trainer_registration import TrainerRegistration
    is_first_run = await TrainerRegistration.find_one() is None
    await scan_and_register_plugins(first_run=is_first_run)
    await start_scheduler()
    await ensure_admin_exists()
    await ensure_sample_model_deployed()
    await resume_interrupted_gpu_jobs()
    from app.services.consent_service import seed_global_templates
    await seed_global_templates()
    # Start sandbox container pool if configured
    if settings.TRAINER_SANDBOX == "docker-pool":
        from app.services.pool_manager import get_pool_manager
        pool = get_pool_manager()
        await pool.start()
        logger.info("sandbox_pool_mode_active")
    yield
    # Shutdown
    await stop_scheduler()
    if settings.TRAINER_SANDBOX == "docker-pool":
        from app.services.pool_manager import get_pool_manager
        await get_pool_manager().stop()
    logger.info("ml_service_stopped")


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description="PMS ML/AI Inference Service — pluggable trainers, MLflow tracking, scheduled training.",
    lifespan=lifespan,
)

# Security middleware runs first (outermost) — logs all requests and gates on IP bans
app.add_middleware(RequestLoggerMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/health")
async def health():
    return {"ok": True, "service": settings.APP_NAME}


@app.get("/")
async def root():
    return {
        "service": settings.APP_NAME,
        "docs": "/docs",
        "health": "/health",
        "api": "/api/v1",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=True)
