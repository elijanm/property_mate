"""test_seed — multi-tenant end-to-end billing simulation.

Generates a realistic property with 5 tenants in different lifecycle states,
each unit having a distinct utility profile:

  Slot  Unit   Tenant           Scenario              Payment style          Utilities
  ────  ─────  ───────────────  ────────────────────  ─────────────────────  ──────────────────────────────────────────────
  1     A101   Amara Oduya      Active (all N months)  Random mixed           Elec metered 2-tier + Water metered flat + Internet
  2     A102   Brian Mwangi     Terminated at month 6  Random mixed           Elec subscription + Water subscription (no internet)
  3     A103   Cynthia Njeri    Expired (12 months)    Random mixed           Elec metered 3-tier + Water metered 3-tier + Internet + water deposit
  4     A104   David Kamau      Expired (8 months)     Random mixed           Elec metered 2-tier + Water subscription + Internet + utility deposit
               Eve Wanjiku        Re-let at month 10     Random mixed           (same utility profile, new deposit on first invoice)
  5     A105   Fatuma Hassan    Active from month 5    Random mixed           Elec metered 3-tier + Water metered flat (no internet)
  6     A106   George Otieno    Active (all N months)  Always full, on time   Elec metered 2-tier + Water metered 3-tier + Internet
  7     A107   Helen Kariuki    Active from month 3    Always full, on time   Elec subscription + Water subscription + Internet

Payment scenarios per month (seeded, reproducible):
  full_payment 35% · partial_payment 20% · late_payment 20%
  late_partial 12% · overpayment 8% · no_payment 5%

Ledger invariants verified after every invoice:
  1. invoice.balance_due == invoice.total_amount - invoice.amount_paid
  2. invoice.amount_paid <= invoice.total_amount
  3. ledger running_balance is monotonically consistent (debit/credit chain)
  4. carried_forward == max(0, last ledger balance for this lease)
  5. sum_debits - sum_credits == current running_balance

Usage
─────
  # Standalone (real MongoDB):
  python tests/seed/seed.py --months 18 --seed 99 --lease-start 2024-01 --drop

  # As a pytest fixture (see test_billing_seed.py):
  result = await run_seed(config=SeedConfig(months=12, seed=42))
"""
from __future__ import annotations

import calendar
import random
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional

from beanie import PydanticObjectId

from app.models.invoice import Invoice, InvoiceLineItem
from app.models.lease import Lease
from app.models.ledger_entry import LedgerEntry
from app.models.org import (
    BillingConfig,
    LedgerSettings,
    Org,
    TaxConfig,
)
from app.models.payment import Payment
from app.models.property import (
    Address,
    BillingSettings,
    PricingTier,
    Property,
    UtilityDefaults,
    UtilityDetail,
)
from app.models.unit import Unit
from app.models.user import User
from app.services.auth_service import hash_password
from app.utils.datetime import utc_now


# ── Scenario weights ──────────────────────────────────────────────────────────

_SCENARIOS = [
    "full_payment",
    "partial_payment",
    "late_payment",
    "late_partial",
    "overpayment",
    "no_payment",
]
_WEIGHTS = [35, 20, 20, 12, 8, 5]


# ── Utility profiles ──────────────────────────────────────────────────────────

@dataclass
class UnitUtilityProfile:
    """Per-unit utility configuration — determines which line items appear on invoices."""

    # Electricity
    elec_type: str = "metered_tiered"   # "subscription" | "metered_tiered"
    elec_flat_rate: float = 3_500.0     # KES/month — used when type=subscription
    elec_tiers: List[tuple] = field(default_factory=lambda: [
        (0.0, 200.0, 12.0), (200.0, None, 18.0)
    ])  # (from_units, to_units|None, rate)
    elec_base_consumption: float = 150.0   # kWh/month base
    elec_variance: float = 80.0

    # Water
    water_type: str = "subscription"    # "subscription" | "metered_flat" | "metered_tiered"
    water_flat_rate: float = 800.0      # KES/month — used when type=subscription
    water_unit_rate: float = 50.0       # KES/m³ — used when type=metered_flat
    water_tiers: List[tuple] = field(default_factory=lambda: [
        (0.0, 10.0, 60.0), (10.0, 30.0, 80.0), (30.0, None, 120.0)
    ])  # used when type=metered_tiered
    water_base_consumption: float = 12.0  # m³/month base
    water_variance: float = 5.0

    # Internet  (None = not included)
    internet_flat_rate: Optional[float] = 2_500.0

    # One-time utility deposit charged on the FIRST invoice of each lease (None = no deposit)
    utility_deposit: Optional[float] = None
    utility_deposit_label: str = "Utility Deposit (Refundable)"


def _default_profiles() -> List[UnitUtilityProfile]:
    """Seven per-unit utility profiles matching units A101–A107."""
    return [
        # A101 — Amara: metered electricity (2-tier) + metered water (flat rate) + internet
        UnitUtilityProfile(
            elec_type="metered_tiered",
            elec_tiers=[(0.0, 200.0, 12.0), (200.0, None, 18.0)],
            water_type="metered_flat",
            water_unit_rate=50.0,
            internet_flat_rate=2_500.0,
            utility_deposit=None,
        ),
        # A102 — Brian: subscription electricity + subscription water, no internet
        UnitUtilityProfile(
            elec_type="subscription",
            elec_flat_rate=3_500.0,
            water_type="subscription",
            water_flat_rate=800.0,
            internet_flat_rate=None,
            utility_deposit=None,
        ),
        # A103 — Cynthia: 3-tier electricity + 3-tier metered water + internet + water deposit
        UnitUtilityProfile(
            elec_type="metered_tiered",
            elec_tiers=[(0.0, 100.0, 10.0), (100.0, 300.0, 15.0), (300.0, None, 22.0)],
            elec_base_consumption=200.0,
            elec_variance=100.0,
            water_type="metered_tiered",
            water_tiers=[(0.0, 10.0, 60.0), (10.0, 30.0, 80.0), (30.0, None, 120.0)],
            water_base_consumption=15.0,
            water_variance=7.0,
            internet_flat_rate=2_500.0,
            utility_deposit=5_000.0,
            utility_deposit_label="Water Security Deposit (Refundable)",
        ),
        # A104 — David / Eve: metered electricity (2-tier) + subscription water + internet + utility deposit
        UnitUtilityProfile(
            elec_type="metered_tiered",
            elec_tiers=[(0.0, 200.0, 12.0), (200.0, None, 18.0)],
            water_type="subscription",
            water_flat_rate=1_000.0,
            internet_flat_rate=2_500.0,
            utility_deposit=10_000.0,
            utility_deposit_label="Utility Deposit (Refundable)",
        ),
        # A105 — Fatuma: 3-tier electricity + metered water (flat), no internet
        UnitUtilityProfile(
            elec_type="metered_tiered",
            elec_tiers=[(0.0, 100.0, 10.0), (100.0, 300.0, 15.0), (300.0, None, 22.0)],
            elec_base_consumption=120.0,
            elec_variance=60.0,
            water_type="metered_flat",
            water_unit_rate=55.0,
            water_base_consumption=10.0,
            water_variance=4.0,
            internet_flat_rate=None,
            utility_deposit=None,
        ),
        # A106 — George: metered electricity (2-tier) + tiered metered water + internet
        # Reliable payer — always full, always on time
        UnitUtilityProfile(
            elec_type="metered_tiered",
            elec_tiers=[(0.0, 200.0, 12.0), (200.0, None, 18.0)],
            elec_base_consumption=160.0,
            elec_variance=40.0,
            water_type="metered_tiered",
            water_tiers=[(0.0, 10.0, 60.0), (10.0, 30.0, 80.0), (30.0, None, 120.0)],
            water_base_consumption=12.0,
            water_variance=3.0,
            internet_flat_rate=2_500.0,
            utility_deposit=None,
        ),
        # A107 — Helen: subscription electricity + subscription water + internet
        # Reliable payer — always full, always on time
        UnitUtilityProfile(
            elec_type="subscription",
            elec_flat_rate=4_000.0,
            water_type="subscription",
            water_flat_rate=1_200.0,
            internet_flat_rate=2_500.0,
            utility_deposit=None,
        ),
    ]


