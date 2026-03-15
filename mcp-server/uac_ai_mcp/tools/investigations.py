"""Investigation management tools for UAC AI MCP server."""

from __future__ import annotations

from uac_ai_mcp.server import mcp, get_client


@mcp.tool()
async def uac_list_investigations() -> dict:
    """List all investigations for the current user."""
    client = get_client()
    return await client.get("/investigations")


@mcp.tool()
async def uac_get_investigation(investigation_id: int) -> dict:
    """Get details of a specific investigation including its sessions."""
    client = get_client()
    return await client.get(f"/investigations/{investigation_id}")


@mcp.tool()
async def uac_create_investigation(name: str, description: str = "", case_number: str = "") -> dict:
    """Create a new forensic investigation.

    Args:
        name: Investigation name
        description: Optional description of the investigation
        case_number: Optional case reference number
    """
    client = get_client()
    payload = {"name": name}
    if description:
        payload["description"] = description
    if case_number:
        payload["case_number"] = case_number
    return await client.post("/investigations", json=payload)


@mcp.tool()
async def uac_update_investigation(
    investigation_id: int,
    name: str = "",
    description: str = "",
    case_number: str = "",
    status: str = "",
) -> dict:
    """Update an existing investigation's details.

    Args:
        investigation_id: ID of the investigation
        name: New name (optional)
        description: New description (optional)
        case_number: New case number (optional)
        status: New status — active, archived, deleted (optional)
    """
    client = get_client()
    payload = {}
    if name:
        payload["name"] = name
    if description:
        payload["description"] = description
    if case_number:
        payload["case_number"] = case_number
    if status:
        payload["status"] = status
    return await client.put(f"/investigations/{investigation_id}", json=payload)


@mcp.tool()
async def uac_delete_investigation(investigation_id: int) -> dict:
    """Permanently delete an investigation and all associated data."""
    client = get_client()
    return await client.delete(f"/investigations/{investigation_id}")
