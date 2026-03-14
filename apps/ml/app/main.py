"""PMS ML Service — FastAPI entry point."""
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
from app.middleware.request_logger import RequestLoggerMiddleware

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("ml_service_starting", app=settings.APP_NAME, port=settings.PORT)
    await init_db()
    await scan_and_register_plugins()
    await start_scheduler()
    await ensure_admin_exists()
    await ensure_sample_model_deployed()
    yield
    # Shutdown
    await stop_scheduler()
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