# ── Config ────────────────────────────────────────────────────────────────────

@dataclass
class SeedConfig:
    """Configures the multi-tenant billing simulation."""

    months: int = 12          # total simulation window length
    # Default: N months before today so seeded invoices are always current
    lease_start: date = field(default_factory=lambda: _add_months(date.today().replace(day=1), -12))

    # Rent levels per unit (varied for realism)
    rent_amounts: List[float] = field(default_factory=lambda: [
        25_000.0,   # A101 — Amara
        22_000.0,   # A102 — Brian
        28_000.0,   # A103 — Cynthia
        20_000.0,   # A104 — David / Eve
        18_000.0,   # A105 — Fatuma
        32_000.0,   # A106 — George  (premium unit, reliable payer)
        24_000.0,   # A107 — Helen   (reliable payer)
    ])
    # Deposit = 2× rent + prorated advance rent + utility deposit (computed per-tenant)

    # Per-unit utility profiles (matches unit order A101–A105)
    utility_profiles: List[UnitUtilityProfile] = field(default_factory=_default_profiles)

    late_fee_value: float = 1_000.0
    vat_rate: float = 16.0

    seed: int = 42
    org_id: str = "org_seed_001"
    property_name: str = "Sunrise Apartments"
    owner_email: str = "owner@seedpms.co.ke"
    owner_password: str = "Seed1234!"


# ── Result objects ────────────────────────────────────────────────────────────

@dataclass
class MonthResult:
    billing_month: str
    scenario: str
    invoice_id: str
    reference_no: str
    # ── Charges breakdown (before tax) ──────────────────────────────────────
    rent_charge: float           # rent line item face value
    water_charge: float          # all water line items
    elec_charge: float           # all electricity line items
    internet_charge: float       # internet (and other subscription utilities)
    adj_charge: float            # net adjustments: late_fee + utility_deposit − discount
    tax_amount: float            # VAT on subtotal
    # ── Invoice totals ──────────────────────────────────────────────────────
    total_amount: float          # new charges only (no carried_forward)
    carried_forward: float       # prior outstanding balance — informational, NOT in total
    payment_received: float      # what tenant paid this month (FIFO distributes across invoices)
    amount_paid: float           # amount applied to THIS invoice after FIFO
    balance_due: float           # remaining balance on THIS invoice
    invoice_status: str
    ledger_balance_after: float  # cumulative ledger running balance after all entries this month
    # ── Assertions ──────────────────────────────────────────────────────────
    late_fee: float
    discount_amount: float
    assert_balance_due_correct: bool
    assert_paid_not_exceeds_total: bool
    assert_ledger_consistent: bool
    assert_carried_forward_correct: bool


@dataclass
class TenantResult:
    tenant_name: str
    unit_code: str
    lease_status: str          # active | terminated | expired
    payment_style: str         # "random" | "always_full_on_time"
    lease_start: date
    lease_end: Optional[date]
    months_billed: int
    total_invoiced: float
    total_paid: float
    total_outstanding: float
    final_ledger_balance: float
    all_assertions_passed: bool
    month_results: List[MonthResult]


@dataclass
class SeedResult:
    org_id: str
    property_id: str
    owner_email: str
    owner_password: str
    tenants: List[TenantResult]
    all_assertions_passed: bool

    def print_summary(self) -> None:  # pragma: no cover
        # helper: format number or dash when zero
        def _c(v: float, w: int = 8) -> str:
            return f"{v:>{w},.0f}" if round(v, 2) != 0 else f"{'—':>{w}}"

        # column widths
        W_MONTH = 9; W_SCEN = 16
        W_RENT = 9; W_WATER = 8; W_ELEC = 8; W_NET = 7; W_LF = 7; W_DISC = 7; W_TAX = 7
        W_TOTAL = 9; W_CF = 7; W_RECV = 8; W_PAID = 8; W_BAL = 8; W_LEDGER = 9

        SEP = " │"
        HDR = (
            f"    {'':1} {'Month':<{W_MONTH}}{'Scenario':<{W_SCEN}}"
            f"{'Rent':>{W_RENT}}{'Water':>{W_WATER}}{'Elec':>{W_ELEC}}"
            f"{'Net':>{W_NET}}{'LF':>{W_LF}}{'Disc':>{W_DISC}}{'Tax':>{W_TAX}}"
            f"{SEP}{'Total':>{W_TOTAL}}{'CF':>{W_CF}}{'Recv':>{W_RECV}}"
            f"{'Paid':>{W_PAID}}{'Bal':>{W_BAL}}{'Ledger':>{W_LEDGER}}  Status"
        )
        RULE = "    " + "─" * (len(HDR) - 4)

        print("\n" + "═" * len(HDR))
        print(f"  MULTI-TENANT SEED SUMMARY  |  org={self.org_id}")
        print("═" * len(HDR))

        for tr in self.tenants:
            status_icon = "✓" if tr.all_assertions_passed else "✗"
            style_tag = f"  [{tr.payment_style}]" if tr.payment_style != "random" else ""
            print(
                f"\n  {status_icon} {tr.tenant_name:<20} unit={tr.unit_code}  "
                f"lease={tr.lease_status:<12}months={tr.months_billed}{style_tag}"
            )
            print(
                f"    Invoiced: KES {tr.total_invoiced:>12,.0f}  "
                f"Paid: KES {tr.total_paid:>12,.0f}  "
                f"Outstanding: KES {tr.total_outstanding:>10,.0f}  "
                f"Ledger: KES {tr.final_ledger_balance:>10,.2f}"
            )
            print(HDR)
            print(RULE)
            for m in tr.month_results:
                ok = "✓" if all([
                    m.assert_balance_due_correct,
                    m.assert_paid_not_exceeds_total,
                    m.assert_ledger_consistent,
                    m.assert_carried_forward_correct,
                ]) else "✗"
                scen = m.scenario[:W_SCEN]
                disc_note = f" ⬇{m.discount_amount:,.0f}" if m.discount_amount > 0 else ""
                lf_note   = f" ⚠{m.late_fee:,.0f}"        if m.late_fee > 0        else ""
                print(
                    f"    {ok} {m.billing_month:<{W_MONTH}}{scen:<{W_SCEN}}"
                    f"{_c(m.rent_charge,  W_RENT)}"
                    f"{_c(m.water_charge, W_WATER)}"
                    f"{_c(m.elec_charge,  W_ELEC)}"
                    f"{_c(m.internet_charge, W_NET)}"
                    f"{_c(m.late_fee,     W_LF)}"
                    f"{_c(m.discount_amount, W_DISC)}"
                    f"{_c(m.tax_amount,   W_TAX)}"
                    f"{SEP}"
                    f"{m.total_amount:>{W_TOTAL},.0f}"
                    f"{_c(m.carried_forward, W_CF)}"
                    f"{_c(m.payment_received, W_RECV)}"
                    f"{_c(m.amount_paid,  W_PAID)}"
                    f"{_c(m.balance_due,  W_BAL)}"
                    f"{m.ledger_balance_after:>{W_LEDGER},.0f}"
                    f"  {m.invoice_status}{disc_note}{lf_note}"
                )

        overall = "✓ ALL PASS" if self.all_assertions_passed else "✗ FAILURES"
        print(f"\n  Overall: {overall}")
        print(f"\n  Owner login  email={self.owner_email}  password={self.owner_password}  org_id={self.org_id}")
        print("═" * len(HDR) + "\n")


