"""
OwnerAgent — portfolio-wide intelligence.

Tools available:
  get_portfolio_summary    — counts, occupancy rate, revenue snapshot
  list_properties          — all properties with status/type/unit counts
  get_financial_summary    — invoice totals, outstanding, collected by period
  list_open_tickets        — open/pending tickets across portfolio
  list_expiring_leases     — leases expiring within N days
  list_overdue_invoices    — invoices past due date
  search_tenants           — find tenants by name/email
  get_best_tenants         — top tenants ranked by payment behaviour & tenure
  get_top_units            — highest-value units by rent and occupancy
  get_invoice_analytics    — collection rate, on-time vs late, avg invoice size
  get_lease_analytics      — active leases summary, rent range, renewal stats
  get_ticket_analytics     — resolution stats, category/priority breakdown
  send_message_to_tenant   — compose and send a professional email/WhatsApp to a tenant
"""
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.dependencies.auth import CurrentUser
from app.services.agents.base_agent import BaseAgent


class OwnerAgent(BaseAgent):
    agent_type = "owner"

    async def get_system_prompt(self) -> str:
        now = datetime.now(timezone.utc).strftime("%A, %d %B %Y %H:%M UTC")
        return f"""You are the Portfolio AI assistant for a property management platform (PMS).
You have deep knowledge of the owner's entire real-estate portfolio.

Current date/time: {now}
User role: {self.current_user.role}
Org ID: {self.current_user.org_id}

Your capabilities:
- Summarise portfolio health (occupancy, revenue, outstanding balances)
- Drill into any property, tenant, invoice, or maintenance ticket
- Highlight risks: overdue invoices, expiring leases, open tickets
- Answer natural-language questions about financials and operations

Guidelines:
- Always use tools to fetch live data before answering — never guess numbers
- Present monetary amounts with the full currency name (e.g. "Kenyan Shillings 1,200" or "1,200 Kenyan Shillings") — never use abbreviations like KES, KSH, or USD
- If a question is about a specific property in depth, let the user know they can
  open that property's workspace for property-level details
- Be concise but thorough; use bullet points for lists
- If data is unavailable, say so clearly"""

    def get_tool_definitions(self) -> List[Dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "get_portfolio_summary",
                    "description": "Get high-level portfolio stats: total properties, units, occupied units, occupancy rate, active tenants, open tickets.",
                    "parameters": {"type": "object", "properties": {}, "required": []},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "list_properties",
                    "description": "List all properties in the portfolio with their status, type, unit counts, and occupancy.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "status": {
                                "type": "string",
                                "description": "Filter by status: active, inactive, archived",
                            }
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_financial_summary",
                    "description": "Get financial summary: total invoiced, collected, outstanding, and overdue amounts for a given period.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "months_back": {
                                "type": "integer",
                                "description": "How many months back to look (default 3)",
                            }
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "list_open_tickets",
                    "description": "List open/in-progress maintenance and service tickets across the portfolio.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "priority": {
                                "type": "string",
                                "description": "Filter by priority: critical, high, medium, low",
                            },
                            "property_id": {
                                "type": "string",
                                "description": "Filter to a specific property ID (optional)",
                            },
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "list_expiring_leases",
                    "description": "List leases expiring within a given number of days.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "days": {
                                "type": "integer",
                                "description": "Number of days ahead to check (default 60)",
                            }
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "list_overdue_invoices",
                    "description": "List invoices that are overdue (past due date and not fully paid).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "property_id": {
                                "type": "string",
                                "description": "Filter to a specific property (optional)",
                            }
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "search_tenants",
                    "description": "Search for tenants by name or email across the portfolio.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "Search term (name or email fragment)",
                            }
                        },
                        "required": ["query"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_best_tenants",
                    "description": "Rank tenants by payment behaviour and tenure. Returns top payers (zero/low balance, longest stay, fewest overdue invoices). Use to answer 'who are the best tenants?'",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "limit": {"type": "integer", "description": "Number of top tenants to return (default 10)"},
                            "property_id": {"type": "string", "description": "Scope to a specific property (optional)"},
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_top_units",
                    "description": "List highest-value units ranked by rent amount and occupancy continuity. Use to answer 'which are the best/top units?'",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "limit": {"type": "integer", "description": "Number of units to return (default 10)"},
                            "property_id": {"type": "string", "description": "Scope to a specific property (optional)"},
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_invoice_analytics",
                    "description": "Invoice performance analytics: collection rate, paid vs outstanding, on-time vs late payers, average invoice size. Use for questions like 'how is invoice collection going?'",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "months_back": {"type": "integer", "description": "Lookback period in months (default 6)"},
                            "property_id": {"type": "string", "description": "Scope to a specific property (optional)"},
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_lease_analytics",
                    "description": "Lease health summary: active vs expired vs terminated counts, average rent, shortest/longest lease, upcoming renewals. Use for 'how are leases performing?' questions.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "property_id": {"type": "string", "description": "Scope to a specific property (optional)"},
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_ticket_analytics",
                    "description": "Ticket resolution analytics: open vs resolved counts, average resolution time, breakdown by category and priority. Use for 'how are tickets being handled?' questions.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "property_id": {"type": "string", "description": "Scope to a specific property (optional)"},
                            "days_back": {"type": "integer", "description": "Lookback window in days (default 90)"},
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "send_message_to_tenant",
                    "description": (
                        "Compose and send a professional email or WhatsApp message to a tenant. "
                        "ALWAYS show the drafted message to the user and ask for confirmation before calling this tool. "
                        "Use for rent reminders, payment notices, lease updates, general communication, etc. "
                        "The message will be sent immediately on call — ensure the user has approved it first."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "tenant_id": {"type": "string", "description": "The tenant's user ID"},
                            "channel": {"type": "string", "enum": ["email", "whatsapp"], "description": "Delivery channel"},
                            "subject": {"type": "string", "description": "Email subject line or WhatsApp message title"},
                            "body": {"type": "string", "description": "Full message body — must be professional and non-abusive"},
                        },
                        "required": ["tenant_id", "channel", "subject", "body"],
                    },
                },
            },
        ]

    async def execute_tool(self, tool_name: str, arguments: Dict) -> str:
        try:
            if tool_name == "get_portfolio_summary":
                return await self._get_portfolio_summary()
            elif tool_name == "list_properties":
                return await self._list_properties(arguments.get("status"))
            elif tool_name == "get_financial_summary":
                return await self._get_financial_summary(arguments.get("months_back", 3))
            elif tool_name == "list_open_tickets":
                return await self._list_open_tickets(
                    arguments.get("priority"), arguments.get("property_id")
                )
            elif tool_name == "list_expiring_leases":
                return await self._list_expiring_leases(arguments.get("days", 60))
            elif tool_name == "list_overdue_invoices":
                return await self._list_overdue_invoices(arguments.get("property_id"))
            elif tool_name == "search_tenants":
                return await self._search_tenants(arguments.get("query", ""))
            elif tool_name == "get_best_tenants":
                return await self._get_best_tenants(
                    arguments.get("limit", 10), arguments.get("property_id")
                )
            elif tool_name == "get_top_units":
                return await self._get_top_units(
                    arguments.get("limit", 10), arguments.get("property_id")
                )
            elif tool_name == "get_invoice_analytics":
                return await self._get_invoice_analytics(
                    arguments.get("months_back", 6), arguments.get("property_id")
                )
            elif tool_name == "get_lease_analytics":
                return await self._get_lease_analytics(arguments.get("property_id"))
            elif tool_name == "get_ticket_analytics":
                return await self._get_ticket_analytics(
                    arguments.get("property_id"), arguments.get("days_back", 90)
                )
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

    async def _get_portfolio_summary(self) -> str:
        from app.models.property import Property
        from app.models.ticket import Ticket

        org_id = self.current_user.org_id
        props = await Property.find(
            Property.org_id == org_id, Property.deleted_at == None  # noqa: E711
        ).to_list()

        total_units = sum(getattr(p, "unit_count", 0) or 0 for p in props)
        occupied = sum(getattr(p, "occupied_units", 0) or 0 for p in props)
        occupancy = round((occupied / total_units * 100) if total_units else 0, 1)

        open_tickets = await Ticket.find(
            Ticket.org_id == org_id,
            Ticket.status.in_(["open", "in_progress"]),  # type: ignore[attr-defined]
            Ticket.deleted_at == None,  # noqa: E711
        ).count()

        return json.dumps({
            "total_properties": len(props),
            "total_units": total_units,
            "occupied_units": occupied,
            "occupancy_rate_pct": occupancy,
            "open_tickets": open_tickets,
        })

    async def _list_properties(self, status: Optional[str]) -> str:
        from app.models.property import Property

        org_id = self.current_user.org_id
        filters = [Property.org_id == org_id, Property.deleted_at == None]  # noqa: E711
        if status:
            filters.append(Property.status == status)

        props = await Property.find(*filters).limit(50).to_list()
        result = []
        for p in props:
            result.append({
                "id": str(p.id),
                "name": p.name,
                "type": getattr(p, "property_type", ""),
                "status": getattr(p, "status", ""),
                "unit_count": getattr(p, "unit_count", 0),
                "occupied_units": getattr(p, "occupied_units", 0),
                "city": getattr(getattr(p, "address", None), "city", "") or "",
            })
        return json.dumps(result)

    async def _get_financial_summary(self, months_back: int) -> str:
        from app.models.invoice import Invoice

        org_id = self.current_user.org_id
        since = datetime.now(timezone.utc) - timedelta(days=months_back * 30)

        invoices = await Invoice.find(
            Invoice.org_id == org_id,
            Invoice.created_at >= since,
            Invoice.deleted_at == None,  # noqa: E711
        ).to_list()

        total_amount = sum(getattr(i, "total_amount", 0) or 0 for i in invoices)
        total_paid = sum(getattr(i, "amount_paid", 0) or 0 for i in invoices)
        outstanding = total_amount - total_paid
        overdue_count = sum(
            1 for i in invoices
            if getattr(i, "status", "") not in ("paid", "void", "draft")
            and getattr(i, "due_date", None)
            and i.due_date < datetime.now(timezone.utc)
        )

        return json.dumps({
            "period_months": months_back,
            "total_invoiced_kes": round(total_amount, 2),
            "total_collected_kes": round(total_paid, 2),
            "outstanding_kes": round(outstanding, 2),
            "invoice_count": len(invoices),
            "overdue_invoice_count": overdue_count,
        })

    async def _list_open_tickets(
        self, priority: Optional[str], property_id: Optional[str]
    ) -> str:
        from app.models.ticket import Ticket

        org_id = self.current_user.org_id
        filters = [
            Ticket.org_id == org_id,
            Ticket.status.in_(["open", "in_progress"]),  # type: ignore[attr-defined]
            Ticket.deleted_at == None,  # noqa: E711
        ]
        if priority:
            filters.append(Ticket.priority == priority)
        if property_id:
            filters.append(Ticket.property_id == property_id)

        tickets = await Ticket.find(*filters).sort("-created_at").limit(30).to_list()
        result = [
            {
                "id": str(t.id),
                "reference": getattr(t, "reference_number", ""),
                "title": getattr(t, "title", ""),
                "priority": getattr(t, "priority", ""),
                "status": getattr(t, "status", ""),
                "property_id": getattr(t, "property_id", ""),
                "property_name": getattr(t, "property_name", ""),
                "created_at": t.created_at.isoformat() if t.created_at else "",
            }
            for t in tickets
        ]
        return json.dumps(result)

    async def _list_expiring_leases(self, days: int) -> str:
        from datetime import date as date_type
        from app.models.lease import Lease
        from app.models.unit import Unit
        from app.models.onboarding import Onboarding
        from app.models.property import Property as PropertyModel

        org_id = self.current_user.org_id
        today = date_type.today()
        cutoff = today + timedelta(days=days)

        leases = await Lease.find(
            Lease.org_id == org_id,
            Lease.status == "active",
            Lease.end_date <= cutoff,
            Lease.end_date >= today,
            Lease.deleted_at == None,  # noqa: E711
        ).sort("end_date").limit(30).to_list()

        if not leases:
            return json.dumps([])

        from beanie import PydanticObjectId
        unit_ids = list({l.unit_id for l in leases if l.unit_id})
        ob_ids = list({l.onboarding_id for l in leases if getattr(l, "onboarding_id", None)})
        prop_ids = list({l.property_id for l in leases if l.property_id})
        unit_oids = [PydanticObjectId(uid) for uid in unit_ids]
        ob_oids = [PydanticObjectId(oid) for oid in ob_ids]
        prop_oids = [PydanticObjectId(pid) for pid in prop_ids]
        units_list = await Unit.find({"_id": {"$in": unit_oids}}).to_list() if unit_oids else []
        obs_list = await Onboarding.find({"_id": {"$in": ob_oids}}).to_list() if ob_oids else []
        props_list = await PropertyModel.find({"_id": {"$in": prop_oids}}).to_list() if prop_oids else []
        unit_map = {str(u.id): u.unit_code for u in units_list}
        ob_map = {
            str(o.id): f"{getattr(o, 'first_name', '')} {getattr(o, 'last_name', '')}".strip()
            for o in obs_list
        }
        prop_map = {str(p.id): getattr(p, "name", str(p.id)) for p in props_list}

        result = [
            {
                "id": str(l.id),
                "tenant_name": ob_map.get(l.onboarding_id or "", f"tenant:{l.tenant_id}"),
                "unit_code": unit_map.get(l.unit_id, l.unit_id),
                "property_name": prop_map.get(l.property_id, l.property_id),
                "end_date": l.end_date.isoformat() if l.end_date else "",
                "monthly_rent": l.rent_amount or 0,
            }
            for l in leases
        ]
        return json.dumps(result)

    async def _list_overdue_invoices(self, property_id: Optional[str]) -> str:
        from app.models.invoice import Invoice

        org_id = self.current_user.org_id
        now = datetime.now(timezone.utc)

        filters = [
            Invoice.org_id == org_id,
            Invoice.due_date < now,
            Invoice.status.in_(["sent", "partial", "overdue"]),  # type: ignore[attr-defined]
            Invoice.deleted_at == None,  # noqa: E711
        ]
        if property_id:
            filters.append(Invoice.property_id == property_id)

        invoices = await Invoice.find(*filters).sort("due_date").limit(30).to_list()
        result = [
            {
                "id": str(i.id),
                "invoice_number": getattr(i, "invoice_number", ""),
                "tenant_name": getattr(i, "tenant_name", ""),
                "property_name": getattr(i, "property_name", ""),
                "total_amount": getattr(i, "total_amount", 0),
                "amount_paid": getattr(i, "amount_paid", 0),
                "balance_due": getattr(i, "balance_due", 0),
                "due_date": i.due_date.isoformat() if i.due_date else "",
            }
            for i in invoices
        ]
        return json.dumps(result)

    async def _search_tenants(self, query: str) -> str:
        from app.models.tenant import Tenant

        org_id = self.current_user.org_id
        tenants = await Tenant.find(
            Tenant.org_id == org_id,
            Tenant.deleted_at == None,  # noqa: E711
        ).limit(100).to_list()

        q = query.lower()
        matches = [
            t for t in tenants
            if q in (getattr(t, "full_name", "") or "").lower()
            or q in (getattr(t, "email", "") or "").lower()
            or q in (getattr(t, "phone", "") or "").lower()
        ][:10]

        result = [
            {
                "id": str(t.id),
                "full_name": getattr(t, "full_name", ""),
                "email": getattr(t, "email", ""),
                "phone": getattr(t, "phone", ""),
                "status": getattr(t, "status", ""),
                "unit_code": getattr(t, "unit_code", ""),
                "property_name": getattr(t, "property_name", ""),
            }
            for t in matches
        ]
        return json.dumps(result)

    async def _get_best_tenants(self, limit: int, property_id: Optional[str]) -> str:
        from app.models.tenant import Tenant
        from app.models.invoice import Invoice

        org_id = self.current_user.org_id
        filters = [Tenant.org_id == org_id, Tenant.status == "active", Tenant.deleted_at == None]  # noqa: E711
        if property_id:
            filters.append(Tenant.property_id == property_id)

        tenants = await Tenant.find(*filters).limit(200).to_list()

        # Enrich each tenant with invoice stats
        scored = []
        for t in tenants:
            invoices = await Invoice.find(
                Invoice.org_id == org_id,
                Invoice.tenant_id == str(t.id),
                Invoice.deleted_at == None,  # noqa: E711
            ).to_list()

            total_invoiced = sum(getattr(i, "total_amount", 0) or 0 for i in invoices)
            total_paid = sum(getattr(i, "amount_paid", 0) or 0 for i in invoices)
            overdue_count = sum(
                1 for i in invoices
                if getattr(i, "status", "") in ("overdue",)
            )
            collection_rate = round((total_paid / total_invoiced * 100) if total_invoiced else 100, 1)

            # Lease start date to measure tenure
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
                "property_name": getattr(t, "property_name", ""),
                "outstanding_balance": getattr(t, "outstanding_balance", 0) or 0,
                "collection_rate_pct": collection_rate,
                "overdue_invoice_count": overdue_count,
                "total_invoiced_kes": round(total_invoiced, 2),
                "total_paid_kes": round(total_paid, 2),
                "days_as_tenant": days_as_tenant,
                "_score": collection_rate - (overdue_count * 10) + min(days_as_tenant / 30, 24),
            })

        scored.sort(key=lambda x: x["_score"], reverse=True)
        for s in scored:
            del s["_score"]
        return json.dumps(scored[:limit])

    async def _get_top_units(self, limit: int, property_id: Optional[str]) -> str:
        from app.models.unit import Unit

        org_id = self.current_user.org_id
        filters = [Unit.org_id == org_id, Unit.deleted_at == None]  # noqa: E711
        if property_id:
            filters.append(Unit.property_id == property_id)

        units = await Unit.find(*filters).limit(500).to_list()

        result = []
        for u in units:
            result.append({
                "id": str(u.id),
                "unit_code": getattr(u, "unit_code", ""),
                "property_name": getattr(u, "property_name", "") or "",
                "status": getattr(u, "status", ""),
                "rent_kes": getattr(u, "rent", 0) or 0,
                "tenant_name": getattr(u, "tenant_name", "") or "",
                "bedrooms": getattr(u, "bedrooms", None),
                "floor": getattr(u, "floor", "") or "",
            })

        result.sort(key=lambda x: x["rent_kes"], reverse=True)
        return json.dumps(result[:limit])

    async def _get_invoice_analytics(self, months_back: int, property_id: Optional[str]) -> str:
        from app.models.invoice import Invoice

        org_id = self.current_user.org_id
        since = datetime.now(timezone.utc) - timedelta(days=months_back * 30)
        filters = [
            Invoice.org_id == org_id,
            Invoice.created_at >= since,
            Invoice.deleted_at == None,  # noqa: E711
        ]
        if property_id:
            filters.append(Invoice.property_id == property_id)

        invoices = await Invoice.find(*filters).to_list()
        if not invoices:
            return json.dumps({"message": "No invoices found for the period"})

        total_amount = sum(getattr(i, "total_amount", 0) or 0 for i in invoices)
        total_paid = sum(getattr(i, "amount_paid", 0) or 0 for i in invoices)
        count_paid = sum(1 for i in invoices if getattr(i, "status", "") == "paid")
        count_overdue = sum(1 for i in invoices if getattr(i, "status", "") == "overdue")
        count_partial = sum(1 for i in invoices if getattr(i, "status", "") == "partial")
        count_void = sum(1 for i in invoices if getattr(i, "status", "") == "void")

        # Largest invoices (top 5)
        top_invoices = sorted(invoices, key=lambda i: getattr(i, "total_amount", 0) or 0, reverse=True)[:5]

        return json.dumps({
            "period_months": months_back,
            "total_invoices": len(invoices),
            "total_invoiced_kes": round(total_amount, 2),
            "total_collected_kes": round(total_paid, 2),
            "outstanding_kes": round(total_amount - total_paid, 2),
            "collection_rate_pct": round((total_paid / total_amount * 100) if total_amount else 0, 1),
            "status_breakdown": {
                "paid": count_paid,
                "overdue": count_overdue,
                "partial": count_partial,
                "void": count_void,
                "other": len(invoices) - count_paid - count_overdue - count_partial - count_void,
            },
            "avg_invoice_kes": round(total_amount / len(invoices), 2),
            "largest_invoices": [
                {
                    "invoice_number": getattr(i, "invoice_number", ""),
                    "tenant_name": getattr(i, "tenant_name", ""),
                    "amount": getattr(i, "total_amount", 0),
                    "status": getattr(i, "status", ""),
                }
                for i in top_invoices
            ],
        })

    async def _get_lease_analytics(self, property_id: Optional[str]) -> str:
        from datetime import date as date_type
        from app.models.lease import Lease
        from app.models.unit import Unit
        from app.models.onboarding import Onboarding

        org_id = self.current_user.org_id
        filters = [Lease.org_id == org_id, Lease.deleted_at == None]  # noqa: E711
        if property_id:
            filters.append(Lease.property_id == property_id)

        leases = await Lease.find(*filters).to_list()
        if not leases:
            return json.dumps({"message": "No leases found"})

        today = date_type.today()
        cutoff_60 = today + timedelta(days=60)

        active = [l for l in leases if l.status == "active"]
        expired = [l for l in leases if l.status == "expired"]
        terminated = [l for l in leases if l.status in ("terminated", "cancelled")]

        rents = [l.rent_amount for l in active if l.rent_amount is not None]
        avg_rent = round(sum(rents) / len(rents), 2) if rents else 0
        expiring_soon = [l for l in active if l.end_date and l.end_date <= cutoff_60]

        # Enrich top tenures: load unit_code + tenant name via onboarding
        from beanie import PydanticObjectId
        oldest_active = sorted(active, key=lambda l: l.start_date)[:5]
        unit_ids = [l.unit_id for l in oldest_active if l.unit_id]
        unit_oids = [PydanticObjectId(uid) for uid in unit_ids]
        units_list = await Unit.find({"_id": {"$in": unit_oids}}).to_list() if unit_oids else []
        unit_map = {str(u.id): u.unit_code for u in units_list}

        ob_ids = [l.onboarding_id for l in oldest_active if l.onboarding_id]
        ob_oids = [PydanticObjectId(oid) for oid in ob_ids]
        ob_list = await Onboarding.find({"_id": {"$in": ob_oids}}).to_list() if ob_oids else []
        ob_map = {
            str(ob.id): f"{ob.first_name or ''} {ob.last_name or ''}".strip()
            for ob in ob_list
        }

        return json.dumps({
            "total_leases": len(leases),
            "active": len(active),
            "expired": len(expired),
            "terminated": len(terminated),
            "avg_monthly_rent_kes": avg_rent,
            "min_rent_kes": min(rents) if rents else 0,
            "max_rent_kes": max(rents) if rents else 0,
            "active_lease_rents": [{"id": str(l.id), "unit_id": l.unit_id, "rent_amount": l.rent_amount, "status": l.status} for l in active],
            "expiring_within_60_days": len(expiring_soon),
            "expiring_soon": [
                {
                    "unit_code": unit_map.get(l.unit_id, l.unit_id),
                    "end_date": l.end_date.isoformat() if l.end_date else "",
                    "rent_kes": l.rent_amount,
                }
                for l in sorted(expiring_soon, key=lambda l: l.end_date)
            ],
            "longest_tenures": [
                {
                    "tenant_name": ob_map.get(l.onboarding_id or "", f"tenant:{l.tenant_id}"),
                    "unit_code": unit_map.get(l.unit_id, l.unit_id),
                    "start_date": l.start_date.isoformat(),
                    "rent_kes": l.rent_amount,
                }
                for l in oldest_active
            ],
        })

    async def _get_ticket_analytics(self, property_id: Optional[str], days_back: int) -> str:
        from app.models.ticket import Ticket

        org_id = self.current_user.org_id
        since = datetime.now(timezone.utc) - timedelta(days=days_back)
        filters = [
            Ticket.org_id == org_id,
            Ticket.created_at >= since,
            Ticket.deleted_at == None,  # noqa: E711
        ]
        if property_id:
            filters.append(Ticket.property_id == property_id)

        tickets = await Ticket.find(*filters).to_list()
        if not tickets:
            return json.dumps({"message": "No tickets in period"})

        now = datetime.now(timezone.utc)
        open_t = [t for t in tickets if getattr(t, "status", "") in ("open", "in_progress")]
        resolved_t = [t for t in tickets if getattr(t, "status", "") in ("resolved", "closed")]

        # Average resolution time (hours)
        resolution_times = []
        for t in resolved_t:
            created = getattr(t, "created_at", None)
            resolved_at = getattr(t, "resolved_at", None) or getattr(t, "updated_at", None)
            if created and resolved_at:
                hours = (resolved_at - created).total_seconds() / 3600
                resolution_times.append(hours)
        avg_resolution_hrs = round(sum(resolution_times) / len(resolution_times), 1) if resolution_times else None

        # Category breakdown
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
            "avg_resolution_hours": avg_resolution_hrs,
            "by_category": category_counts,
            "by_priority": priority_counts,
        })

    # ── Professionalism guard ──────────────────────────────────────────────────
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

        # Professionalism guard
        if self._is_unprofessional(body):
            return json.dumps({
                "error": "Message blocked: unprofessional or potentially abusive content detected. Please revise."
            })

        # Load tenant user
        try:
            user = await User.get(PydanticObjectId(tenant_id))
        except Exception:
            user = None
        if not user or user.org_id != org_id:
            return json.dumps({"error": f"Tenant {tenant_id} not found in this org"})

        # Load their active lease for context (optional)
        active_lease = await Lease.find_one(
            Lease.org_id == org_id,
            Lease.tenant_id == tenant_id,
            Lease.status == "active",
            Lease.deleted_at == None,  # noqa: E711
        )

        # Load onboarding for phone
        onboarding = None
        if active_lease and active_lease.onboarding_id:
            try:
                onboarding = await Onboarding.get(PydanticObjectId(active_lease.onboarding_id))
            except Exception:
                pass

        # Load org name for sender attribution
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
                sent_by=self.current_user.user_id,
            )
        else:  # whatsapp
            # Always use the registered phone (onboarding → user), never a call-context number
            phone = (onboarding.phone if onboarding else None) or user.phone
            if not phone:
                return json.dumps({"error": "No phone number on record for this tenant — cannot send WhatsApp"})
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
                sent_by=self.current_user.user_id,
            )

        # Queue a frontend card event
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
