import uuid
from datetime import datetime
from typing import List, Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class BusinessDetails(BaseModel):
    name: str
    registration_number: Optional[str] = None  # e.g. company reg number
    kra_pin: Optional[str] = None              # Kenya Revenue Authority PIN
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None              # full postal / physical address
    logo_url: Optional[str] = None             # S3 public URL


class TaxConfig(BaseModel):
    vat_enabled: bool = False
    vat_rate: float = 16.0                     # Kenya standard VAT %
    vat_number: Optional[str] = None           # VAT registration number
    vat_inclusive: bool = False                # True = displayed prices include VAT
    withholding_tax_enabled: bool = False
    withholding_tax_rate: float = 0.0          # %


class AccountEntry(BaseModel):
    """A single entry in the organization's chart of accounts."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    code: str                                  # e.g. "4000"
    name: str                                  # e.g. "Rental Income"
    account_type: str                          # "income" | "expense" | "asset" | "liability"
    role: Optional[str] = None                 # System tag (rental_income | deposit | late_fee |
                                               # tax_payable | expense | agent_receivable | etc.)
    description: Optional[str] = None


class TicketCategoryConfig(BaseModel):
    key: str
    label: str
    enabled: bool = True
    icon: Optional[str] = None
    default_priority: str = "normal"
    sla_hours: Optional[int] = None


def _default_ticket_categories() -> List[TicketCategoryConfig]:
    return [
        TicketCategoryConfig(key="maintenance", label="Maintenance", icon="🔧", sla_hours=48),
        TicketCategoryConfig(key="utility_reading", label="Utility Reading", icon="⚡", sla_hours=24),
        TicketCategoryConfig(key="move_in_inspection", label="Move-In Inspection", icon="🏠"),
        TicketCategoryConfig(key="move_out_request", label="Move-Out Request", icon="📦"),
        TicketCategoryConfig(key="move_out_inspection", label="Move-Out Inspection", icon="🔍"),
        TicketCategoryConfig(key="move_out_refund", label="Deposit Refund", icon="💰"),
        TicketCategoryConfig(key="request", label="General Request", icon="📋"),
        TicketCategoryConfig(key="complaint", label="Complaint", icon="⚠️", default_priority="high"),
        TicketCategoryConfig(key="other", label="Other", icon="📌"),
    ]


def _default_accounts() -> List[AccountEntry]:
    return [
        # ── Assets (1xxx) ────────────────────────────────────────────────────
        AccountEntry(code="1100", name="Rent Receivable",          account_type="asset",     role="rent_receivable",        description="Outstanding rent invoices owed by tenants"),
        AccountEntry(code="1200", name="Utility Deposit Held",     account_type="asset",     role="utility_deposit_asset",  description="Utility deposits collected from tenants (asset side)"),
        AccountEntry(code="1300", name="Prepaid Expenses",         account_type="asset",     role="prepaid",                description="Insurance, maintenance or other costs paid in advance"),
        AccountEntry(code="1400", name="Inventory Asset",          account_type="asset",     role="inventory",              description="Stock and supplies held on-site"),

        # ── Liabilities (2xxx) ───────────────────────────────────────────────
        AccountEntry(code="2000", name="Security Deposits",        account_type="liability", role="deposit",                description="Refundable security deposits held on behalf of tenants"),
        AccountEntry(code="2100", name="Tax Payable",              account_type="liability", role="tax_payable",            description="VAT / GST collected and owed to revenue authority"),
        AccountEntry(code="2200", name="Advance Rent",             account_type="liability", role="advance_rent",           description="Rent received ahead of the billing period (deferred revenue)"),
        AccountEntry(code="2300", name="Accounts Payable",         account_type="liability", role="accounts_payable",       description="Unpaid vendor and contractor invoices"),
        AccountEntry(code="2400", name="Withholding Tax Payable",  account_type="liability", role="withholding_tax",        description="WHT on management fees and agent commissions"),
        AccountEntry(code="2500", name="Agent Payable",            account_type="liability", role="agent_receivable",       description="Commissions owed to agents pending settlement"),
        AccountEntry(code="2600", name="Utility Deposit Liability",account_type="liability", role="utility_deposit",        description="Utility deposits held — refundable to tenants on exit"),

        # ── Income (4xxx) ────────────────────────────────────────────────────
        AccountEntry(code="4000", name="Rental Income",            account_type="income",    role="rental_income",          description="Base rent charged to tenants"),
        AccountEntry(code="4100", name="Late Fees",                account_type="income",    role="late_fee",               description="Penalties applied for overdue rent payments"),
        AccountEntry(code="4200", name="Utility Income",           account_type="income",    role="utility_income",         description="Water, electricity and other utilities billed to tenants"),
        AccountEntry(code="4300", name="Service Charge",           account_type="income",    role="service_charge",         description="Common-area maintenance and amenity levies"),
        AccountEntry(code="4400", name="Move-in / Admin Fee",      account_type="income",    role="admin_fee",              description="One-off fees collected at lease signing"),
        AccountEntry(code="4500", name="Parking & Other Fees",     account_type="income",    role="other_income",           description="Parking bays, storage, laundry and miscellaneous income"),
        AccountEntry(code="4600", name="Commission Income",        account_type="income",    role="commission_income",      description="Agent commission charged to landlord on new leases"),
        AccountEntry(code="4700", name="Forfeited Deposit",        account_type="income",    role="forfeited_deposit",      description="Portion of security deposit applied to damages — income to owner"),

        # ── Expenses (6xxx) ──────────────────────────────────────────────────
        AccountEntry(code="6000", name="Operating Expenses",       account_type="expense",   role="expense",                description="General day-to-day operating costs"),
        AccountEntry(code="6100", name="Maintenance & Repairs",    account_type="expense",   role="maintenance",            description="Vendor costs for maintenance tickets and property repairs"),
        AccountEntry(code="6200", name="Common Utility Expense",   account_type="expense",   role="utility_expense",        description="Landlord-paid utilities for common areas"),
        AccountEntry(code="6300", name="Management Fees",          account_type="expense",   role="management_fee",         description="Fees paid to the property management company"),
        AccountEntry(code="6400", name="Agent Commission",         account_type="expense",   role="agent_commission",       description="Commission paid out to agents on leases"),
        AccountEntry(code="6500", name="Insurance",                account_type="expense",   role="insurance",              description="Property and liability insurance premiums"),
        AccountEntry(code="6600", name="Legal & Professional",     account_type="expense",   role="legal",                  description="Legal fees for evictions, contracts and compliance"),
        AccountEntry(code="6700", name="Bad Debt Expense",         account_type="expense",   role="bad_debt",               description="Rent receivables written off as uncollectable"),
        AccountEntry(code="6800", name="Bank Charges",             account_type="expense",   role="bank_charges",           description="Mpesa transaction fees, bank transfer fees and related charges"),
    ]


class LedgerSettings(BaseModel):
    currency: str = "KES"
    currency_symbol: str = "KSh"
    fiscal_year_start_month: int = 1           # 1=January, 7=July, etc.
    invoice_prefix: str = "INV"
    receipt_prefix: str = "RCT"
    credit_note_prefix: str = "CN"
    payment_terms_days: int = 30
    accounts: List[AccountEntry] = Field(default_factory=_default_accounts)


class SignatureConfig(BaseModel):
    """Default countersignature configuration for lease contracts."""
    signature_key: Optional[str] = None      # S3 key for signature PNG
    signatory_name: Optional[str] = None     # e.g. "Cecil Homes Management"
    signatory_title: Optional[str] = None    # e.g. "Managing Director"


class BillingConfig(BaseModel):
    auto_generation_enabled: bool = False
    preparation_day: int = 1           # 1-28: day of month to generate invoices
    preparation_hour: int = 0          # hour (UTC) for scheduled generation
    preparation_minute: int = 5        # minute (UTC) for scheduled generation
    timezone: str = "Africa/Nairobi"
    payment_grace_days: int = 7        # days after billing_month start until invoice is due


class InventoryConfig(BaseModel):
    # "keep_target" → surviving serial keeps existing S/N
    # "create_new"  → all sources merged into a brand-new S/N
    serial_merge_mode: str = "keep_target"
    # max unaccounted remainder % allowed on split (0 = strict equality)
    serial_split_remainder_pct: float = 0.0
    # when False: weight/qty input fields hidden in stock-in/out UI; flags still shown
    show_weight_tracking: bool = True
    # decimal places for quantity/weight display and rounding
    decimal_places: int = 2


class DepositInterestSetting(BaseModel):
    enabled: bool = False
    annual_rate_pct: float = 0.0   # e.g. 5.0 for 5% per year
    compound: bool = False          # simple vs compound interest
    apply_on_refund: bool = True    # add interest to refund amount


class AIConfig(BaseModel):
    """Per-org LLM provider configuration. Overrides server-level defaults when set."""
    provider: str = "custom"           # "openai" | "custom"
    api_key: Optional[str] = None      # stored in DB; never logged
    base_url: Optional[str] = None     # custom endpoint base URL (e.g. Ollama)
    model: Optional[str] = None        # model name override


class Org(Document):
    """
    One document per tenant (org_id). Created automatically on first access;
    setup_complete is False until the owner completes the business setup wizard.
    """
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str                                # same as tenant boundary key
    business: Optional[BusinessDetails] = None
    tax_config: TaxConfig = Field(default_factory=TaxConfig)
    ledger_settings: LedgerSettings = Field(default_factory=LedgerSettings)
    billing_config: BillingConfig = Field(default_factory=BillingConfig)
    signature_config: SignatureConfig = Field(default_factory=SignatureConfig)
    ticket_categories: List[TicketCategoryConfig] = Field(
        default_factory=_default_ticket_categories
    )
    deposit_interest: DepositInterestSetting = Field(default_factory=DepositInterestSetting)
    ai_config: AIConfig = Field(default_factory=AIConfig)
    voice_api_audit_enabled: bool = True   # log PMS/WA API calls made during voice calls
    invoice_counter: int = 0           # atomic counter for reference number generation
    ticket_counter: int = 0            # atomic counter for TKT-XXXXXX reference numbers
    setup_complete: bool = False
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "orgs"
        indexes = [
            IndexModel([("org_id", ASCENDING)], unique=True),
        ]