# ── Pure math helpers ─────────────────────────────────────────────────────────

def _billing_month_str(d: date) -> str:
    return d.strftime("%Y-%m")


def _add_months(d: date, n: int) -> date:
    month = d.month - 1 + n
    year = d.year + month // 12
    month = month % 12 + 1
    last_day = calendar.monthrange(year, month)[1]
    return d.replace(year=year, month=month, day=min(d.day, last_day))


def _compute_tiered(consumption: float, tiers: List[tuple]) -> float:
    """Compute charge for `consumption` units against a list of (from, to|None, rate) bands."""
    if consumption <= 0:
        return 0.0
    total = 0.0
    for (band_from, band_to, rate) in tiers:
        if consumption <= band_from:
            break
        in_band = (consumption - band_from) if band_to is None else min(consumption - band_from, band_to - band_from)
        total += in_band * rate
    return round(total, 2)


def _make_pricing_tiers(tiers: List[tuple]) -> List[PricingTier]:
    return [PricingTier(from_units=f, to_units=t, rate=r) for (f, t, r) in tiers]


def _compute_tax(subtotal: float, cfg: SeedConfig) -> float:
    if cfg.vat_rate <= 0:
        return 0.0
    return round(subtotal * (cfg.vat_rate / 100.0), 2)


def _choose_scenario(rng: random.Random) -> str:
    return rng.choices(_SCENARIOS, weights=_WEIGHTS, k=1)[0]


def _payment_amount(scenario: str, total: float, rng: random.Random) -> float:
    if scenario in ("full_payment", "late_payment"):
        return round(total, 2)
    if scenario == "partial_payment":
        return round(total * rng.uniform(0.40, 0.85), 2)
    if scenario == "late_partial":
        return round(total * rng.uniform(0.30, 0.70), 2)
    if scenario == "overpayment":
        return round(total * rng.uniform(1.05, 1.30), 2)
    return 0.0


def _payment_date(scenario: str, month_start: date, due_date: date, rng: random.Random) -> Optional[date]:
    if scenario == "no_payment":
        return None
    if scenario in ("full_payment", "partial_payment", "overpayment"):
        days = (due_date - month_start).days
        return month_start + timedelta(days=rng.randint(0, max(0, days)))
    return due_date + timedelta(days=rng.randint(1, 10))


def _is_late(scenario: str) -> bool:
    return scenario in ("late_payment", "late_partial")


# ── Reference counters ────────────────────────────────────────────────────────

_inv_counter = 0
_pay_counter = 0


def _next_inv_ref() -> str:
    global _inv_counter
    _inv_counter += 1
    return f"INV-{_inv_counter:06d}"


def _next_pay_ref() -> str:
    global _pay_counter
    _pay_counter += 1
    return f"PAY-{_pay_counter:06d}"


# ── Per-lease billing simulation ──────────────────────────────────────────────

