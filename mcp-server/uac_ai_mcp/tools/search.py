"""Search tools for UAC AI MCP server."""

from __future__ import annotations

from uac_ai_mcp.server import mcp, get_client


@mcp.tool()
async def uac_search_chunks(
    session_id: str,
    query: str = "",
    source_type: str = "",
    artifact_category: str = "",
    page: int = 1,
    per_page: int = 20,
) -> dict:
    """Search through parsed log chunks in a session.

    Args:
        session_id: UUID of the session
        query: Text search query (optional)
        source_type: Filter by source type — log, config, user, network (optional)
        artifact_category: Filter by artifact category — users, persistence, network, logs (optional)
        page: Page number for pagination (default: 1)
        per_page: Results per page (default: 20)
    """
    client = get_client()
    params: dict = {"session_id": session_id, "page": page, "per_page": per_page}
    if query:
        params["q"] = query
    if source_type:
        params["source_type"] = source_type
    if artifact_category:
        params["artifact_category"] = artifact_category
    return await client.get("/search", params=params)


@mcp.tool()
async def uac_get_search_filters(session_id: str) -> dict:
    """Get available filter options (source types, artifact categories) for a session.

    Args:
        session_id: UUID of the session
    """
    client = get_client()
    return await client.get("/search/filters", params={"session_id": session_id})


@mcp.tool()
async def uac_get_chunk(chunk_id: str) -> dict:
    """Get full details of a specific chunk by its chunk ID.

    Args:
        chunk_id: The unique chunk identifier
    """
    client = get_client()
    return await client.get(f"/search/chunk/{chunk_id}")
