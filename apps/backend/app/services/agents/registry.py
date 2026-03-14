"""
Agent registry — maps agent_type strings to agent classes and validates
that the requesting user is allowed to use that agent type.
"""
from typing import Any, Dict, Optional, Type

from app.dependencies.auth import CurrentUser
from app.services.agents.base_agent import BaseAgent
from app.services.agents.owner_agent import OwnerAgent
from app.services.agents.property_agent import PropertyAgent
from app.services.agents.tenant_agent import TenantAgent

# Roles allowed to use each agent type
_AGENT_PERMISSIONS: Dict[str, list] = {
    "owner": ["owner", "superadmin"],
    "property": ["owner", "agent", "superadmin"],
    "tenant": ["tenant"],
    "service_provider": ["service_provider"],
}

_AGENT_CLASSES: Dict[str, Type[BaseAgent]] = {
    "owner": OwnerAgent,
    "property": PropertyAgent,
    "tenant": TenantAgent,
}


def resolve_agent_type(role: str) -> str:
    """Return the default agent type for a given user role."""
    return {
        "owner": "owner",
        "agent": "property",
        "tenant": "tenant",
        "service_provider": "service_provider",
        "superadmin": "owner",
    }.get(role, "owner")


def can_use_agent(role: str, agent_type: str) -> bool:
    allowed = _AGENT_PERMISSIONS.get(agent_type, [])
    return role in allowed


def build_agent(
    agent_type: str,
    current_user: CurrentUser,
    context: Optional[Dict[str, Any]] = None,
    ai_config: Optional[Dict[str, Any]] = None,
) -> BaseAgent:
    """Instantiate the correct agent class for agent_type."""
    cls = _AGENT_CLASSES.get(agent_type)
    if cls is None:
        raise ValueError(f"Unknown agent_type: {agent_type!r}")
    return cls(current_user=current_user, context=context, ai_config=ai_config)


# Metadata returned to the frontend so it knows what agents are available
def available_agents_for_role(role: str) -> list:
    agents = []
    if role in ("owner", "superadmin"):
        agents.append({
            "type": "owner",
            "label": "Portfolio AI",
            "description": "Ask about your entire portfolio — properties, tenants, finances, tickets.",
            "icon": "🏢",
            "requires_context": False,
        })
        agents.append({
            "type": "property",
            "label": "Property AI",
            "description": "Deep-dive into a specific property — units, tenants, income, maintenance.",
            "icon": "🔍",
            "requires_context": True,
            "context_type": "property",
        })
    if role in ("agent",):
        agents.append({
            "type": "property",
            "label": "Property AI",
            "description": "Ask about properties you manage.",
            "icon": "🔍",
            "requires_context": True,
            "context_type": "property",
        })
    if role == "tenant":
        agents.append({
            "type": "tenant",
            "label": "My Tenant AI",
            "description": "Ask about your lease, invoices, and service requests.",
            "icon": "🏠",
            "requires_context": False,
        })
    return agents
