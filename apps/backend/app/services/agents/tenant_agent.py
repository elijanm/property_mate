"""
TenantAgent — answers questions about a tenant's own lease, invoices, and tickets.
"""
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.dependencies.auth import CurrentUser
from app.services.agents.base_agent import BaseAgent


class TenantAgent(BaseAgent):
    agent_type = "tenant"

    def __init__(self, current_user: CurrentUser, context: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(current_user, context)
        self._tenant_id: str = (context or {}).get("tenant_id", "")

    async def get_system_prompt(self) -> str:
        now = datetime.now(timezone.utc).strftime("%A, %d %B %Y %H:%M UTC")
        return f"""You are the Tenant AI assistant for a property management platform.
You help tenants understand their lease, invoices, payment status, and service requests.

Current date/time: {now}
User role: tenant

Guidelines:
- Only access data belonging to this tenant — never reveal other tenants' info
- Be friendly, clear, and helpful
- For payments, clearly state amounts using the full currency name (e.g. "Kenyan Shillings 1,200") — never abbreviate as KES, KSH, or USD
- Escalate complex disputes or legal questions by saying the tenant should contact management"""

    def get_tool_definitions(self) -> List[Dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "get_my_lease",
                    "description": "Get the tenant's current lease details: unit, rent, dates, deposit, utilities.",
                    "parameters": {"type": "object", "properties": {}, "required": []},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "list_my_invoices",
                    "description": "List the tenant's recent invoices with payment status.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "status": {"type": "string", "description": "paid | unpaid | overdue"},
                        },
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "list_my_tickets",
                    "description": "List the tenant's maintenance/service tickets.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "status": {"type": "string"},
                        },
                        "required": [],
                    },
                },
            },
        ]

    async def execute_tool(self, tool_name: str, arguments: Dict) -> str:
        try:
            if tool_name == "get_my_lease":
                return await self._get_my_lease()
            elif tool_name == "list_my_invoices":
                return await self._list_my_invoices(arguments.get("status"))
            elif tool_name == "list_my_tickets":
                return await self._list_my_tickets(arguments.get("status"))
            else:
                return f"Unknown tool: {tool_name}"
        except Exception as e:
            return f"Tool error ({tool_name}): {e}"

    async def _get_my_lease(self) -> str:
        from app.models.lease import Lease
        from beanie import PydanticObjectId

        lease = await Lease.find_one(
            Lease.tenant_id == self._tenant_id,
            Lease.status == "active",
            Lease.deleted_at == None,  # noqa: E711
        )
        if not lease:
            return json.dumps({"error": "No active lease found"})

        return json.dumps({
            "unit_code": getattr(lease, "unit_code", ""),
            "property_name": getattr(lease, "property_name", ""),
            "monthly_rent": getattr(lease, "monthly_rent", 0),
            "start_date": lease.start_date.isoformat() if getattr(lease, "start_date", None) else "",
            "end_date": lease.end_date.isoformat() if getattr(lease, "end_date", None) else "",
            "deposit": getattr(lease, "deposit_amount", 0),
            "status": getattr(lease, "status", ""),
        })

    async def _list_my_invoices(self, status: Optional[str]) -> str:
        from app.models.invoice import Invoice

        filters = [
            Invoice.tenant_id == self._tenant_id,
            Invoice.deleted_at == None,  # noqa: E711
        ]
        if status == "paid":
            filters.append(Invoice.status == "paid")
        elif status in ("unpaid", "overdue"):
            filters.append(Invoice.status.in_(["sent", "partial", "overdue"]))  # type: ignore[attr-defined]

        invoices = await Invoice.find(*filters).sort("-created_at").limit(12).to_list()
        result = [
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
        return json.dumps(result)

    async def _list_my_tickets(self, status: Optional[str]) -> str:
        from app.models.ticket import Ticket

        filters = [
            Ticket.tenant_id == self._tenant_id,
            Ticket.deleted_at == None,  # noqa: E711
        ]
        if status:
            filters.append(Ticket.status == status)

        tickets = await Ticket.find(*filters).sort("-created_at").limit(20).to_list()
        result = [
            {
                "reference": getattr(t, "reference_number", ""),
                "title": getattr(t, "title", ""),
                "status": getattr(t, "status", ""),
                "priority": getattr(t, "priority", ""),
                "created_at": t.created_at.isoformat() if t.created_at else "",
            }
            for t in tickets
        ]
        return json.dumps(result)
