"""Configuration management for the UAC AI MCP server."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# Load .env from mcp-server directory
_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)


@dataclass(frozen=True)
class Config:
    """Immutable configuration for the MCP server."""

    # UAC AI backend
    api_url: str = field(
        default_factory=lambda: os.getenv("UAC_AI_API_URL", "http://localhost:5001/api/v1")
    )
    api_token: str | None = field(default_factory=lambda: os.getenv("UAC_AI_API_TOKEN"))
    username: str | None = field(default_factory=lambda: os.getenv("UAC_AI_USERNAME"))
    password: str | None = field(default_factory=lambda: os.getenv("UAC_AI_PASSWORD"))

    # MCP transport
    transport: str = field(default_factory=lambda: os.getenv("MCP_TRANSPORT", "stdio"))
    sse_port: int = field(
        default_factory=lambda: int(os.getenv("SSE_PORT", os.getenv("MCP_SSE_PORT", "8811")))
    )

    # MCP auth token (for SSE transport security)
    mcp_auth_token: str | None = field(default_factory=lambda: os.getenv("MCP_AUTH_TOKEN"))

    # Redis
    redis_url: str | None = field(default_factory=lambda: os.getenv("REDIS_URL"))

    # Logging
    log_level: str = field(default_factory=lambda: os.getenv("LOG_LEVEL", "INFO"))

    # HTTP client
    http_timeout: int = field(default_factory=lambda: int(os.getenv("HTTP_TIMEOUT", "30")))
    http_max_retries: int = field(
        default_factory=lambda: int(os.getenv("HTTP_MAX_RETRIES", "2"))
    )

    @property
    def has_credentials(self) -> bool:
        return bool(self.api_token) or (bool(self.username) and bool(self.password))


def get_config() -> Config:
    """Return a fresh configuration instance."""
    return Config()
