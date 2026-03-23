"""SSE-to-stdio proxy for the UAC AI MCP Server.

Transparent bridge that lets stdio-only MCP clients (Claude Desktop, Gemini CLI)
connect to a remote UAC AI MCP server running SSE transport.

Usage:
    uac-ai-proxy [SSE_URL]

    SSE_URL defaults to http://localhost:8811/sse (for Docker-local use).
    Set MCP_AUTH_TOKEN env var to authenticate with the SSE endpoint.

Architecture:
    Claude Desktop ←→ stdin/stdout ←→ uac-ai-proxy ←→ SSE ←→ UAC AI MCP Server
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

logger = logging.getLogger("uac_ai_mcp.proxy")


async def _run(url: str, headers: dict[str, str] | None = None) -> None:
    from mcp.client.sse import sse_client
    from mcp.server.stdio import stdio_server

    async with sse_client(url, headers=headers) as (sse_read, sse_write, *_):
        async with stdio_server() as (stdio_read, stdio_write):

            async def stdin_to_sse() -> None:
                """Forward client requests from stdin to the SSE server."""
                async for msg in stdio_read:
                    if isinstance(msg, Exception):
                        logger.debug("stdio error: %s", msg)
                        continue
                    await sse_write.send(msg)

            async def sse_to_stdout() -> None:
                """Forward server responses from SSE back to stdout."""
                async for msg in sse_read:
                    if isinstance(msg, Exception):
                        logger.debug("SSE error: %s", msg)
                        continue
                    await stdio_write.send(msg)

            tasks = [
                asyncio.create_task(stdin_to_sse()),
                asyncio.create_task(sse_to_stdout()),
            ]
            _done, pending = await asyncio.wait(
                tasks, return_when=asyncio.FIRST_COMPLETED
            )
            for t in pending:
                t.cancel()


def main() -> None:
    """Entry point for the uac-ai-proxy CLI command."""
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8811/sse"

    logging.basicConfig(
        level=getattr(logging, os.getenv("LOG_LEVEL", "WARNING").upper(), logging.WARNING),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        stream=sys.stderr,
    )

    headers: dict[str, str] = {}
    token = os.getenv("MCP_AUTH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    logger.info("Proxying stdio ↔ SSE: %s", url)
    asyncio.run(_run(url, headers or None))


if __name__ == "__main__":
    main()
