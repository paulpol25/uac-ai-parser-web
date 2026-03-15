"""Entry point for the UAC AI MCP server."""

from __future__ import annotations

import logging
import sys

from uac_ai_mcp.config import get_config


def main() -> None:
    cfg = get_config()

    logging.basicConfig(
        level=getattr(logging, cfg.log_level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    from uac_ai_mcp.server import mcp

    if cfg.transport == "sse":
        mcp.run(transport="sse")
    else:
        mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
