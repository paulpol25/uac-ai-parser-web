"""Sheetstorm integration MCP tools for UAC AI."""

from __future__ import annotations

from uac_ai_mcp.server import mcp, get_client


@mcp.tool()
async def uac_sheetstorm_status() -> dict:
    """Check if Sheetstorm integration is enabled and reachable."""
    client = get_client()
    return await client.get("/sheetstorm/status")


@mcp.tool()
async def uac_sheetstorm_list_incidents(limit: int = 50) -> dict:
    """List incidents from Sheetstorm.

    Args:
        limit: Max incidents to return
    """
    client = get_client()
    return await client.get("/sheetstorm/incidents", params={"limit": limit})


@mcp.tool()
async def uac_sheetstorm_create_incident(
    title: str,
    description: str = "",
    severity: str = "medium",
    classification: str = "Incident",
) -> dict:
    """Create a new incident in Sheetstorm.

    Args:
        title: Incident title
        description: Incident description
        severity: low, medium, high, critical
        classification: Incident, Alert, etc.
    """
    client = get_client()
    return await client.post("/sheetstorm/incidents", json={
        "title": title,
        "description": description,
        "severity": severity,
        "classification": classification,
    })


@mcp.tool()
async def uac_sheetstorm_get_incident(incident_id: str) -> dict:
    """Get a Sheetstorm incident by ID.

    Args:
        incident_id: The Sheetstorm incident ID
    """
    client = get_client()
    return await client.get(f"/sheetstorm/incidents/{incident_id}")


@mcp.tool()
async def uac_sheetstorm_sync(investigation_id: int) -> dict:
    """Sync a UAC-AI investigation to Sheetstorm.

    Creates or updates a Sheetstorm incident from the investigation,
    including syncing agent hosts.

    Args:
        investigation_id: UAC-AI investigation ID to sync
    """
    client = get_client()
    return await client.post(f"/sheetstorm/sync/{investigation_id}")


@mcp.tool()
async def uac_sheetstorm_list_iocs(incident_id: str) -> dict:
    """List IOCs for a Sheetstorm incident.

    Args:
        incident_id: The Sheetstorm incident ID
    """
    client = get_client()
    return await client.get(f"/sheetstorm/incidents/{incident_id}/iocs")


@mcp.tool()
async def uac_sheetstorm_add_ioc(
    incident_id: str,
    ioc_type: str,
    value: str,
    description: str = "",
) -> dict:
    """Add an IOC to a Sheetstorm incident.

    Args:
        incident_id: The Sheetstorm incident ID
        ioc_type: Type of IOC (ip, domain, hash_md5, hash_sha256, url, email, etc.)
        value: The IOC value
        description: Optional description
    """
    client = get_client()
    return await client.post(f"/sheetstorm/incidents/{incident_id}/iocs", json={
        "type": ioc_type,
        "value": value,
        "description": description,
    })


@mcp.tool()
async def uac_sheetstorm_list_hosts(incident_id: str) -> dict:
    """List hosts for a Sheetstorm incident.

    Args:
        incident_id: The Sheetstorm incident ID
    """
    client = get_client()
    return await client.get(f"/sheetstorm/incidents/{incident_id}/hosts")
