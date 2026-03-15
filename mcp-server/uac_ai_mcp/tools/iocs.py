"""IOC (Indicators of Compromise) tools for UAC AI MCP server."""

from __future__ import annotations

from uac_ai_mcp.server import mcp, get_client


@mcp.tool()
async def uac_extract_iocs(session_id: int) -> dict:
    """Extract IOCs (IPs, domains, hashes, URLs, emails) from a parsed session.

    Args:
        session_id: Session ID to extract IOCs from
    """
    client = get_client()
    return await client.post("/analyze/iocs/extract", json={"session_id": session_id})


@mcp.tool()
async def uac_correlate_iocs(investigation_id: int) -> dict:
    """Correlate IOCs across all sessions in an investigation.

    Args:
        investigation_id: Investigation ID
    """
    client = get_client()
    return await client.get("/analyze/iocs/correlate", params={"investigation_id": investigation_id})


@mcp.tool()
async def uac_ioc_summary(investigation_id: int) -> dict:
    """Get a summary of IOCs across an investigation (counts by type, top indicators).

    Args:
        investigation_id: Investigation ID
    """
    client = get_client()
    return await client.get("/analyze/iocs/summary", params={"investigation_id": investigation_id})


@mcp.tool()
async def uac_search_iocs(investigation_id: int, query: str, ioc_type: str = "") -> dict:
    """Search IOC entries within an investigation.

    Args:
        investigation_id: Investigation ID
        query: Search value (IP, domain, hash, etc.)
        ioc_type: Filter by type — ip, domain, url, hash, email (optional)
    """
    client = get_client()
    body: dict = {"investigation_id": investigation_id, "query": query}
    if ioc_type:
        body["ioc_type"] = ioc_type
    return await client.post("/analyze/iocs/search", json=body)


@mcp.tool()
async def uac_get_file_hashes(session_id: int, unknown_only: bool = False) -> dict:
    """Get file hashes from a session, optionally filtering to unknown-only.

    Args:
        session_id: Session ID
        unknown_only: If true, return only hashes not marked as known-good
    """
    client = get_client()
    params: dict = {"session_id": session_id}
    if unknown_only:
        params["unknown_only"] = "true"
    return await client.get("/analyze/hashes", params=params)


@mcp.tool()
async def uac_compare_hashes(session_a: int, session_b: int) -> dict:
    """Compare file hashes between two sessions to find new/changed/removed files.

    Args:
        session_a: First session ID
        session_b: Second session ID
    """
    client = get_client()
    return await client.post("/analyze/hashes/compare", json={"session_a": session_a, "session_b": session_b})


@mcp.tool()
async def uac_search_hash(investigation_id: int, hash_value: str) -> dict:
    """Search for a specific file hash across all sessions in an investigation.

    Args:
        investigation_id: Investigation ID
        hash_value: Hash value to search for (MD5/SHA1/SHA256)
    """
    client = get_client()
    return await client.post("/analyze/hashes/search", json={"investigation_id": investigation_id, "hash": hash_value})
