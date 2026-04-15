from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import init_db, close_db
from app.models.audit_log import AuditLog
from app.models.deposit_deduction import DepositDeduction
from app.models.inspection_report import InspectionReport
from app.models.invoice import BillingCycleRun, Invoice, VacancyReport
from app.models.maintenance_ticket import MaintenanceTicket
from app.models.ticket import Ticket
from app.models.job_run import JobRun
from app.models.lease import Lease
from app.models.ledger_entry import LedgerEntry
from app.models.meter_reading import MeterReading
from app.models.org import Org
from app.models.onboarding import Onboarding
from app.models.payment import Payment
from app.models.property import Property
from app.models.unit import Unit
from app.models.user import User
from app.models.user_mfa import UserMfa
from app.models.installed_app import InstalledApp
from app.models.app_waitlist import AppWaitlist
from app.models.asset import Asset
from app.models.inventory import InventoryItem
from app.models.stock_shipment import StockShipment
from app.models.ai_conversation import AIConversation
from app.models.vendor_profile import VendorProfile
from app.models.vendor_listing import VendorListing
from app.models.vendor_application import VendorApplication
from app.models.vendor_contract import VendorContract
from app.models.store import StoreLocation
from app.models.whatsapp_instance import WhatsAppInstance
from app.models.whatsapp_event import WhatsAppEvent
from app.models.lease_template import LeaseTemplate
from app.models.move_out import MoveOutInspection
from app.models.cctv import CCTVCamera, CCTVEvent
from app.models.framework import (
    FrameworkContract,
    FrameworkAsset,
    FrameworkInvitedVendor,
    MaintenanceSchedule,
    WorkOrder,
    SlaRecord,
    SparePartsPricing,
    SparePartsKit,
    TransportCostEntry,
    RateSchedule,
    PartsCatalogItem,
)
from app.core.redis import init_redis, close_redis
from app.core.rabbitmq import init_rabbitmq, close_rabbitmq
from app.core.opensearch import init_opensearch, close_opensearch
from app.core.logging import configure_logging
from app.core.exceptions import add_exception_handlers
from app.core.middleware import RequestIDMiddleware, TimingMiddleware, MetricsMiddleware
from app.core.metrics import setup_metrics
from app.core.s3 import ensure_bucket_exists
from app.api.v1.router import api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    await init_db(app, document_models=[
        User, UserMfa, Property, Unit, Lease, Onboarding, AuditLog, JobRun, MeterReading, Org,
        Payment, LedgerEntry, InspectionReport, DepositDeduction, MaintenanceTicket, Ticket,
        Invoice, BillingCycleRun, VacancyReport, InstalledApp, AppWaitlist, Asset, InventoryItem,
        VendorProfile, VendorListing, VendorApplication, VendorContract, StockShipment, StoreLocation,
        WhatsAppInstance, WhatsAppEvent, LeaseTemplate, MoveOutInspection,
        CCTVCamera, CCTVEvent, AIConversation,
        FrameworkContract, FrameworkAsset, MaintenanceSchedule, WorkOrder,
        SlaRecord, SparePartsPricing, SparePartsKit, TransportCostEntry, RateSchedule, PartsCatalogItem,
        FrameworkInvitedVendor,
    ])
    await init_redis(app)
    await init_rabbitmq(app)
    await init_opensearch(app)
    await ensure_bucket_exists()
    yield
    await close_rabbitmq(app)
    await close_redis(app)
    await close_db(app)
    await close_opensearch(app)


def create_app() -> FastAPI:
    app = FastAPI(
        title="PMS API",
        version=settings.app_version,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    # Middleware (order matters — outermost first)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(MetricsMiddleware)
    app.add_middleware(TimingMiddleware)
    app.add_middleware(RequestIDMiddleware)

    # Exception handlers
    add_exception_handlers(app)

    # Prometheus metrics endpoint
    setup_metrics(app)

    # Routers
    app.include_router(api_router)

    return app


app = create_app()
