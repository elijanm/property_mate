from fastapi import APIRouter

from app.api.v1.accounting import router as accounting_router
from app.api.v1.dashboard import router as dashboard_router
from app.api.v1.auth import router as auth_router
from app.api.v1.mfa import router as mfa_router
from app.api.v1.deductions import router as deductions_router
from app.api.v1.invoices import router as invoices_router
from app.api.v1.jobs import router as jobs_router
from app.api.v1.tickets import router as tickets_router
from app.api.v1.health import router as health_router
from app.api.v1.inspections import router as inspections_router
from app.api.v1.leases import router as leases_router
from app.api.v1.meter_readings import router as meter_readings_router
from app.api.v1.org import router as org_router
from app.api.v1.onboardings import router as onboardings_router
from app.api.v1.payments import router as payments_router
from app.api.v1.properties import router as properties_router
from app.api.v1.tenants import router as tenants_router
from app.api.v1.units import router as units_router
from app.api.v1.ws import router as ws_router
from app.api.v1.apps import router as apps_router
from app.api.v1.reports import router as reports_router
from app.api.v1.assets import router as assets_router
from app.api.v1.inventory import router as inventory_router, shipment_sign_router
from app.api.v1.vendors import router as vendors_router, listings_router, applications_router
from app.api.v1.vendor_portal import public_router as vendor_public_router, portal_router as vendor_portal_router
from app.api.v1.stores import router as stores_router
from app.api.v1.whatsapp import router as whatsapp_router, webhook_router as whatsapp_webhook_router
from app.api.v1.lease_templates import router as lease_templates_router
from app.api.v1.move_out import router as move_out_router
from app.api.v1.cctv import router as cctv_router
from app.api.v1.entity_aliases import router as entity_aliases_router
from app.api.v1.ai import router as ai_router

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(mfa_router)
api_router.include_router(org_router)
api_router.include_router(properties_router)
api_router.include_router(meter_readings_router)
api_router.include_router(units_router)
api_router.include_router(leases_router)
api_router.include_router(onboardings_router)
api_router.include_router(tenants_router)
api_router.include_router(payments_router)
api_router.include_router(inspections_router)
api_router.include_router(deductions_router)
api_router.include_router(tickets_router)
api_router.include_router(invoices_router)
api_router.include_router(accounting_router)
api_router.include_router(dashboard_router)
api_router.include_router(jobs_router)
api_router.include_router(ws_router)
api_router.include_router(apps_router)
api_router.include_router(reports_router)
api_router.include_router(assets_router)
api_router.include_router(inventory_router)
api_router.include_router(shipment_sign_router)
api_router.include_router(vendor_public_router)   # must be before listings_router (avoids /public → /{listing_id})
api_router.include_router(vendors_router)
api_router.include_router(listings_router)
api_router.include_router(applications_router)
api_router.include_router(vendor_portal_router)
api_router.include_router(stores_router)
api_router.include_router(whatsapp_router)
api_router.include_router(whatsapp_webhook_router)
api_router.include_router(lease_templates_router)
api_router.include_router(move_out_router)
api_router.include_router(cctv_router)
api_router.include_router(entity_aliases_router)
api_router.include_router(ai_router)