async def _simulate_lease(
    *,
    org_id: str,
    property_id: str,
    unit_id: str,
    lease_id: str,
    tenant_id: str,
    tenant_name: str,
    unit_code: str,
    lease_status: str,
    lease_start_date: date,
    lease_end_date: Optional[date],
    rent_amount: float,
    deposit_amount: float,             # security deposit (paid up-front, ledger entries only)
    month_indices: List[int],          # which global months to bill (0-based)
    sim_start: date,                   # first month of the overall simulation
    utility_profile: UnitUtilityProfile,
    discounts: Optional[Dict[int, float]],  # loop_idx → discount KES (None = no discounts)
    payment_style: str,                      # "random" | "always_full_on_time"
    cfg: SeedConfig,
    rng: random.Random,
) -> TenantResult:
    """Simulate billing for a single lease over its active month range.

    Invoice total = rent + utilities + late_fee + utility_deposit(first month) + discount(−).
    carried_forward is stored on Invoice.carried_forward (informational) but NOT added to the
    invoice subtotal — the ledger running_balance accumulates unpaid debt instead.

    payment_style:
      "random"             — mixed scenarios (partial, late, no payment, etc.)
      "always_full_on_time"— tenant always pays the full invoice amount on or before due date
    """

    elec_meter: float = 1000.0
    water_meter: float = 0.0
    ledger_balance: float = 0.0
    prev_ledger_balance: float = 0.0
    month_results: List[MonthResult] = []
    all_ok = True
    up = utility_profile
    _discounts: Dict[int, float] = discounts or {}

    # ── Deposit breakdown (security deposit + advance rent + utility deposit) ──
    # In Kenya, tenants pay upfront: 2× rent security deposit + 1 month advance
    # rent (prorated if mid-month) + utility deposit if applicable.
    _util_dep_amt = up.utility_deposit or 0.0
    _days_in_month = calendar.monthrange(lease_start_date.year, lease_start_date.month)[1]
    _days_remaining = _days_in_month - lease_start_date.day + 1
    _advance_rent_amt = round(rent_amount * _days_remaining / _days_in_month, 2)
    _sec_dep_amt = round(2 * rent_amount, 2)

    # ── Move-in payment ledger entries (fully settled on lease start date) ──────
    # Tenant pays: 2× rent security deposit + advance rent + utility deposit upfront.
    # All three components are debited then immediately credited (paid in full).
    _dep_desc_parts = [f"Security Deposit (2× KES {_sec_dep_amt:,.0f})"]
    if _advance_rent_amt > 0:
        _dep_desc_parts.append(f"Advance Rent (KES {_advance_rent_amt:,.0f})")
    if _util_dep_amt > 0:
        _dep_desc_parts.append(f"Utility Deposit (KES {_util_dep_amt:,.0f})")
    _dep_full_desc = " + ".join(_dep_desc_parts)

    ledger_balance = round(ledger_balance + deposit_amount, 2)
    await LedgerEntry(
        org_id=org_id, lease_id=lease_id, property_id=property_id, tenant_id=tenant_id,
        type="debit", category="deposit",
        amount=deposit_amount,
        description=f"Move-in Payment Due — {_dep_full_desc}",
        running_balance=ledger_balance,
    ).insert()

    # Payment: full move-in amount received on lease start date
    dep_payment = Payment(
        org_id=org_id, lease_id=lease_id, property_id=property_id, unit_id=unit_id,
        tenant_id=tenant_id, category="deposit", method="bank_transfer",
        direction="inbound", amount=deposit_amount, status="completed",
        payment_date=lease_start_date,
        mpesa_receipt_no=f"DEP{uuid.uuid4().hex[:8].upper()}",
    )
    await dep_payment.insert()

    # Credit: move-in payment received in full
    ledger_balance = round(ledger_balance - deposit_amount, 2)
    await LedgerEntry(
        org_id=org_id, lease_id=lease_id, property_id=property_id, tenant_id=tenant_id,
        payment_id=str(dep_payment.id), type="credit", category="deposit",
        amount=deposit_amount,
        description=f"Move-in Payment Received — {_dep_full_desc}",
        running_balance=ledger_balance,
    ).insert()
    # ledger_balance is back to 0.0 — move-in payment fully settled
    prev_ledger_balance = ledger_balance

    # ── Deposit Invoice (invoice_category="deposit") ──────────────────────────
    # Breakdown: 2× rent security deposit + advance rent + utility deposit.
    if deposit_amount > 0:
        dep_inv_ref = _next_inv_ref()
        dep_billing_month = _billing_month_str(lease_start_date)
        _dep_line_items = [
            InvoiceLineItem(
                type="deposit",
                description="Security Deposit (Refundable — 2 months rent)",
                quantity=1.0,
                unit_price=_sec_dep_amt,
                amount=_sec_dep_amt,
                status="confirmed",
            ),
        ]
        if _advance_rent_amt > 0:
            _dep_line_items.append(InvoiceLineItem(
                type="rent",
                description="Advance Rent (First Month)",
                quantity=1.0,
                unit_price=_advance_rent_amt,
                amount=_advance_rent_amt,
                status="confirmed",
            ))
        if _util_dep_amt > 0:
            _dep_line_items.append(InvoiceLineItem(
                type="deposit",
                description=up.utility_deposit_label,
                quantity=1.0,
                unit_price=_util_dep_amt,
                amount=_util_dep_amt,
                status="confirmed",
            ))
        dep_inv = Invoice(
            org_id=org_id,
            property_id=property_id,
            unit_id=unit_id,
            lease_id=lease_id,
            tenant_id=tenant_id,
            idempotency_key=f"{lease_id}:deposit",
            billing_month=dep_billing_month,
            invoice_category="deposit",
            reference_no=dep_inv_ref,
            due_date=lease_start_date,
            line_items=_dep_line_items,
            subtotal=deposit_amount,
            tax_amount=0.0,
            total_amount=deposit_amount,
            amount_paid=deposit_amount,
            balance_due=0.0,
            carried_forward=0.0,
            sandbox=False,
            status="paid",
            sent_at=datetime(lease_start_date.year, lease_start_date.month, lease_start_date.day, 9, 0, 0, tzinfo=timezone.utc),
            paid_at=datetime(lease_start_date.year, lease_start_date.month, lease_start_date.day, 9, 0, 0, tzinfo=timezone.utc),
            created_by="system",
        )
        await dep_inv.insert()

    for loop_idx, month_idx in enumerate(month_indices):
        month_start = _add_months(date(sim_start.year, sim_start.month, 1), month_idx)
        billing_month = _billing_month_str(month_start)
        due_date = month_start + timedelta(days=7)
        is_first_month = (loop_idx == 0)

        if payment_style == "always_full_on_time":
            scenario = "full_payment"
        else:
            scenario = _choose_scenario(rng)

        # ── Electricity ───────────────────────────────────────────────────────
        if up.elec_type == "subscription":
            elec_line = InvoiceLineItem(
                type="subscription_utility",
                description="Electricity",
                utility_key="electricity",
                quantity=1.0,
                unit_price=up.elec_flat_rate,
                amount=up.elec_flat_rate,
                status="confirmed",
            )
        else:  # metered_tiered
            consumption = max(0.0, round(
                up.elec_base_consumption + rng.uniform(-up.elec_variance, up.elec_variance), 1
            ))
            elec_charge = _compute_tiered(consumption, up.elec_tiers)
            prev_elec = elec_meter
            elec_meter = round(elec_meter + consumption, 1)
            elec_line = InvoiceLineItem(
                type="metered_utility",
                description="Electricity (Metered)",
                utility_key="electricity",
                quantity=consumption,
                unit_price=up.elec_tiers[0][2],   # first-tier rate as display price
                amount=elec_charge,
                tiers=_make_pricing_tiers(up.elec_tiers),
                previous_reading=prev_elec,
                current_reading=elec_meter,
                status="confirmed",
            )

        # ── Water ─────────────────────────────────────────────────────────────
        if up.water_type == "subscription":
            water_line = InvoiceLineItem(
                type="subscription_utility",
                description="Water",
                utility_key="water",
                quantity=1.0,
                unit_price=up.water_flat_rate,
                amount=up.water_flat_rate,
                status="confirmed",
            )
        elif up.water_type == "metered_flat":
            w_consumption = max(0.0, round(
                up.water_base_consumption + rng.uniform(-up.water_variance, up.water_variance), 2
            ))
            prev_water = water_meter
            water_meter = round(water_meter + w_consumption, 2)
            water_line = InvoiceLineItem(
                type="metered_utility",
                description="Water (Metered)",
                utility_key="water",
                quantity=w_consumption,
                unit_price=up.water_unit_rate,
                amount=round(w_consumption * up.water_unit_rate, 2),
                previous_reading=prev_water,
                current_reading=water_meter,
                status="confirmed",
            )
        else:  # metered_tiered
            w_consumption = max(0.0, round(
                up.water_base_consumption + rng.uniform(-up.water_variance, up.water_variance), 2
            ))
            w_charge = _compute_tiered(w_consumption, up.water_tiers)
            prev_water = water_meter
            water_meter = round(water_meter + w_consumption, 2)
            water_line = InvoiceLineItem(
                type="metered_utility",
                description="Water (Metered — Tiered)",
                utility_key="water",
                quantity=w_consumption,
                unit_price=up.water_tiers[0][2],
                amount=w_charge,
                tiers=_make_pricing_tiers(up.water_tiers),
                previous_reading=prev_water,
                current_reading=water_meter,
                status="confirmed",
            )

        # Carried forward from previous month's ledger
        carried_forward = round(max(0.0, prev_ledger_balance), 2)

        # ── Build line items ──────────────────────────────────────────────────
        line_items = [
            InvoiceLineItem(
                type="rent",
                description="Monthly Rent",
                quantity=1.0,
                unit_price=rent_amount,
                amount=rent_amount,
                status="confirmed",
            ),
            water_line,
            elec_line,
        ]

        # Internet (optional per unit)
        if up.internet_flat_rate is not None:
            line_items.append(InvoiceLineItem(
                type="subscription_utility",
                description="Internet",
                utility_key="internet",
                quantity=1.0,
                unit_price=up.internet_flat_rate,
                amount=up.internet_flat_rate,
                status="confirmed",
            ))

        # Rent discount — negotiated concession for specific months
        discount_amount = 0.0
        if loop_idx in _discounts:
            discount_amount = _discounts[loop_idx]
            line_items.append(InvoiceLineItem(
                type="adjustment",
                description="Negotiated Rent Discount",
                quantity=1.0,
                unit_price=-discount_amount,
                amount=-discount_amount,
                status="confirmed",
            ))

        # Late fee — only when property billing config has a non-zero late_fee_value
        late_fee = 0.0
        if _is_late(scenario) and len(month_results) > 0 and cfg.late_fee_value > 0:
            late_fee = cfg.late_fee_value
            line_items.append(InvoiceLineItem(
                type="adjustment",
                description="Late Payment Fee",
                quantity=1.0,
                unit_price=late_fee,
                amount=late_fee,
                status="confirmed",
            ))

        # carried_forward is stored as invoice metadata ONLY — NOT included in subtotal.
        # The ledger running_balance already tracks cumulative unpaid debt.
        # (Adding it to subtotal would double-count previous months' debits.)

        subtotal = round(sum(li.amount for li in line_items if li.status == "confirmed"), 2)
        tax_amount = _compute_tax(subtotal, cfg)
        total_amount = round(subtotal + tax_amount, 2)

        # ── Charges breakdown (from line_items, pre-tax) ──────────────────
        _rent_charge     = round(sum(li.amount for li in line_items if li.type == "rent"), 2)
        _water_charge    = round(sum(li.amount for li in line_items if li.utility_key == "water"), 2)
        _elec_charge     = round(sum(li.amount for li in line_items if li.utility_key == "electricity"), 2)
        _internet_charge = round(sum(
            li.amount for li in line_items
            if li.utility_key not in ("water", "electricity") and li.type in ("subscription_utility", "metered_utility")
        ), 2)
        # Net adjustments = late_fee − discount (utility deposit moved to deposit invoice)
        _adj_charge = round(late_fee - discount_amount, 2)

        # Create invoice
        ref_no = _next_inv_ref()
        invoice = Invoice(
            org_id=org_id,
            property_id=property_id,
            unit_id=unit_id,
            lease_id=lease_id,
            tenant_id=tenant_id,
            idempotency_key=f"{lease_id}:{billing_month}",
            billing_month=billing_month,
            invoice_category="rent",
            status="sent",
            reference_no=ref_no,
            due_date=due_date,
            line_items=line_items,
            subtotal=subtotal,
            tax_amount=tax_amount,
            total_amount=total_amount,
            amount_paid=0.0,
            balance_due=total_amount,
            carried_forward=carried_forward,
            sandbox=False,
            sent_at=utc_now(),
            created_by="system",
        )
        await invoice.insert()
        invoice_id = str(invoice.id)

        # Debit ledger entry
        ledger_balance = round(ledger_balance + total_amount, 2)
        await LedgerEntry(
            org_id=org_id,
            lease_id=lease_id,
            property_id=property_id,
            tenant_id=tenant_id,
            type="debit",
            category="rent",
            amount=total_amount,
            description=f"Invoice {ref_no} — {billing_month}",
            running_balance=ledger_balance,
        ).insert()

        # ── Advance rent pre-payment (collected upfront in deposit) ───────────
        # Apply the advance rent portion of the deposit to the first invoice so
        # it is not double-charged. Balance_due is reduced before regular payment.
        if is_first_month and _advance_rent_amt > 0:
            _adv_apply = min(_advance_rent_amt, total_amount)
            _adv_pay = Payment(
                org_id=org_id, lease_id=lease_id, property_id=property_id, unit_id=unit_id,
                tenant_id=tenant_id, invoice_id=invoice_id,
                category="rent", method="bank_transfer",
                direction="inbound", amount=_adv_apply, status="completed",
                payment_date=lease_start_date,
                mpesa_receipt_no=f"ADV{uuid.uuid4().hex[:8].upper()}",
            )
            await _adv_pay.insert()
            _adv_new_paid = _adv_apply
            _adv_new_balance = round(total_amount - _adv_apply, 2)
            _adv_upd: dict = {
                "amount_paid": _adv_new_paid,
                "balance_due": _adv_new_balance,
                "status": "paid" if _adv_new_balance <= 0.001 else "partial_paid",
                "updated_at": utc_now(),
            }
            if _adv_new_balance <= 0.001:
                _adv_upd["paid_at"] = datetime(
                    lease_start_date.year, lease_start_date.month, lease_start_date.day,
                    9, 0, 0, tzinfo=timezone.utc,
                )
            await invoice.set(_adv_upd)
            ledger_balance = round(ledger_balance - _adv_apply, 2)
            await LedgerEntry(
                org_id=org_id, lease_id=lease_id, property_id=property_id, tenant_id=tenant_id,
                payment_id=str(_adv_pay.id), type="credit", category="rent",
                amount=_adv_apply,
                description=f"Advance Rent Applied — {billing_month}",
                running_balance=ledger_balance,
            ).insert()

        # Payment
        if payment_style == "always_full_on_time":
            # Pay new invoice + any carried-forward balance to stay current every month.
            # Payment arrives a random 0–4 days before due date.
            pay_amount = round(total_amount + carried_forward, 2)
            pay_date = due_date - timedelta(days=rng.randint(0, 4))
        else:
            pay_amount = _payment_amount(scenario, total_amount, rng)
            pay_date = _payment_date(scenario, month_start, due_date, rng)
        amount_paid_on_invoice = 0.0
        payment_received = 0.0
        final_status = invoice.status

        if pay_amount > 0 and pay_date is not None:
            payment_received = pay_amount
            payment = Payment(
                org_id=org_id,
                lease_id=lease_id,
                property_id=property_id,
                unit_id=unit_id,
                tenant_id=tenant_id,
                invoice_id=invoice_id,
                category="rent",
                method="mpesa_stk",
                direction="inbound",
                amount=pay_amount,
                status="completed",
                payment_date=pay_date,
                mpesa_checkout_request_id=f"SEED-{uuid.uuid4().hex[:16].upper()}",
                mpesa_receipt_no=f"RCT{uuid.uuid4().hex[:8].upper()}",
            )
            await payment.insert()

            # FIFO payment application across outstanding RENT invoices only
            # Deposit invoices are a separate pool and must not receive rent payments.
            outstanding = await Invoice.find({
                "org_id": org_id,
                "lease_id": lease_id,
                "invoice_category": "rent",
                "balance_due": {"$gt": 0},
                "deleted_at": None,
            }).sort("billing_month").to_list()

            remaining = pay_amount
            for inv in outstanding:
                if remaining <= 0.0:
                    break
                apply = round(min(remaining, inv.balance_due), 2)
                new_paid = round(inv.amount_paid + apply, 2)
                new_bal = round(max(0.0, inv.total_amount - new_paid), 2)
                new_status = "paid" if new_bal <= 0.001 else "partial_paid"
                update = {"amount_paid": new_paid, "balance_due": new_bal, "status": new_status, "updated_at": utc_now()}
                if new_status == "paid":
                    update["paid_at"] = datetime(pay_date.year, pay_date.month, pay_date.day, 12, 0, 0, tzinfo=timezone.utc)
                await inv.set(update)
                if str(inv.id) == invoice_id:
                    amount_paid_on_invoice = new_paid
                    final_status = new_status
                remaining = round(remaining - apply, 2)

            # Credit ledger entry
            ledger_balance = round(ledger_balance - pay_amount, 2)
            await LedgerEntry(
                org_id=org_id,
                lease_id=lease_id,
                property_id=property_id,
                tenant_id=tenant_id,
                payment_id=str(payment.id),
                type="credit",
                category="rent",
                amount=pay_amount,
                description=f"Payment {_next_pay_ref()} for {billing_month}",
                running_balance=ledger_balance,
            ).insert()

        # Mark overdue only if balance remains AND the due date has actually passed
        inv_fresh = await Invoice.get(PydanticObjectId(invoice_id))
        if inv_fresh:
            past_due = inv_fresh.due_date and inv_fresh.due_date < date.today()
            if inv_fresh.balance_due > 0 and past_due:
                await inv_fresh.set({"status": "overdue", "updated_at": utc_now()})
                final_status = "overdue"
            else:
                final_status = inv_fresh.status
            amount_paid_on_invoice = inv_fresh.amount_paid

        # ── Assertions ────────────────────────────────────────────────────────
        inv_final = await Invoice.get(PydanticObjectId(invoice_id))

        assert1 = abs(inv_final.balance_due - (inv_final.total_amount - inv_final.amount_paid)) < 0.01
        assert2 = inv_final.amount_paid <= inv_final.total_amount + 0.01

        # Ledger chain consistency for this lease
        all_entries = await LedgerEntry.find(
            LedgerEntry.org_id == org_id,
            LedgerEntry.lease_id == lease_id,
        ).sort("created_at").to_list()

        assert3 = True
        acc = 0.0
        for e in all_entries:
            acc = round(acc + e.amount if e.type == "debit" else acc - e.amount, 2)
            if abs(acc - e.running_balance) > 0.02:
                assert3 = False
                break

        assert4 = abs(carried_forward - max(0.0, prev_ledger_balance)) < 0.02

        month_ok = assert1 and assert2 and assert3 and assert4
        all_ok = all_ok and month_ok

        month_results.append(MonthResult(
            billing_month=billing_month,
            scenario=scenario,
            invoice_id=invoice_id,
            reference_no=ref_no,
            rent_charge=_rent_charge,
            water_charge=_water_charge,
            elec_charge=_elec_charge,
            internet_charge=_internet_charge,
            adj_charge=_adj_charge,
            tax_amount=tax_amount,
            total_amount=total_amount,
            carried_forward=carried_forward,
            payment_received=payment_received,
            amount_paid=amount_paid_on_invoice,
            balance_due=round(total_amount - amount_paid_on_invoice, 2),
            late_fee=late_fee,
            discount_amount=discount_amount,
            invoice_status=final_status,
            ledger_balance_after=ledger_balance,
            assert_balance_due_correct=assert1,
            assert_paid_not_exceeds_total=assert2,
            assert_ledger_consistent=assert3,
            assert_carried_forward_correct=assert4,
        ))

        prev_ledger_balance = ledger_balance

    # Only rent invoices for stats — deposit invoices are a separate pool
    all_invoices = await Invoice.find(
        Invoice.org_id == org_id,
        Invoice.lease_id == lease_id,
        Invoice.invoice_category == "rent",
    ).to_list()

    return TenantResult(
        tenant_name=tenant_name,
        unit_code=unit_code,
        lease_status=lease_status,
        payment_style=payment_style,
        lease_start=lease_start_date,
        lease_end=lease_end_date,
        months_billed=len(month_indices),
        total_invoiced=round(sum(i.total_amount for i in all_invoices), 2),
        total_paid=round(sum(i.amount_paid for i in all_invoices), 2),
        total_outstanding=round(sum(i.balance_due for i in all_invoices), 2),
        final_ledger_balance=ledger_balance,
        all_assertions_passed=all_ok,
        month_results=month_results,
    )


