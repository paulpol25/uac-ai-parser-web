"""Analysis / query tools for UAC AI MCP server."""

from __future__ import annotations

from uac_ai_mcp.server import mcp, get_client


@mcp.tool()
async def uac_query(session_id: str, query: str, investigation_id: int = 0) -> dict:
    """Submit a natural language query about forensic data in a session.

    Uses RAG (Retrieval-Augmented Generation) to answer questions about
    the parsed UAC artifacts. The response includes cited sources.

    Args:
        session_id: UUID of the session to query
        query: Natural language question (e.g. "What persistence mechanisms were found?")
        investigation_id: Investigation ID (passed for context; 0 to skip)
    """
    client = get_client()
    payload = {"session_id": session_id, "query": query}
    if investigation_id:
        payload["investigation_id"] = investigation_id
    return await client.post("/analyze/query", json=payload)


@mcp.tool()
async def uac_agent_query(session_id: str, query: str, investigation_id: int = 0) -> dict:
    """Submit a complex query using the agentic RAG pipeline.

    This uses multi-step reasoning: the agent plans sub-queries, gathers
    evidence from multiple artifact types, and synthesises a comprehensive answer.

    Args:
        session_id: UUID of the session
        query: Complex investigation question
        investigation_id: Investigation ID (optional)
    """
    client = get_client()
    payload = {"session_id": session_id, "query": query}
    if investigation_id:
        payload["investigation_id"] = investigation_id
    return await client.post("/analyze/query/agent", json=payload)


@mcp.tool()
async def uac_get_summary(session_id: str) -> dict:
    """Generate an incident summary for a parsed session.

    Returns an AI-generated overview of key findings, suspicious activity,
    and recommendations.

    Args:
        session_id: UUID of the session
    """
    client = get_client()
    return await client.get("/analyze/summary", params={"session_id": session_id})


@mcp.tool()
async def uac_detect_anomalies(session_id: str) -> dict:
    """Detect and score anomalies in forensic data.

    Identifies unusual patterns like off-hours activity, suspicious commands,
    unexpected network connections, etc.

    Args:
        session_id: UUID of the session
    """
    client = get_client()
    return await client.get("/analyze/anomalies", params={"session_id": session_id})


@mcp.tool()
async def uac_get_suggestions(session_id: str) -> dict:
    """Get AI-powered question suggestions based on session data.

    Returns a list of relevant investigation questions the analyst might want to ask.

    Args:
        session_id: UUID of the session
    """
    client = get_client()
    return await client.get("/analyze/suggestions", params={"session_id": session_id})


@mcp.tool()
async def uac_context_preview(session_id: str, query: str) -> dict:
    """Preview what RAG context/chunks would be retrieved for a query without calling the LLM.

    Useful for understanding what evidence the system would use to answer.

    Args:
        session_id: UUID of the session
        query: The query to preview context for
    """
    client = get_client()
    return await client.post("/analyze/context-preview", json={"session_id": session_id, "query": query})


@mcp.tool()
async def uac_extract_iocs_legacy(session_id: str) -> dict:
    """Extract indicators of compromise (IPs, domains, hashes, paths) from a session.

    Legacy endpoint — prefer uac_extract_iocs from the iocs module for the newer API.

    Args:
        session_id: UUID of the session
    """
    client = get_client()
    return await client.get("/analyze/extract-iocs", params={"session_id": session_id})
