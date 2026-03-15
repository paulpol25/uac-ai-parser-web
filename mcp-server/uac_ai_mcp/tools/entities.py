"""Entity and graph tools for UAC AI MCP server."""

from __future__ import annotations

from uac_ai_mcp.server import mcp, get_client


@mcp.tool()
async def uac_list_entities(session_id: str, entity_type: str = "") -> dict:
    """List extracted entities from a session (IPs, domains, usernames, filepaths, commands).

    Args:
        session_id: UUID of the session
        entity_type: Filter by type — ip, domain, username, filepath, command (optional)
    """
    client = get_client()
    params: dict = {"session_id": session_id}
    if entity_type:
        params["type"] = entity_type
    return await client.get("/analyze/entities", params=params)


@mcp.tool()
async def uac_search_entity(session_id: str, entity_value: str) -> dict:
    """Search for chunks containing a specific entity value.

    Useful for tracing all activity related to an IP, username, or file path.

    Args:
        session_id: UUID of the session
        entity_value: The entity value to search for (e.g. "192.168.1.100", "admin")
    """
    client = get_client()
    return await client.post(
        "/analyze/entities/search",
        json={"session_id": session_id, "entity_value": entity_value},
    )


@mcp.tool()
async def uac_graph_neighbors(session_id: str, entity_value: str, depth: int = 1) -> dict:
    """Get entities connected to a given entity in the relationship graph.

    Args:
        session_id: UUID of the session
        entity_value: Value of the entity (e.g. "192.168.1.100", "admin")
        depth: How many hops to traverse (default: 1)
    """
    client = get_client()
    return await client.post(
        "/analyze/graph/neighbors",
        json={"session_id": session_id, "entity_value": entity_value, "depth": depth},
    )


@mcp.tool()
async def uac_graph_path(session_id: str, source: str, target: str) -> dict:
    """Find a path between two entities in the relationship graph.

    Useful for understanding how entities are connected (e.g. how an attacker
    reached a specific file from initial access).

    Args:
        session_id: UUID of the session
        source: Starting entity value (e.g. "192.168.1.100")
        target: Target entity value (e.g. "192.168.1.50")
    """
    client = get_client()
    return await client.post(
        "/analyze/graph/path",
        json={
            "session_id": session_id,
            "source": source,
            "target": target,
        },
    )


@mcp.tool()
async def uac_graph_stats(session_id: str) -> dict:
    """Get statistics about the entity relationship graph.

    Args:
        session_id: UUID of the session
    """
    client = get_client()
    return await client.get("/analyze/graph/stats", params={"session_id": session_id})


@mcp.tool()
async def uac_kill_chain_analysis(session_id: str) -> dict:
    """Analyze entity graph to reconstruct potential attack stages (kill chain).

    Maps entity relationships to attack phases: reconnaissance, initial access,
    execution, persistence, lateral movement, etc.

    Args:
        session_id: UUID of the session
    """
    client = get_client()
    return await client.get("/analyze/graph/kill-chain", params={"session_id": session_id})
