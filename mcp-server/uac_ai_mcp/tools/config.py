"""Configuration and settings tools for UAC AI MCP server."""

from __future__ import annotations

from uac_ai_mcp.server import mcp, get_client


@mcp.tool()
async def uac_get_processing_settings() -> dict:
    """Get processing settings (file limits, chunk sizes, RAG toggles, embedding model)."""
    client = get_client()
    return await client.get("/config/settings/processing")


@mcp.tool()
async def uac_update_processing_settings(settings: dict) -> dict:
    """Update processing settings.

    Args:
        settings: Dict of settings to update. Valid keys:
            max_file_size_mb, max_individual_file_mb, chunk_size, chunk_overlap,
            hot_cache_size, timeline_max_events, bodyfile_max_events,
            enable_hybrid_search, enable_query_expansion, embedding_model
    """
    client = get_client()
    return await client.put("/config/settings/processing", json=settings)


@mcp.tool()
async def uac_list_providers() -> dict:
    """List all available LLM providers with their status and active provider."""
    client = get_client()
    return await client.get("/config/providers")


@mcp.tool()
async def uac_get_provider_config(provider_type: str) -> dict:
    """Get configuration for a specific LLM provider (API keys are masked).

    Args:
        provider_type: Provider name — ollama, openai, gemini, claude
    """
    client = get_client()
    return await client.get(f"/config/providers/{provider_type}")


@mcp.tool()
async def uac_update_provider_config(provider_type: str, config: dict) -> dict:
    """Update configuration for a specific LLM provider.

    Args:
        provider_type: Provider name — ollama, openai, gemini, claude
        config: Configuration dict (api_key, model, base_url, etc.)
    """
    client = get_client()
    return await client.put(f"/config/providers/{provider_type}", json=config)


@mcp.tool()
async def uac_set_active_provider(provider: str) -> dict:
    """Set the active LLM provider.

    Args:
        provider: Provider name — ollama, openai, gemini, claude
    """
    client = get_client()
    return await client.put("/config/providers/active", json={"provider": provider})


@mcp.tool()
async def uac_test_provider(provider_type: str) -> dict:
    """Test connectivity to a specific LLM provider.

    Args:
        provider_type: Provider name — ollama, openai, gemini, claude
    """
    client = get_client()
    return await client.post(f"/config/providers/{provider_type}/test")


@mcp.tool()
async def uac_list_models() -> dict:
    """List available models for the current active LLM provider."""
    client = get_client()
    return await client.get("/config/models")


@mcp.tool()
async def uac_set_model(model: str) -> dict:
    """Set the active LLM model.

    Args:
        model: Model name to use (must be available on the active provider)
    """
    client = get_client()
    return await client.put("/config/models", json={"model": model})
