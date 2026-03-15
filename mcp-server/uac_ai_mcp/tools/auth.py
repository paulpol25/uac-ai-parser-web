"""Authentication tools for UAC AI MCP server."""

from __future__ import annotations

from uac_ai_mcp.server import mcp, get_client


@mcp.tool()
async def uac_login(username: str, password: str) -> dict:
    """Authenticate with UAC AI Parser using credentials. Returns auth token."""
    client = get_client()
    return await client.login(username, password)


@mcp.tool()
async def uac_get_current_user() -> dict:
    """Get the currently authenticated user's profile."""
    client = get_client()
    return await client.get("/auth/me")


@mcp.tool()
async def uac_logout() -> dict:
    """Invalidate the current session."""
    client = get_client()
    return await client.post("/auth/logout")
