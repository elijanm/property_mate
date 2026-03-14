from typing import Dict, List, Optional, Tuple

from app.models.invoice import BillingCycleRun, Invoice, VacancyReport
from app.models.org import Org
from app.utils.datetime import utc_now
from beanie import Document, PydanticObjectId

class InvoiceRepository:
    async def create(self, invoice: Invoice) -> Invoice:
        await invoice.insert()
        return invoice

    async def get_by_id(self, invoice_id: str, org_id: Optional[str]) -> Optional[Invoice]:
        filters: list = [
            Invoice.id == PydanticObjectId(invoice_id),
            Invoice.deleted_at == None,  # noqa: E711
        ]
        if org_id:  # superadmin has org_id=None → bypass org scope
            filters.append(Invoice.org_id == org_id)
        return await Invoice.find_one(*filters)

    async def get_by_idempotency_key(self, key: str) -> Optional[Invoice]:
        return await Invoice.find_one(
            Invoice.idempotency_key == key,
            Invoice.deleted_at == None,  # noqa: E711
        )

    async def list(
        self,
        org_id: Optional[str],
        billing_month: Optional[str] = None,
        property_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
        lease_id: Optional[str] = None,
        status: Optional[str] = None,
        sandbox: Optional[bool] = None,
        invoice_category: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[Invoice], int]:
        filters: dict = {"deleted_at": None}
        if org_id:
            filters["org_id"] = org_id
        if billing_month:
            filters["billing_month"] = billing_month
        if property_id:
            filters["property_id"] = property_id
        if tenant_id:
            filters["tenant_id"] = tenant_id
        if lease_id:
            filters["lease_id"] = lease_id
        if status:
            filters["status"] = status
        if sandbox is not None:
            filters["sandbox"] = sandbox
        if invoice_category is not None:
            filters["invoice_category"] = invoice_category

        query = Invoice.find(filters).sort("-created_at")
        total = await query.count()
        skip = (page - 1) * page_size
        items = await query.skip(skip).limit(page_size).to_list()
        return items, total

    async def count_by_status(
        self,
        org_id: str,
        billing_month: Optional[str] = None,
        sandbox: Optional[bool] = None,
        invoice_category: Optional[str] = None,
    ) -> Dict[str, int]:
        filters: dict = {"org_id": org_id, "deleted_at": None}
        if billing_month:
            filters["billing_month"] = billing_month
        if sandbox is not None:
            filters["sandbox"] = sandbox
        if invoice_category is not None:
            filters["invoice_category"] = invoice_category

        pipeline = [
            {"$match": filters},
            {"$group": {"_id": "$status", "count": {"$sum": 1}}},
        ]
        result = await Invoice.get_pymongo_collection().aggregate(pipeline).to_list(length=None)
        return {row["_id"]: row["count"] for row in result}

    async def update(self, invoice: Invoice, fields: dict) -> Invoice:
        fields["updated_at"] = utc_now()
        await invoice.update({"$set": fields})
        for key, value in fields.items():
            setattr(invoice, key, value)
        return invoice

    async def get_lease_history(
        self,
        lease_id: str,
        org_id: str,
        limit: int = 13,
    ) -> List[Invoice]:
        """Return the last `limit` non-void invoices for a lease sorted by billing_month desc."""
        filters = {
            "org_id": org_id,
            "lease_id": lease_id,
            "deleted_at": None,
            "status": {"$ne": "void"},
        }
        return await Invoice.find(filters).sort("-billing_month").limit(limit).to_list()

    async def list_outstanding_for_lease(
        self,
        lease_id: str,
        org_id: str,
        invoice_category: Optional[str] = None,
    ) -> List[Invoice]:
        """Return all unpaid invoices for a lease ordered by billing_month ASC (oldest first).

        Pass invoice_category="rent" or "deposit" to restrict FIFO to a single pool.
        """
        filters: dict = {
            "org_id": org_id,
            "lease_id": lease_id,
            "deleted_at": None,
            "status": {"$nin": ["paid", "void"]},
            "balance_due": {"$gt": 0},
        }
        if invoice_category is not None:
            filters["invoice_category"] = invoice_category
        return await Invoice.find(filters).sort("+billing_month").to_list()

    async def get_latest_for_lease(self, lease_id: str, org_id: str) -> Optional[Invoice]:
        """Return the most recently billed invoice for a lease (by billing_month DESC)."""
        return await Invoice.find(
            Invoice.org_id == org_id,
            Invoice.lease_id == lease_id,
            Invoice.deleted_at == None,  # noqa: E711
            Invoice.sandbox == False,    # noqa: E712
        ).sort("-billing_month").first_or_none()

    async def soft_delete(self, invoice: Invoice) -> None:
        await invoice.update({"$set": {"deleted_at": utc_now()}})

    async def next_reference_number(self, org_id: str, prefix: str) -> str:
        """Atomically increment org invoice_counter and return formatted reference."""
        result = await Org.get_pymongo_collection().find_one_and_update(
            {"org_id": org_id},
            {"$inc": {"invoice_counter": 1}},
            return_document=True,
            projection={"invoice_counter": 1},
        )
        counter = result["invoice_counter"] if result else 1
        return f"{prefix}-{counter:06d}"


invoice_repository = InvoiceRepository()


class BillingRunRepository:
    async def create(self, run: BillingCycleRun) -> BillingCycleRun:
        await run.insert()
        return run

    async def get_by_id(self, run_id: str, org_id: str) -> Optional[BillingCycleRun]:
        return await BillingCycleRun.find_one(
            BillingCycleRun.id == run_id,
            BillingCycleRun.org_id == org_id,
            BillingCycleRun.deleted_at == None,  # noqa: E711
        )

    async def get_latest(
        self,
        org_id: str,
        billing_month: str,
        run_type: Optional[str] = None,
    ) -> Optional[BillingCycleRun]:
        filters: dict = {
            "org_id": org_id,
            "billing_month": billing_month,
            "deleted_at": None,
        }
        if run_type:
            filters["run_type"] = run_type
        return (
            await BillingCycleRun.find(filters)
            .sort("-created_at")
            .limit(1)
            .first_or_none()
        )

    async def list(
        self,
        org_id: str,
        billing_month: Optional[str] = None,
        include_dry_run: bool = False,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[BillingCycleRun], int]:
        filters: dict = {"org_id": org_id, "deleted_at": None}
        if billing_month:
            filters["billing_month"] = billing_month
        if not include_dry_run:
            filters["run_type"] = {"$ne": "dry_run"}
        query = BillingCycleRun.find(filters).sort("-created_at")
        total = await query.count()
        skip = (page - 1) * page_size
        items = await query.skip(skip).limit(page_size).to_list()
        return items, total

    async def update(self, run: BillingCycleRun, fields: dict) -> BillingCycleRun:
        fields["updated_at"] = utc_now()
        await run.update({"$set": fields})
        for key, value in fields.items():
            setattr(run, key, value)
        return run


billing_run_repository = BillingRunRepository()


class VacancyReportRepository:
    async def create(self, report: VacancyReport) -> VacancyReport:
        await report.insert()
        return report

    async def get_by_month(self, org_id: str, billing_month: str) -> Optional[VacancyReport]:
        return await VacancyReport.find_one(
            VacancyReport.org_id == org_id,
            VacancyReport.billing_month == billing_month,
            VacancyReport.deleted_at == None,  # noqa: E711
        )


vacancy_report_repository = VacancyReportRepository()
