"""Export tools for UAC AI MCP server."""

from __future__ import annotations

from uac_ai_mcp.server import mcp, get_client


@mcp.tool()
async def uac_export_session(
    session_id: int,
    format: str = "json",
    export_type: str = "full",
) -> dict:
    """Export session data in various formats.

    Args:
        session_id: Session ID to export
        format: Output format — json, jsonl, markdown, csv
        export_type: What to export — full, timeline, anomalies
    """
    client = get_client()
    return await client.get(
        "/export",
        params={"session_id": session_id, "format": format, "type": export_type},
    )


@mcp.tool()
async def uac_get_export_formats() -> dict:
    """List all supported export formats and their descriptions."""
    client = get_client()
    return await client.get("/export/formats")