# ── Core seed function ────────────────────────────────────────────────────────

async def run_seed(config: SeedConfig = SeedConfig()) -> SeedResult:
    """
    Execute the multi-tenant billing simulation.

    Must be called inside an active Beanie context (init_beanie already called).
    """
    global _inv_counter, _pay_counter
    _inv_counter = 0
    _pay_counter = 0

    rng = random.Random(config.seed)
    sim_start = config.lease_start
    N = config.months

    # ── 1. Org ────────────────────────────────────────────────────────────────
    if config.org_id!="org_seed_001":
        org = Org(
            org_id=config.org_id,
            billing_config=BillingConfig(auto_generation_enabled=False, payment_grace_days=7),
            tax_config=TaxConfig(vat_enabled=config.vat_rate > 0, vat_rate=config.vat_rate, vat_inclusive=False),
            ledger_settings=LedgerSettings(currency="KES", invoice_prefix="INV"),
            invoice_counter=0,
            ticket_counter=0,
        )
        await org.insert()

    # ── Owner user (login with these credentials) ──────────────────────────────
    owner_user = User(
        email=config.owner_email,
        hashed_password=hash_password(config.owner_password),
        org_id=config.org_id,
        role="owner",
        first_name="Seed",
        last_name="Owner",
        phone="+254700000000",
        is_active=True,
    )
    await owner_user.insert()

    # ── 2. Property ───────────────────────────────────────────────────────────
    prop = Property(
        org_id=config.org_id,
        name=config.property_name,
        property_type="apartment",
        region="Nairobi",
        address=Address(street="123 Sunrise Road", city="Nairobi", state="Nairobi"),
        billing_settings=BillingSettings(
            invoice_day=1, due_days=7, grace_days=3,
            late_fee_type="flat", late_fee_value=config.late_fee_value,
        ),
        utility_defaults=UtilityDefaults(
            # Property-level defaults — units may override via utility_overrides
            electricity=UtilityDetail(
                type="metered", label="Electricity", unit="kWh",
                tiers=[
                    PricingTier(from_units=0.0, to_units=200.0, rate=12.0),
                    PricingTier(from_units=200.0, to_units=None, rate=18.0),
                ],
            ),
            water=UtilityDetail(type="subscription", label="Water", rate=800.0),
            internet=UtilityDetail(type="subscription", label="Internet", rate=2_500.0),
        ),
    )
    await prop.insert()
    property_id = str(prop.id)

    # ── 3. Units — with per-unit utility overrides ─────────────────────────────
    unit_codes = ["A101", "A102", "A103", "A104", "A105", "A106", "A107"]
    units = []

    def _up_to_utility_detail(up: UnitUtilityProfile) -> "UtilityOverride":
        from app.models.unit import UtilityOverride as UO

        # Electricity
        if up.elec_type == "subscription":
            elec = UtilityDetail(type="subscription", label="Electricity", unit="KES/mo", rate=up.elec_flat_rate)
        else:
            elec = UtilityDetail(
                type="metered", label="Electricity", unit="kWh",
                tiers=_make_pricing_tiers(up.elec_tiers),
            )

        # Water
        if up.water_type == "subscription":
            water = UtilityDetail(type="subscription", label="Water", unit="KES/mo", rate=up.water_flat_rate)
        elif up.water_type == "metered_flat":
            water = UtilityDetail(
                type="metered", label="Water", unit="m³",
                tiers=[PricingTier(from_units=0.0, to_units=None, rate=up.water_unit_rate)],
                deposit=None,
            )
        else:  # metered_tiered
            water = UtilityDetail(
                type="metered", label="Water", unit="m³",
                tiers=_make_pricing_tiers(up.water_tiers),
                deposit=up.utility_deposit,
            )

        internet = (
            UtilityDetail(type="subscription", label="Internet", unit="KES/mo", rate=up.internet_flat_rate)
            if up.internet_flat_rate is not None else None
        )
        return UO(electricity=elec, water=water, internet=internet)

    for i, code in enumerate(unit_codes):
        up = config.utility_profiles[i]
        u = Unit(
            org_id=config.org_id,
            property_id=str(prop.id),
            unit_code=code,
            unit_number=code[1:],
            floor=int(code[1]),
            wing=code[0],          # "A" from "A101"
            rent_base=config.rent_amounts[i],
            status="vacant",       # corrected after leases are created
            utility_deposit=up.utility_deposit,
            utility_overrides=_up_to_utility_detail(up),
        )
        await u.insert()
        units.append(u)

    # Sync unit_count on property
    await prop.set({"unit_count": len(units)})

    # ── 4. Tenant definitions ─────────────────────────────────────────────────
    # Each entry: (first, last, email, unit_idx, lease_months, start_offset, final_status)
    #   start_offset = how many months into the simulation the lease starts
    #   lease_months = how many months the lease runs
    #   final_status = active | terminated | expired

    # discounts: loop_idx (0-based within lease months) → discount KES
    # Applied mid-lease to 2 tenants to simulate negotiated concessions.
    _amara_discount_idx  = min(9, N - 1)   # ~month 10 of 18
    _cynthia_months      = min(12, N)
    _cynthia_disc_idx_1  = _cynthia_months // 2        # mid-lease
    _cynthia_disc_idx_2  = max(0, _cynthia_months - 2) # penultimate month

    tenant_defs = [
        # (first, last, email, unit_idx, lease_months, start_offset, final_status, discounts_dict, payment_style)
        # Amara: active, full run from month 0 — discount at month ~10
        ("Amara",   "Oduya",   "amara.oduya@example.com",   0, N,      0, "active",
         {_amara_discount_idx: 2_500.0}, "random"),
        # Brian: terminated early — no discounts
        ("Brian",   "Mwangi",  "brian.mwangi@example.com",  1, 6,      0, "terminated",
         {}, "random"),
        # Cynthia: 12-month lease, two discounts (mid-lease + near end)
        ("Cynthia", "Njeri",   "cynthia.njeri@example.com", 2, _cynthia_months, 0, "expired",
         {_cynthia_disc_idx_1: 3_000.0, _cynthia_disc_idx_2: 2_000.0}, "random"),
        # David: 8-month, no discounts
        ("David",   "Kamau",   "david.kamau@example.com",   3, min(8, N),  0, "expired",
         {}, "random"),
        # Eve: re-let at month 10, no discounts
        ("Eve",     "Wanjiku", "eve.wanjiku@example.com",   3, max(0, N - 10), 10, "active",
         {}, "random"),
        # Fatuma: late joiner, no discounts
        ("Fatuma",  "Hassan",  "fatuma.hassan@example.com", 4, max(0, N - 5),  5, "active",
         {}, "random"),
        # George: reliable payer — premium unit, active full run, always pays in full on time
        ("George",  "Otieno",  "george.otieno@example.com", 5, N,      0, "active",
         {}, "always_full_on_time"),
        # Helen: reliable payer — joined at month 3, always pays in full on time
        ("Helen",   "Kariuki", "helen.kariuki@example.com", 6, max(0, N - 3), 3, "active",
         {}, "always_full_on_time"),
    ]

    tenant_results: List[TenantResult] = []
    all_ok = True

    for (first, last, email, unit_idx, lease_months, start_offset, final_status, tenant_discounts, payment_style) in tenant_defs:
        if lease_months <= 0:
            continue  # simulation too short for this tenant to appear

        unit = units[unit_idx]
        rent = config.rent_amounts[unit_idx]
        lease_start_date = _add_months(sim_start, start_offset)
        # Deposit = 2× rent (security) + prorated advance rent + utility deposit
        _u_profile = config.utility_profiles[unit_idx]
        _u_dep = _u_profile.utility_deposit or 0.0
        _dim = calendar.monthrange(lease_start_date.year, lease_start_date.month)[1]
        _adv = round(rent * (_dim - lease_start_date.day + 1) / _dim, 2)
        _sec_dep_amt = round(2 * rent, 2)
        dep = round(_sec_dep_amt + _adv + _u_dep, 2)
        lease_end_date = _add_months(lease_start_date, lease_months) if final_status != "active" else None

        # Create user — created_at = lease start date; is_active matches lease status
        tenant_user = User(
            email=email,
            hashed_password=hash_password("TestPass123!"),
            org_id=config.org_id,
            role="tenant",
            first_name=first,
            last_name=last,
            phone=f"+25470{rng.randint(1000000, 9999999)}",
            is_active=(final_status == "active"),
            created_at=datetime(
                lease_start_date.year, lease_start_date.month, lease_start_date.day,
                9, 0, 0, tzinfo=timezone.utc,
            ),
        )
        await tenant_user.insert()

        # Create lease — use simulation dates, not utc_now()
        def _sim_dt(d: date) -> datetime:
            return datetime(d.year, d.month, d.day, 9, 0, 0, tzinfo=timezone.utc)

        # deposit_amount = security deposit only (2× rent) — _compute_required adds
        # utility_deposit + prorated_rent on top to get the full move-in requirement.
        lease = Lease(
            org_id=config.org_id,
            property_id=property_id,
            unit_id=str(unit.id),
            tenant_id=str(tenant_user.id),
            status=final_status,
            start_date=lease_start_date,
            end_date=lease_end_date,
            rent_amount=rent,
            deposit_amount=_sec_dep_amt,   # 2× rent (refundable security deposit)
            utility_deposit=_u_dep if _u_dep > 0 else None,
            signed_at=_sim_dt(lease_start_date),
            activated_at=_sim_dt(lease_start_date),
            terminated_at=_sim_dt(lease_end_date) if final_status == "terminated" and lease_end_date else None,
        )
        await lease.insert()

        month_indices = list(range(start_offset, start_offset + lease_months))

        result = await _simulate_lease(
            org_id=config.org_id,
            property_id=property_id,
            unit_id=str(unit.id),
            lease_id=str(lease.id),
            tenant_id=str(tenant_user.id),
            tenant_name=f"{first} {last}",
            unit_code=unit.unit_code,
            lease_status=final_status,
            lease_start_date=lease_start_date,
            lease_end_date=lease_end_date,
            rent_amount=rent,
            deposit_amount=dep,
            month_indices=month_indices,
            sim_start=sim_start,
            utility_profile=config.utility_profiles[unit_idx],
            discounts=tenant_discounts,
            payment_style=payment_style,
            cfg=config,
            rng=rng,
        )
        tenant_results.append(result)
        all_ok = all_ok and result.all_assertions_passed

        # ── Deposit refund for ended leases ───────────────────────────────────
        # Only the security deposit (2× rent) is refundable. Advance rent was
        # consumed by the first invoice; utility deposit is non-refundable here.
        if final_status in ("terminated", "expired") and _sec_dep_amt > 0:
            outstanding = result.total_outstanding
            deduction = min(outstanding, _sec_dep_amt)
            refund_amt = round(_sec_dep_amt - deduction, 2)
            current_balance = result.final_ledger_balance
            refund_date = lease_end_date or _add_months(lease_start_date, lease_months)

            # Credit: deposit applied to cover outstanding rent balance
            if deduction > 0:
                current_balance = round(current_balance - deduction, 2)
                await LedgerEntry(
                    org_id=config.org_id, lease_id=str(lease.id),
                    property_id=property_id, tenant_id=str(tenant_user.id),
                    type="credit", category="deposit",
                    amount=deduction,
                    description="Security Deposit — Applied to Outstanding Rent",
                    running_balance=current_balance,
                ).insert()

                # FIFO-clear outstanding rent invoices so balance_due reflects
                # the deposit application (otherwise arrears report shows them as unpaid)
                inv_to_clear = await Invoice.find({
                    "org_id": config.org_id,
                    "lease_id": str(lease.id),
                    "invoice_category": "rent",
                    "balance_due": {"$gt": 0},
                    "deleted_at": None,
                }).sort("billing_month").to_list()
                rem = deduction
                for _inv in inv_to_clear:
                    if rem <= 0:
                        break
                    apply = min(rem, _inv.balance_due)
                    new_paid = round(_inv.amount_paid + apply, 2)
                    new_balance = round(_inv.balance_due - apply, 2)
                    new_status = "paid" if new_balance == 0 else _inv.status
                    await _inv.set({
                        "amount_paid": new_paid,
                        "balance_due": new_balance,
                        "status": new_status,
                        "updated_at": utc_now(),
                    })
                    rem = round(rem - apply, 2)

            # Refund: outbound payment + ledger entry
            if refund_amt > 0:
                refund_pay = Payment(
                    org_id=config.org_id, lease_id=str(lease.id),
                    property_id=property_id, unit_id=str(unit.id),
                    tenant_id=str(tenant_user.id),
                    category="refund", method="bank_transfer",
                    direction="outbound", amount=refund_amt, status="completed",
                    payment_date=refund_date,
                    mpesa_receipt_no=f"REF{uuid.uuid4().hex[:8].upper()}",
                )
                await refund_pay.insert()
                # Debit: landlord disburses deposit refund
                current_balance = round(current_balance + refund_amt, 2)
                await LedgerEntry(
                    org_id=config.org_id, lease_id=str(lease.id),
                    property_id=property_id, tenant_id=str(tenant_user.id),
                    payment_id=str(refund_pay.id),
                    type="debit", category="deposit",
                    amount=refund_amt,
                    description=f"Security Deposit — Refunded ({refund_date.strftime('%b %Y')})",
                    running_balance=current_balance,
                ).insert()

    # ── Reconcile unit statuses based on final active leases ──────────────────
    # A unit is "occupied" only if its most-recently-assigned tenant is active.
    # Multiple tenants can share a unit (e.g. David expired → Eve active on A104).
    active_unit_indices: set[int] = set()
    for (_, _, _, unit_idx, lease_months, _, final_status, _, _) in tenant_defs:
        if lease_months <= 0:
            continue
        if final_status == "active":
            active_unit_indices.add(unit_idx)
        else:
            # Only remove if no later "active" lease on the same unit
            active_unit_indices.discard(unit_idx)
    # Re-apply active wins (process in order so last entry on a unit_idx wins)
    final_status_by_idx: dict[int, str] = {}
    for (_, _, _, unit_idx, lease_months, _, final_status, _, _) in tenant_defs:
        if lease_months > 0:
            final_status_by_idx[unit_idx] = final_status
    for i, unit in enumerate(units):
        status = "occupied" if final_status_by_idx.get(i) == "active" else "vacant"
        await unit.set({"status": status})

    return SeedResult(
        org_id=config.org_id,
        property_id=property_id,
        owner_email=config.owner_email,
        owner_password=config.owner_password,
        tenants=tenant_results,
        all_assertions_passed=all_ok,
    )


