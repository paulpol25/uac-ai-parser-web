"""Session (parse) management tools for UAC AI MCP server."""

from __future__ import annotations

from uac_ai_mcp.server import mcp, get_client


@mcp.tool()
async def uac_get_session(investigation_id: int, session_id: str) -> dict:
    """Get details of a specific parsing session.

    Args:
        investigation_id: Parent investigation ID
        session_id: UUID of the session
    """
    client = get_client()
    return await client.get(f"/investigations/{investigation_id}/sessions/{session_id}")


@mcp.tool()
async def uac_get_session_status(session_id: str) -> dict:
    """Check the parsing status of a session (processing / searchable / ready / failed).

    Args:
        session_id: UUID of the session
    """
    client = get_client()
    return await client.get(f"/parse/{session_id}/status")


@mcp.tool()
async def uac_get_session_artifacts(session_id: str) -> dict:
    """List all parsed artifacts (files) in a session.

    Args:
        session_id: UUID of the session
    """
    client = get_client()
    return await client.get(f"/parse/{session_id}/artifacts")


@mcp.tool()
async def uac_get_session_stats(session_id: str) -> dict:
    """Get statistics about a session's indexed data (chunk counts, entity counts, etc.).

    Args:
        session_id: UUID of the session
    """
    client = get_client()
    return await client.get("/analyze/session-stats", params={"session_id": session_id})


@mcp.tool()
async def uac_delete_session(investigation_id: int, session_id: str) -> dict:
    """Delete a session and all its associated data.

    Args:
        investigation_id: Parent investigation ID
        session_id: UUID of the session to delete
    """
    client = get_client()
    return await client.delete(f"/investigations/{investigation_id}/sessions/{session_id}")
