"""MITRE ATT&CK mapping tools for UAC AI MCP server."""

from __future__ import annotations

from uac_ai_mcp.server import mcp, get_client


@mcp.tool()
async def uac_mitre_scan(session_id: int) -> dict:
    """Run a MITRE ATT&CK scan on a parsed session to identify techniques and tactics.

    Args:
        session_id: Session ID to scan
    """
    client = get_client()
    return await client.post("/analyze/mitre/scan", json={"session_id": session_id})


@mcp.tool()
async def uac_get_mitre_mappings(session_id: int) -> dict:
    """Get all MITRE ATT&CK technique mappings found in a session.

    Args:
        session_id: Session ID
    """
    client = get_client()
    return await client.get("/analyze/mitre/mappings", params={"session_id": session_id})


@mcp.tool()
async def uac_get_mitre_summary(session_id: int) -> dict:
    """Get a summary of MITRE ATT&CK findings — tactics distribution, top techniques, coverage.

    Args:
        session_id: Session ID
    """
    client = get_client()
    return await client.get("/analyze/mitre/summary", params={"session_id": session_id})


@mcp.tool()
async def uac_compare_sessions(session_a: int, session_b: int) -> dict:
    """Compare two sessions side-by-side (artifacts, entities, anomalies).

    Args:
        session_a: First session ID
        session_b: Second session ID
    """
    client = get_client()
    return await client.post("/analyze/compare", json={"session_a": session_a, "session_b": session_b})