# ── Standalone script entry point ─────────────────────────────────────────────

if __name__ == "__main__":  # pragma: no cover
    import argparse
    import asyncio

    from beanie import init_beanie
    from motor.motor_asyncio import AsyncIOMotorClient

    from app.core.config import settings
    from app.models.audit_log import AuditLog
    from app.models.invoice import BillingCycleRun
    from app.models.job_run import JobRun
    from app.models.onboarding import Onboarding

    _ALL_MODELS = [
        Org, Property, Unit, User, Lease,
        Invoice, BillingCycleRun, Payment, LedgerEntry,
        AuditLog, JobRun, Onboarding,
    ]

    parser = argparse.ArgumentParser(description="PMS multi-tenant billing seed")
    parser.add_argument("--months",         type=int,   default=12)
    parser.add_argument("--seed",           type=int,   default=42)
    parser.add_argument("--lease-start",    type=str,   default=None,      help="YYYY-MM (default: N months before today)")
    parser.add_argument("--vat",            type=float, default=16.0)
    parser.add_argument("--db",             type=str,   default=settings.mongo_db,   help="MongoDB database (default: MONGO_DB env)")
    parser.add_argument("--org-id",         type=str,   default="org_seed_001",       help="org_id for all seeded records")
    parser.add_argument("--property-name",  type=str,   default="Sunrise Apartments", help="Property name")
    parser.add_argument("--owner-email",    type=str,   default="owner@seedpms.co.ke",help="Owner login email")
    parser.add_argument("--owner-password", type=str,   default="Seed1234!",          help="Owner login password")
    parser.add_argument("--drop",           action="store_true", help="Drop the database before seeding")
    args = parser.parse_args()

    if args.lease_start is None:
        # Default: start N months before today so all seeded invoices are recent
        _today = date.today().replace(day=1)
        _start = _add_months(_today, -args.months)
        args.lease_start = _start.strftime("%Y-%m")
    year, month = map(int, args.lease_start.split("-"))
    cfg = SeedConfig(
        lease_start=date(year, month, 1),
        months=args.months,
        seed=args.seed,
        vat_rate=args.vat,
        org_id=args.org_id,
        property_name=args.property_name,
        owner_email=args.owner_email,
        owner_password=args.owner_password,
    )

    async def _main() -> None:
        client = AsyncIOMotorClient(settings.mongo_uri)
        db = client[args.db]
        if args.drop:
            print(f"[seed] Dropping database '{args.db}'...")
            await client.drop_database(args.db)
        await init_beanie(database=db, document_models=_ALL_MODELS)
        result = await run_seed(cfg)
        result.print_summary()

    asyncio.run(_main())
