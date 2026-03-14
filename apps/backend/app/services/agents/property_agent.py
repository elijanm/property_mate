"""
PropertyAgent — deep intelligence for a single property.

Tools available (property-scoped):
  get_property_overview     — units, occupancy, installed apps, config
  list_units                — all units with status, tenant, rent
  list_active_tenants       — tenants in this property
  get_tenant_detail         — full profile, lease, outstanding balance
  list_property_tickets     — tickets for this property
  get_property_financials   — invoices/revenue specific to this property
  list_inventory_items      — stock items in this property
  list_assets               — assets in this property
  get_best_tenants          — top tenants ranked by payment behaviour & tenure
  get_top_units             — highest-rent units in this property
  get_invoice_analytics     — collection rate, overdue breakdown, top invoices
  get_lease_analytics       — active leases, rent range, expiry overview
  get_ticket_analytics      — resolution rate, category/priority breakdown
  ask_portfolio_question    — escalate a broader question to the OwnerAgent
"""
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.dependencies.auth import CurrentUser
from app.services.agents.base_agent import BaseAgent


class PropertyAgent(BaseAgent):
    agent_type = "property"

    def __init__(self, current_user: CurrentUser, context: Optional[Dict[str, Any]] = None, ai_config: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(current_user, context, ai_config)
        self._property_id: str = (context or {}).get("property_id", "")
        self._property_name: str = (context or {}).get("property_name", "this property")

    async def get_system_prompt(self) -> str:
        now = datetime.now(timezone.utc).strftime("%A, %d %B %Y %H:%M UTC")
        return f"""You are the Property AI assistant for "{self._property_name}".
You have deep, real-time knowledge of every aspect of this specific property.

Current date/time: {now}
Property ID: {self._property_id}
User role: {self.current_user.role}

Your expertise covers:
- Unit occupancy, vacant units, and rent rolls
- Active tenants — their leases, balances, payment history
- Maintenance tickets and their status
- Financial performance (invoices, collections, outstanding)
- Inventory stock levels and asset tracking

Guidelines:
- Always fetch live data with tools before answering
- Focus answers on THIS property unless the user asks about the broader portfolio
- For portfolio-wide questions use the `ask_portfolio_question` tool to consult
  the portfolio AI, then blend the answer naturally
- Be concise; use numbers, full currency names (e.g. "Kenyan Shillings 1,200"), and percentages — never abbreviate as KES, KSH, or USD
- If a tenant or unit is not found in this property, say so clearly"""

    def get_tool_definitions(self) -> List[Dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "get_property_overview",
                    "description": "Get a snapshot of this property: unit counts, occupancy, installed apps.",
                    "parameters": {"type": "object", "properties": {}, "required": []},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "list_units",
                    "description": "List all units in this property with their status, tenant name, and rent.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "status": {
                                "type": "string",
                                "description": "Filter by status: occupied, vacant, maintenance",
                            }
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "list_active_tenants",
                    "description": "List all active tenants in this property with their unit, lease end date, and balance.",
                    "parameters": {"type": "object", "properties": {}, "required": []},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_tenant_detail",
                    "description": "Get full details for a specific tenant: profile, lease terms, payment history, open invoices.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "tenant_id": {"type": "string"},
                            "tenant_name": {"type": "string", "description": "Search by name if ID is not known"},
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "list_property_tickets",
                    "description": "List maintenance and service tickets for this property.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "status": {"type": "string", "description": "open | in_progress | resolved | closed"},
                            "priority": {"type": "string", "description": "critical | high | medium | low"},
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_property_financials",
                    "description": "Get financial summary for this property: invoiced, collected, outstanding, recent invoices.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "months_back": {"type": "integer", "description": "How many months back (default 3)"},
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "list_inventory_items",
                    "description": "List inventory/stock items tracked in this property.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "category": {"type": "string", "description": "Filter by item category"},
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "list_assets",
                    "description": "List physical assets (equipment, furniture, appliances) in this property.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "lifecycle_status": {"type": "string", "description": "active | maintenance | disposed"},
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_best_tenants",
                    "description": "Rank tenants in this property by payment behaviour, collection rate, and tenure length. Use to answer 'who are the best tenants here?'",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "limit": {"type": "integer", "description": "Number of top tenants (default 10)"},
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_top_units",
                    "description": "List highest-value units in this property ranked by rent. Use to answer 'which are the best/top units?'",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "limit": {"type": "integer", "description": "Number of units (default 10)"},
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_invoice_analytics",
                    "description": "Invoice performance for this property: collection rate, overdue count, status breakdown, average invoice size.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "months_back": {"type": "integer", "description": "Lookback in months (default 6)"},
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_lease_analytics",
                    "description": "Lease health for this property: active vs expired counts, average rent, upcoming renewals.",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_ticket_analytics",
                    "description": "Ticket analytics for this property: open vs resolved, avg resolution time, category and priority breakdown.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "days_back": {"type": "integer", "description": "Lookback in days (default 90)"},
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "ask_portfolio_question",
                    "description": "Ask the portfolio-level Owner AI a question that requires cross-property data or broader context.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "question": {
                                "type": "string",
                                "description": "The question to ask the portfolio AI",
                            }
                        },
                        "required": ["question"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "send_message_to_tenant",
                    "description": (
                        "Compose and send a professional email or WhatsApp message to a tenant in this property. "
                        "ALWAYS show the drafted message to the user and ask for confirmation before calling this tool. "
                        "Use for rent reminders, payment notices, lease updates, general communication."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "tenant_id": {"type": "string", "description": "The tenant's user ID"},
                            "channel": {"type": "string", "enum": ["email", "whatsapp"], "description": "Delivery channel"},
                            "subject": {"type": "string", "description": "Email subject or message title"},
                            "body": {"type": "string", "description": "Full message body — must be professional"},
                        },
                        "required": ["tenant_id", "channel", "subject", "body"],
                    },
                },
            },
        ]

    async def execute_tool(self, tool_name: str, arguments: Dict) -> str:
        try:
            if tool_name == "get_property_overview":
                return await self._get_property_overview()
            elif tool_name == "list_units":
                return await self._list_units(arguments.get("status"))
            elif tool_name == "list_active_tenants":
                return await self._list_active_tenants()
            elif tool_name == "get_tenant_detail":
                return await self._get_tenant_detail(
                    arguments.get("tenant_id"), arguments.get("tenant_name")
                )
            elif tool_name == "list_property_tickets":
                return await self._list_property_tickets(
                    arguments.get("status"), arguments.get("priority")
                )
            elif tool_name == "get_property_financials":
                return await self._get_property_financials(arguments.get("months_back", 3))
            elif tool_name == "list_inventory_items":
                return await self._list_inventory_items(arguments.get("category"))
            elif tool_name == "list_assets":
                return await self._list_assets(arguments.get("lifecycle_status"))
            elif tool_name == "get_best_tenants":
                return await self._get_best_tenants(arguments.get("limit", 10))
            elif tool_name == "get_top_units":
                return await self._get_top_units(arguments.get("limit", 10))
            elif tool_name == "get_invoice_analytics":
                return await self._get_invoice_analytics(arguments.get("months_back", 6))
            elif tool_name == "get_lease_analytics":
                return await self._get_lease_analytics()
            elif tool_name == "get_ticket_analytics":
                return await self._get_ticket_analytics(arguments.get("days_back", 90))
            elif tool_name == "ask_portfolio_question":
                return await self._ask_portfolio_question(arguments.get("question", ""))
            elif tool_name == "send_message_to_tenant":
                return await self._send_message_to_tenant(
                    arguments.get("tenant_id", ""),
                    arguments.get("channel", "email"),
                    arguments.get("subject", ""),
                    arguments.get("body", ""),
                )
            else:
                return f"Unknown tool: {tool_name}"
        except Exception as e:
            return f"Tool error ({tool_name}): {e}"

    # ── Tool implementations ───────────────────────────────────────────────

    async def _get_property_overview(self) -> str:
        from app.models.property import Property
        from app.repositories.property_repository import property_repository

        prop = await property_repository.get_by_id(
            self._property_id, self.current_user.org_id
        )
        if not prop:
            return json.dumps({"error": "Property not found"})

        return json.dumps({
            "id": str(prop.id),
            "name": prop.name,
            "type": getattr(prop, "property_type", ""),
            "status": getattr(prop, "status", ""),
            "unit_count": getattr(prop, "unit_count", 0),
            "occupied_units": getattr(prop, "occupied_units", 0),
            "installed_apps": getattr(prop, "installed_apps", []),
            "city": getattr(getattr(prop, "address", None), "city", "") or "",
        })

    async def _list_units(self, status: Optional[str]) -> str:
        from app.models.unit import Unit

        filters = [
            Unit.org_id == self.current_user.org_id,
            Unit.property_id == self._property_id,
            Unit.deleted_at == None,  # noqa: E711
        ]
        if status:
            filters.append(Unit.status == status)

        units = await Unit.find(*filters).limit(100).to_list()
        result = [
            {
                "id": str(u.id),
                "unit_code": getattr(u, "unit_code", ""),
                "floor": getattr(u, "floor", ""),
                "status": getattr(u, "status", ""),
                "rent": getattr(u, "rent", 0),
                "tenant_name": getattr(u, "tenant_name", "") or "",
                "tenant_id": getattr(u, "tenant_id", "") or "",
                "bedrooms": getattr(u, "bedrooms", None),
            }
            for u in units
        ]
        return json.dumps(result)

    async def _list_active_tenants(self) -> str:
        from app.models.tenant import Tenant

        tenants = await Tenant.find(
            Tenant.org_id == self.current_user.org_id,
            Tenant.property_id == self._property_id,
            Tenant.status == "active",
            Tenant.deleted_at == None,  # noqa: E711
        ).limit(100).to_list()

        result = [
            {
                "id": str(t.id),
                "full_name": getattr(t, "full_name", ""),
                "email": getattr(t, "email", ""),
                "phone": getattr(t, "phone", ""),
                "unit_code": getattr(t, "unit_code", ""),
                "lease_end": getattr(t, "lease_end_date", "") or "",
                "outstanding_balance": getattr(t, "outstanding_balance", 0) or 0,
            }
            for t in tenants
        ]
        return json.dumps(result)

    async def _get_tenant_detail(
        self, tenant_id: Optional[str], tenant_name: Optional[str]
    ) -> str:
        from app.models.tenant import Tenant
        from app.models.invoice import Invoice
        from beanie import PydanticObjectId

        org_id = self.current_user.org_id

        if tenant_id:
            tenant = await Tenant.find_one(
                Tenant.id == PydanticObjectId(tenant_id),
                Tenant.org_id == org_id,
                Tenant.deleted_at == None,  # noqa: E711
            )
        elif tenant_name:
            all_t = await Tenant.find(
                Tenant.org_id == org_id,
                Tenant.property_id == self._property_id,
                Tenant.deleted_at == None,  # noqa: E711
            ).to_list()
            q = (tenant_name or "").lower()
            tenant = next(
                (t for t in all_t if q in (getattr(t, "full_name", "") or "").lower()), None
            )
        else:
            return json.dumps({"error": "Provide tenant_id or tenant_name"})

        if not tenant:
            return json.dumps({"error": "Tenant not found in this property"})

        # Recent invoices
        invoices = await Invoice.find(
            Invoice.org_id == org_id,
            Invoice.tenant_id == str(tenant.id),
            Invoice.deleted_at == None,  # noqa: E711
        ).sort("-created_at").limit(6).to_list()

        inv_data = [
            {
                "invoice_number": getattr(i, "invoice_number", ""),
                "total": getattr(i, "total_amount", 0),
                "paid": getattr(i, "amount_paid", 0),
                "balance": getattr(i, "balance_due", 0),
                "status": getattr(i, "status", ""),
                "due_date": i.due_date.isoformat() if getattr(i, "due_date", None) else "",
            }
            for i in invoices
        ]

        return json.dumps({
            "id": str(tenant.id),
            "full_name": getattr(tenant, "full_name", ""),
            "email": getattr(tenant, "email", ""),
            "phone": getattr(tenant, "phone", ""),
            "id_number": getattr(tenant, "id_number", ""),
            "unit_code": getattr(tenant, "unit_code", ""),
            "status": getattr(tenant, "status", ""),
            "outstanding_balance": getattr(tenant, "outstanding_balance", 0) or 0,
            "recent_invoices": inv_data,
        })

    async def _list_property_tickets(
        self, status: Optional[str], priority: Optional[str]
    ) -> str:
        from app.models.ticket import Ticket

        filters = [
            Ticket.org_id == self.current_user.org_id,
            Ticket.property_id == self._property_id,
            Ticket.deleted_at == None,  # noqa: E711
        ]
        if status:
            filters.append(Ticket.status == status)
        else:
            filters.append(Ticket.status.in_(["open", "in_progress"]))  # type: ignore[attr-defined]
        if priority:
            filters.append(Ticket.priority == priority)

        tickets = await Ticket.find(*filters).sort("-created_at").limit(30).to_list()
        result = [
            {
                "id": str(t.id),
                "reference": getattr(t, "reference_number", ""),
                "title": getattr(t, "title", ""),
                "category": getattr(t, "category", ""),
                "priority": getattr(t, "priority", ""),
                "status": getattr(t, "status", ""),
                "assigned_to_name": getattr(t, "assigned_to_name", "") or "",
                "unit_code": getattr(t, "unit_code", "") or "",
                "created_at": t.created_at.isoformat() if t.created_at else "",
            }
            for t in tickets
        ]
        return json.dumps(result)

    async def _get_property_financials(self, months_back: int) -> str:
        from app.models.invoice import Invoice

        org_id = self.current_user.org_id
        since = datetime.now(timezone.utc) - timedelta(days=months_back * 30)

        invoices = await Invoice.find(
            Invoice.org_id == org_id,
            Invoice.property_id == self._property_id,
            Invoice.created_at >= since,
            Invoice.deleted_at == None,  # noqa: E711
        ).to_list()

        total = sum(getattr(i, "total_amount", 0) or 0 for i in invoices)
        paid = sum(getattr(i, "amount_paid", 0) or 0 for i in invoices)
        overdue = sum(
            getattr(i, "balance_due", 0) or 0
            for i in invoices
            if getattr(i, "status", "") in ("overdue", "partial", "sent")
            and getattr(i, "due_date", None)
            and i.due_date < datetime.now(timezone.utc)
        )

        return json.dumps({
            "period_months": months_back,
            "total_invoiced_kes": round(total, 2),
            "total_collected_kes": round(paid, 2),
            "outstanding_kes": round(total - paid, 2),
            "overdue_kes": round(overdue, 2),
            "invoice_count": len(invoices),
        })

    async def _list_inventory_items(self, category: Optional[str]) -> str:
        from app.models.inventory import InventoryItem

        filters = [
            InventoryItem.org_id == self.current_user.org_id,
            InventoryItem.property_id == self._property_id,
            InventoryItem.deleted_at == None,  # noqa: E711
        ]
        if category:
            filters.append(InventoryItem.category == category)

        items = await InventoryItem.find(*filters).limit(50).to_list()
        result = [
            {
                "id": str(i.id),
                "name": getattr(i, "name", ""),
                "category": getattr(i, "category", ""),
                "quantity_available": getattr(i, "quantity_available", 0),
                "quantity_unit": getattr(i, "quantity_unit", ""),
                "status": getattr(i, "status", ""),
            }
            for i in items
        ]
        return json.dumps(result)

    async def _list_assets(self, lifecycle_status: Optional[str]) -> str:
        from app.models.asset import Asset

        filters = [
            Asset.org_id == self.current_user.org_id,
            Asset.property_id == self._property_id,
            Asset.deleted_at == None,  # noqa: E711
        ]
        if lifecycle_status:
            filters.append(Asset.lifecycle_status == lifecycle_status)

        assets = await Asset.find(*filters).limit(50).to_list()
        result = [
            {
                "id": str(a.id),
                "name": getattr(a, "name", ""),
                "category": getattr(a, "category", ""),
                "lifecycle_status": getattr(a, "lifecycle_status", ""),
                "serial_number": getattr(a, "serial_number", "") or "",
                "location": getattr(a, "location", "") or "",
            }
            for a in assets
        ]
        return json.dumps(result)

    async def _get_best_tenants(self, limit: int) -> str:
        from app.models.tenant import Tenant
        from app.models.invoice import Invoice

        org_id = self.current_user.org_id
        tenants = await Tenant.find(
            Tenant.org_id == org_id,
            Tenant.property_id == self._property_id,
            Tenant.status == "active",
            Tenant.deleted_at == None,  # noqa: E711
        ).limit(200).to_list()

        scored = []
        for t in tenants:
            invoices = await Invoice.find(
                Invoice.org_id == org_id,
                Invoice.tenant_id == str(t.id),
                Invoice.deleted_at == None,  # noqa: E711
            ).to_list()

            total_invoiced = sum(getattr(i, "total_amount", 0) or 0 for i in invoices)
            total_paid = sum(getattr(i, "amount_paid", 0) or 0 for i in invoices)
            overdue_count = sum(1 for i in invoices if getattr(i, "status", "") == "overdue")
            collection_rate = round((total_paid / total_invoiced * 100) if total_invoiced else 100, 1)

            lease_start = getattr(t, "lease_start_date", None) or getattr(t, "created_at", None)
            days_as_tenant = 0
            if lease_start:
                if hasattr(lease_start, "tzinfo") and lease_start.tzinfo:
                    days_as_tenant = (datetime.now(timezone.utc) - lease_start).days
                else:
                    days_as_tenant = (datetime.now(timezone.utc) - lease_start.replace(tzinfo=timezone.utc)).days

            scored.append({
                "id": str(t.id),
                "full_name": getattr(t, "full_name", ""),
                "unit_code": getattr(t, "unit_code", ""),
                "outstanding_balance_kes": getattr(t, "outstanding_balance", 0) or 0,
                "collection_rate_pct": collection_rate,
                "overdue_invoice_count": overdue_count,
                "total_paid_kes": round(total_paid, 2),
                "days_as_tenant": days_as_tenant,
                "_score": collection_rate - (overdue_count * 10) + min(days_as_tenant / 30, 24),
            })

        scored.sort(key=lambda x: x["_score"], reverse=True)
        for s in scored:
            del s["_score"]
        return json.dumps(scored[:limit])

    async def _get_top_units(self, limit: int) -> str:
        from app.models.unit import Unit

        units = await Unit.find(
            Unit.org_id == self.current_user.org_id,
            Unit.property_id == self._property_id,
            Unit.deleted_at == None,  # noqa: E711
        ).limit(200).to_list()

        result = [
            {
                "unit_code": getattr(u, "unit_code", ""),
                "status": getattr(u, "status", ""),
                "rent_kes": getattr(u, "rent", 0) or 0,
                "tenant_name": getattr(u, "tenant_name", "") or "",
                "bedrooms": getattr(u, "bedrooms", None),
                "floor": getattr(u, "floor", "") or "",
            }
            for u in units
        ]
        result.sort(key=lambda x: x["rent_kes"], reverse=True)
        return json.dumps(result[:limit])

    async def _get_invoice_analytics(self, months_back: int) -> str:
        from app.models.invoice import Invoice

        org_id = self.current_user.org_id
        since = datetime.now(timezone.utc) - timedelta(days=months_back * 30)
        invoices = await Invoice.find(
            Invoice.org_id == org_id,
            Invoice.property_id == self._property_id,
            Invoice.created_at >= since,
            Invoice.deleted_at == None,  # noqa: E711
        ).to_list()

        if not invoices:
            return json.dumps({"message": "No invoices found for the period"})

        total_amount = sum(getattr(i, "total_amount", 0) or 0 for i in invoices)
        total_paid = sum(getattr(i, "amount_paid", 0) or 0 for i in invoices)
        status_counts: Dict[str, int] = {}
        for i in invoices:
            s = getattr(i, "status", "other") or "other"
            status_counts[s] = status_counts.get(s, 0) + 1

        top5 = sorted(invoices, key=lambda i: getattr(i, "total_amount", 0) or 0, reverse=True)[:5]
        return json.dumps({
            "period_months": months_back,
            "total_invoices": len(invoices),
            "total_invoiced_kes": round(total_amount, 2),
            "total_collected_kes": round(total_paid, 2),
            "outstanding_kes": round(total_amount - total_paid, 2),
            "collection_rate_pct": round((total_paid / total_amount * 100) if total_amount else 0, 1),
            "avg_invoice_kes": round(total_amount / len(invoices), 2),
            "status_breakdown": status_counts,
            "top_invoices": [
                {
                    "invoice_number": getattr(i, "invoice_number", ""),
                    "tenant_name": getattr(i, "tenant_name", ""),
                    "amount_kes": getattr(i, "total_amount", 0),
                    "status": getattr(i, "status", ""),
                }
                for i in top5
            ],
        })

    async def _get_lease_analytics(self) -> str:
        from datetime import date as date_type
        from app.models.lease import Lease
        from app.models.unit import Unit
        from app.models.onboarding import Onboarding

        org_id = self.current_user.org_id
        leases = await Lease.find(
            Lease.org_id == org_id,
            Lease.property_id == self._property_id,
            Lease.deleted_at == None,  # noqa: E711
        ).to_list()

        if not leases:
            return json.dumps({"message": "No leases found"})

        today = date_type.today()
        cutoff_60 = today + timedelta(days=60)
        active = [l for l in leases if getattr(l, "status", "") == "active"]
        rents = [l.rent_amount or 0 for l in active]
        expiring_soon = [
            l for l in active
            if getattr(l, "end_date", None) and l.end_date <= cutoff_60
        ]

        # Enrich top tenures: load unit_code + tenant name via onboarding
        from beanie import PydanticObjectId
        sorted_by_tenure = sorted(active, key=lambda l: getattr(l, "start_date", today) or today)[:5]
        unit_ids = list({l.unit_id for l in sorted_by_tenure if l.unit_id})
        ob_ids = list({l.onboarding_id for l in sorted_by_tenure if getattr(l, "onboarding_id", None)})
        unit_oids = [PydanticObjectId(uid) for uid in unit_ids]
        ob_oids = [PydanticObjectId(oid) for oid in ob_ids]
        units_list = await Unit.find({"_id": {"$in": unit_oids}}).to_list() if unit_oids else []
        obs_list = await Onboarding.find({"_id": {"$in": ob_oids}}).to_list() if ob_oids else []
        unit_map = {str(u.id): u.unit_code for u in units_list}
        ob_map = {
            str(o.id): f"{getattr(o, 'first_name', '')} {getattr(o, 'last_name', '')}".strip()
            for o in obs_list
        }

        return json.dumps({
            "total_leases": len(leases),
            "active": len(active),
            "expired": sum(1 for l in leases if getattr(l, "status", "") == "expired"),
            "terminated": sum(1 for l in leases if getattr(l, "status", "") in ("terminated", "cancelled")),
            "avg_monthly_rent_kes": round(sum(rents) / len(rents), 2) if rents else 0,
            "min_rent_kes": min(rents) if rents else 0,
            "max_rent_kes": max(rents) if rents else 0,
            "active_lease_rents": [{"id": str(l.id), "unit_id": l.unit_id, "rent_amount": l.rent_amount, "status": l.status} for l in active],
            "expiring_within_60_days": len(expiring_soon),
            "longest_tenures": [
                {
                    "tenant_name": ob_map.get(l.onboarding_id or "", f"tenant:{l.tenant_id}"),
                    "unit_code": unit_map.get(l.unit_id, l.unit_id),
                    "start_date": l.start_date.isoformat() if getattr(l, "start_date", None) else "",
                    "monthly_rent_kes": l.rent_amount or 0,
                }
                for l in sorted_by_tenure
            ],
        })

    async def _get_ticket_analytics(self, days_back: int) -> str:
        from app.models.ticket import Ticket

        org_id = self.current_user.org_id
        since = datetime.now(timezone.utc) - timedelta(days=days_back)
        tickets = await Ticket.find(
            Ticket.org_id == org_id,
            Ticket.property_id == self._property_id,
            Ticket.created_at >= since,
            Ticket.deleted_at == None,  # noqa: E711
        ).to_list()

        if not tickets:
            return json.dumps({"message": "No tickets in period"})

        open_t = [t for t in tickets if getattr(t, "status", "") in ("open", "in_progress")]
        resolved_t = [t for t in tickets if getattr(t, "status", "") in ("resolved", "closed")]

        resolution_times = []
        for t in resolved_t:
            created = getattr(t, "created_at", None)
            resolved_at = getattr(t, "resolved_at", None) or getattr(t, "updated_at", None)
            if created and resolved_at:
                resolution_times.append((resolved_at - created).total_seconds() / 3600)

        category_counts: Dict[str, int] = {}
        priority_counts: Dict[str, int] = {}
        for t in tickets:
            cat = getattr(t, "category", "other") or "other"
            pri = getattr(t, "priority", "normal") or "normal"
            category_counts[cat] = category_counts.get(cat, 0) + 1
            priority_counts[pri] = priority_counts.get(pri, 0) + 1

        return json.dumps({
            "period_days": days_back,
            "total_tickets": len(tickets),
            "open": len(open_t),
            "resolved": len(resolved_t),
            "resolution_rate_pct": round(len(resolved_t) / len(tickets) * 100, 1),
            "avg_resolution_hours": round(sum(resolution_times) / len(resolution_times), 1) if resolution_times else None,
            "by_category": category_counts,
            "by_priority": priority_counts,
        })

    async def _ask_portfolio_question(self, question: str) -> str:
        """Delegate a broader question to the OwnerAgent."""
        from app.services.agents.owner_agent import OwnerAgent

        # Pass through the same ai_config so delegation uses the same LLM
        ai_cfg: Optional[Dict[str, Any]] = None
        if hasattr(self, "_client") and hasattr(self, "_model"):
            # Reconstruct minimal config dict from resolved values
            base_url = str(self._client.base_url) if self._client.base_url else None
            ai_cfg = {"base_url": base_url, "model": self._model, "provider": "custom"}
        owner_agent = OwnerAgent(current_user=self.current_user, ai_config=ai_cfg)
        answer = await owner_agent.run_once([{"role": "user", "content": question}])
        return f"[Portfolio AI response]: {answer}"

    # ── Messaging ──────────────────────────────────────────────────────────────
    _ABUSIVE_PATTERNS = [
        r"\b(idiot|stupid|moron|lazy|useless|scum|bastard|bitch|damn\s+you|fool|coward)\b",
        r"\b(get\s+out|you\s+will\s+be\s+evicted\s+immediately|i\s+will\s+hurt|i\s+will\s+sue\s+you\s+personally)\b",
        r"\b(you\s+(are|r)\s+(a\s+)?(idiot|stupid|loser|waste))\b",
    ]

    def _is_unprofessional(self, text: str) -> bool:
        import re
        t = text.lower()
        return any(re.search(p, t) for p in self._ABUSIVE_PATTERNS)

    async def _send_message_to_tenant(
        self, tenant_id: str, channel: str, subject: str, body: str
    ) -> str:
        from app.models.user import User
        from app.models.onboarding import Onboarding
        from app.models.lease import Lease
        from app.models.org import Org
        from beanie import PydanticObjectId
        import structlog

        log = structlog.get_logger()
        org_id = self.current_user.org_id

        if not tenant_id or not body.strip():
            return json.dumps({"error": "tenant_id and body are required"})

        if self._is_unprofessional(body):
            return json.dumps({
                "error": "Message blocked: unprofessional or potentially abusive content detected. Please revise."
            })

        try:
            user = await User.get(PydanticObjectId(tenant_id))
        except Exception:
            user = None
        if not user or user.org_id != org_id:
            return json.dumps({"error": f"Tenant {tenant_id} not found in this org"})

        active_lease = await Lease.find_one(
            Lease.org_id == org_id,
            Lease.tenant_id == tenant_id,
            Lease.property_id == self._property_id,
            Lease.status == "active",
            Lease.deleted_at == None,  # noqa: E711
        )

        onboarding = None
        if active_lease and active_lease.onboarding_id:
            try:
                onboarding = await Onboarding.get(PydanticObjectId(active_lease.onboarding_id))
            except Exception:
                pass

        org = await Org.get(org_id) if hasattr(Org, "get") else None
        sender_org = (org.business.name if org and org.business else "Property Management") if org else "Property Management"
        sender_name = "Property Manager"
        try:
            acting_user = await User.get(PydanticObjectId(self.current_user.user_id))
            if acting_user:
                sender_name = f"{acting_user.first_name or ''} {acting_user.last_name or ''}".strip() or "Property Manager"
        except Exception:
            pass
        tenant_name = f"{user.first_name or ''} {user.last_name or ''}".strip() or user.email

        if channel == "email":
            from app.core.email import send_email, ai_outreach_html
            html = ai_outreach_html(
                recipient_name=tenant_name,
                body_text=body,
                sender_org=sender_org,
                sender_name=sender_name,
            )
            await send_email(to=user.email, subject=subject, html=html)
            log.info(
                "ai_message_sent",
                channel="email",
                tenant_id=tenant_id,
                to=user.email,
                subject=subject,
                org_id=org_id,
                property_id=self._property_id,
                sent_by=self.current_user.user_id,
            )
        else:  # whatsapp
            # Always use the registered phone (onboarding → user), never a call-context number
            phone = (onboarding.phone if onboarding else None) or user.phone
            if not phone:
                return json.dumps({"error": "No phone number on record for this tenant"})
            from app.services.whatsapp_service import send_text_for_org
            wa_body = f"*{subject}*\n\n{body}" if subject else body
            sent = await send_text_for_org(org_id, phone, wa_body)
            if not sent:
                return json.dumps({
                    "error": "No connected WhatsApp instance found for this organisation. "
                             "Please connect a WhatsApp number in the property's WhatsApp settings and try again."
                })
            log.info(
                "ai_whatsapp_sent",
                channel="whatsapp",
                tenant_id=tenant_id,
                phone=phone,
                subject=subject,
                org_id=org_id,
                property_id=self._property_id,
                sent_by=self.current_user.user_id,
            )

        self._queue_event({
            "type": "message_sent",
            "channel": channel,
            "tenant_name": tenant_name,
            "tenant_email": user.email,
            "subject": subject,
            "preview": body[:300],
        })

        return json.dumps({
            "sent": True,
            "channel": channel,
            "to": user.email,
            "tenant_name": tenant_name,
            "subject": subject,
        })
