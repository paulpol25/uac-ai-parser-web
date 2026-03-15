"""Timeline tools for UAC AI MCP server."""

from __future__ import annotations

from uac_ai_mcp.server import mcp, get_client


@mcp.tool()
async def uac_get_timeline(
    session_id: str,
    start_time: str = "",
    end_time: str = "",
    event_types: str = "",
) -> dict:
    """Get timeline data for a session with optional filters.

    Args:
        session_id: UUID of the session
        start_time: ISO8601 start time filter (optional)
        end_time: ISO8601 end time filter (optional)
        event_types: Comma-separated event types to filter (optional)
    """
    client = get_client()
    params: dict = {"session_id": session_id}
    if start_time:
        params["start"] = start_time
    if end_time:
        params["end"] = end_time
    if event_types:
        params["event_types"] = event_types
    return await client.get("/timeline", params=params)


@mcp.tool()
async def uac_get_timeline_stats(session_id: str) -> dict:
    """Get timeline statistics — event frequency by hour/day, event type distribution.

    Args:
        session_id: UUID of the session
    """
    client = get_client()
    return await client.get("/timeline/stats", params={"session_id": session_id})


@mcp.tool()
async def uac_correlate_events(session_id: str, window_seconds: int = 300) -> dict:
    """Correlate events within time windows for attack chain detection.

    Groups events that occur close together in time to identify potential
    attack sequences.

    Args:
        session_id: UUID of the session
        window_seconds: Time window in seconds for correlation (default: 300 = 5 min)
    """
    client = get_client()
    return await client.get(
        "/timeline/correlate",
        params={"session_id": session_id, "window": window_seconds},
    )
