"""UAC AI MCP Server — main server definition and tool registration.

Uses the FastMCP high-level API from the `mcp` SDK.
Supports both stdio (Claude Desktop, VS Code) and SSE (remote) transports.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from mcp.server.fastmcp import FastMCP

from uac_ai_mcp import __version__
from uac_ai_mcp.client import UACClient
from uac_ai_mcp.config import Config, get_config

logger = logging.getLogger("uac_ai_mcp.server")

# ---------------------------------------------------------------------------
# Lifespan — initialise / tear-down the API client
# ---------------------------------------------------------------------------

_client: UACClient | None = None


def get_client() -> UACClient:
    """Return the shared API client (called from every tool handler)."""
    if _client is None:
        raise RuntimeError("UAC AI client not initialised — server not started yet.")
    return _client


@asynccontextmanager
async def server_lifespan(server: FastMCP) -> AsyncIterator[dict]:
    """Manage UACClient lifecycle."""
    global _client
    cfg = get_config()
    _client = UACClient(cfg)

    logger.info(
        "UAC AI MCP server v%s started — backend at %s",
        __version__,
        cfg.api_url,
    )

    try:
        yield {"client": _client, "config": cfg}
    finally:
        await _client.close()
        _client = None
        logger.info("UAC AI MCP server shut down")


# ---------------------------------------------------------------------------
# MCP Server instance
# ---------------------------------------------------------------------------

_cfg = get_config()

mcp = FastMCP(
    "uac-ai-mcp",
    instructions=f"UAC AI MCP Server v{__version__} — Forensic Analysis Platform tools",
    lifespan=server_lifespan,
    host="0.0.0.0",
    port=_cfg.sse_port,
)


# ---------------------------------------------------------------------------
# Import tool modules — each module registers tools on `mcp` at import time
# ---------------------------------------------------------------------------

def _register_all_tools() -> None:
    """Import every tool module so their @mcp.tool decorators execute."""
    from uac_ai_mcp.tools import auth  # noqa: F401
    from uac_ai_mcp.tools import investigations  # noqa: F401
    from uac_ai_mcp.tools import sessions  # noqa: F401
    from uac_ai_mcp.tools import parse  # noqa: F401
    from uac_ai_mcp.tools import analyze  # noqa: F401
    from uac_ai_mcp.tools import timeline  # noqa: F401
    from uac_ai_mcp.tools import search  # noqa: F401
    from uac_ai_mcp.tools import entities  # noqa: F401
    from uac_ai_mcp.tools import iocs  # noqa: F401
    from uac_ai_mcp.tools import mitre  # noqa: F401
    from uac_ai_mcp.tools import export  # noqa: F401
    from uac_ai_mcp.tools import config  # noqa: F401
    from uac_ai_mcp.tools import chats  # noqa: F401
    from uac_ai_mcp.tools import resources  # noqa: F401


_register_all_tools()
