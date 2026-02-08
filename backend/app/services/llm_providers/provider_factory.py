"""
Factory for creating LLM and Embedding providers.
"""
from typing import Optional
from pathlib import Path
import json
import os

from .base import (
    LLMProvider,
    EmbeddingProvider,
    ProviderConfig,
    ProviderType,
    EmbeddingProviderType,
)
from .ollama_provider import OllamaProvider, OllamaEmbeddingProvider
from .openai_provider import OpenAIProvider, OpenAIEmbeddingProvider
from .gemini_provider import GeminiProvider
from .claude_provider import ClaudeProvider


# Config file location
CONFIG_PATH = Path(os.environ.get("UAC_CONFIG_PATH", "~/.uac-ai/providers.json")).expanduser()


class ProviderFactory:
    """Factory for creating and managing LLM providers."""
    
    _providers: dict[ProviderType, type[LLMProvider]] = {
        ProviderType.OLLAMA: OllamaProvider,
        ProviderType.OPENAI: OpenAIProvider,
        ProviderType.GEMINI: GeminiProvider,
        ProviderType.CLAUDE: ClaudeProvider,
    }
    
    _embedding_providers: dict[EmbeddingProviderType, type[EmbeddingProvider]] = {
        EmbeddingProviderType.OLLAMA: OllamaEmbeddingProvider,
        EmbeddingProviderType.OPENAI: OpenAIEmbeddingProvider,
    }
    
    # Singleton instances
    _active_provider: Optional[LLMProvider] = None
    _active_embedding_provider: Optional[EmbeddingProvider] = None
    _config: Optional[dict] = None
    
    @classmethod
    def _load_config(cls) -> dict:
        """Load provider configuration from file."""
        if cls._config is not None:
            return cls._config
        
        default_config = {
            "active_provider": "ollama",
            "active_embedding_provider": "ollama",
            "providers": {
                "ollama": {
                    "base_url": os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434"),
                    "model": os.environ.get("OLLAMA_MODEL", "llama3.1"),
                    "temperature": 0.7,
                    "max_tokens": 4096,
                },
                "openai": {
                    "api_key": os.environ.get("OPENAI_API_KEY", ""),
                    "model": "gpt-4o-mini",
                    "temperature": 0.7,
                    "max_tokens": 4096,
                },
                "gemini": {
                    "api_key": os.environ.get("GEMINI_API_KEY", ""),
                    "model": "gemini-1.5-flash",
                    "temperature": 0.7,
                    "max_tokens": 4096,
                },
                "claude": {
                    "api_key": os.environ.get("ANTHROPIC_API_KEY", ""),
                    "model": "claude-3-5-sonnet-20241022",
                    "temperature": 0.7,
                    "max_tokens": 4096,
                },
            },
            "embedding_providers": {
                "ollama": {
                    "base_url": os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434"),
                    "model": "nomic-embed-text",
                },
                "openai": {
                    "api_key": os.environ.get("OPENAI_API_KEY", ""),
                    "model": "text-embedding-3-small",
                },
            }
        }
        
        if CONFIG_PATH.exists():
            try:
                with open(CONFIG_PATH, "r") as f:
                    saved_config = json.load(f)
                    # Merge with defaults
                    for key in default_config:
                        if key not in saved_config:
                            saved_config[key] = default_config[key]
                        elif isinstance(default_config[key], dict):
                            for subkey in default_config[key]:
                                if subkey not in saved_config[key]:
                                    saved_config[key][subkey] = default_config[key][subkey]
                    cls._config = saved_config
            except Exception:
                cls._config = default_config
        else:
            cls._config = default_config
        
        return cls._config
    
    @classmethod
    def _save_config(cls) -> None:
        """Save provider configuration to file."""
        if cls._config is None:
            return
        
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(CONFIG_PATH, "w") as f:
            json.dump(cls._config, f, indent=2)
    
    @classmethod
    def get_config(cls) -> dict:
        """Get full configuration."""
        return cls._load_config().copy()
    
    @classmethod
    def update_config(cls, updates: dict) -> None:
        """Update configuration."""
        config = cls._load_config()
        
        # Deep merge updates
        for key, value in updates.items():
            if isinstance(value, dict) and key in config and isinstance(config[key], dict):
                config[key].update(value)
            else:
                config[key] = value
        
        cls._config = config
        cls._save_config()
        
        # Reset active providers to pick up changes
        cls._active_provider = None
        cls._active_embedding_provider = None
    
    @classmethod
    def set_active_provider(cls, provider_type: str) -> None:
        """Set the active LLM provider."""
        config = cls._load_config()
        config["active_provider"] = provider_type
        cls._config = config
        cls._save_config()
        cls._active_provider = None
    
    @classmethod
    def set_active_embedding_provider(cls, provider_type: str) -> None:
        """Set the active embedding provider."""
        config = cls._load_config()
        config["active_embedding_provider"] = provider_type
        cls._config = config
        cls._save_config()
        cls._active_embedding_provider = None
    
    @classmethod
    def get_provider(cls, provider_type: Optional[str] = None) -> LLMProvider:
        """Get an LLM provider instance."""
        config = cls._load_config()
        
        if provider_type is None:
            provider_type = config.get("active_provider", "ollama")
        
        # Return cached if same type
        if cls._active_provider is not None:
            if cls._active_provider.provider_type.value == provider_type:
                return cls._active_provider
        
        try:
            ptype = ProviderType(provider_type)
        except ValueError:
            raise ValueError(f"Unknown provider type: {provider_type}")
        
        provider_class = cls._providers.get(ptype)
        if provider_class is None:
            raise ValueError(f"Provider not implemented: {provider_type}")
        
        provider_config = config.get("providers", {}).get(provider_type, {})
        cfg = ProviderConfig(
            provider_type=ptype,
            api_key=provider_config.get("api_key"),
            base_url=provider_config.get("base_url"),
            model=provider_config.get("model", ""),
            temperature=provider_config.get("temperature", 0.7),
            max_tokens=provider_config.get("max_tokens", 4096),
        )
        
        cls._active_provider = provider_class(cfg)
        return cls._active_provider
    
    @classmethod
    def get_embedding_provider(cls, provider_type: Optional[str] = None) -> EmbeddingProvider:
        """Get an embedding provider instance."""
        config = cls._load_config()
        
        if provider_type is None:
            provider_type = config.get("active_embedding_provider", "ollama")
        
        # Return cached if same type
        if cls._active_embedding_provider is not None:
            current_type = cls._active_embedding_provider.provider_type.value
            if current_type == provider_type:
                return cls._active_embedding_provider
        
        try:
            ptype = EmbeddingProviderType(provider_type)
        except ValueError:
            raise ValueError(f"Unknown embedding provider type: {provider_type}")
        
        provider_class = cls._embedding_providers.get(ptype)
        if provider_class is None:
            raise ValueError(f"Embedding provider not implemented: {provider_type}")
        
        provider_config = config.get("embedding_providers", {}).get(provider_type, {})
        cfg = ProviderConfig(
            provider_type=ptype,
            api_key=provider_config.get("api_key"),
            base_url=provider_config.get("base_url"),
            model=provider_config.get("model", ""),
        )
        
        cls._active_embedding_provider = provider_class(cfg)
        return cls._active_embedding_provider
    
    # Privacy information for each provider
    PROVIDER_PRIVACY_INFO = {
        "ollama": {
            "privacy_level": "local",
            "data_sent": "none",
            "description": "Runs locally on your machine. Your data never leaves your computer.",
            "warning": None,
        },
        "openai": {
            "privacy_level": "cloud",
            "data_sent": "queries_and_context",
            "description": "Data is sent to OpenAI servers for processing.",
            "warning": "Your forensic data will be sent to OpenAI's API. Check OpenAI's data retention policies before using with sensitive investigations.",
        },
        "gemini": {
            "privacy_level": "cloud",
            "data_sent": "queries_and_context",
            "description": "Data is sent to Google's servers for processing.",
            "warning": "Your forensic data will be sent to Google's API. Check Google's data retention and AI training policies before using with sensitive investigations.",
        },
        "claude": {
            "privacy_level": "cloud",
            "data_sent": "queries_and_context",
            "description": "Data is sent to Anthropic's servers for processing.",
            "warning": "Your forensic data will be sent to Anthropic's API. Check Anthropic's data retention policies before using with sensitive investigations.",
        },
    }
    
    @classmethod
    def list_providers(cls) -> list[dict]:
        """List all available providers with their status and privacy info."""
        config = cls._load_config()
        active = config.get("active_provider", "ollama")
        
        providers = []
        for ptype in ProviderType:
            provider_config = config.get("providers", {}).get(ptype.value, {})
            privacy_info = cls.PROVIDER_PRIVACY_INFO.get(ptype.value, {})
            
            # Check availability
            try:
                provider = cls.get_provider(ptype.value)
                available = provider.is_available()
            except Exception:
                available = False
            
            providers.append({
                "type": ptype.value,
                "name": ptype.value.title(),
                "active": ptype.value == active,
                "available": available,
                "configured": bool(provider_config.get("api_key")) or ptype == ProviderType.OLLAMA,
                "model": provider_config.get("model", ""),
                # Privacy info
                "privacy_level": privacy_info.get("privacy_level", "unknown"),
                "data_sent": privacy_info.get("data_sent", "unknown"),
                "privacy_description": privacy_info.get("description", ""),
                "privacy_warning": privacy_info.get("warning"),
            })
        
        return providers
    
    @classmethod
    def list_embedding_providers(cls) -> list[dict]:
        """List all available embedding providers with their status."""
        config = cls._load_config()
        active = config.get("active_embedding_provider", "ollama")
        
        providers = []
        for ptype in EmbeddingProviderType:
            provider_config = config.get("embedding_providers", {}).get(ptype.value, {})
            
            # Check availability
            try:
                provider = cls.get_embedding_provider(ptype.value)
                available = provider.is_available()
            except Exception:
                available = False
            
            providers.append({
                "type": ptype.value,
                "name": ptype.value.title(),
                "active": ptype.value == active,
                "available": available,
                "configured": bool(provider_config.get("api_key")) or ptype == EmbeddingProviderType.OLLAMA,
                "model": provider_config.get("model", ""),
            })
        
        return providers
    
    @classmethod
    def update_provider_config(cls, provider_type: str, updates: dict) -> None:
        """Update configuration for a specific provider."""
        config = cls._load_config()
        
        if "providers" not in config:
            config["providers"] = {}
        if provider_type not in config["providers"]:
            config["providers"][provider_type] = {}
        
        config["providers"][provider_type].update(updates)
        cls._config = config
        cls._save_config()
        
        # Reset active provider if it's the one being updated
        if cls._active_provider and cls._active_provider.provider_type.value == provider_type:
            cls._active_provider = None
    
    @classmethod
    def update_embedding_provider_config(cls, provider_type: str, updates: dict) -> None:
        """Update configuration for a specific embedding provider."""
        config = cls._load_config()
        
        if "embedding_providers" not in config:
            config["embedding_providers"] = {}
        if provider_type not in config["embedding_providers"]:
            config["embedding_providers"][provider_type] = {}
        
        config["embedding_providers"][provider_type].update(updates)
        cls._config = config
        cls._save_config()
        
        # Reset active provider if it's the one being updated
        if cls._active_embedding_provider and cls._active_embedding_provider.provider_type.value == provider_type:
            cls._active_embedding_provider = None


# Convenience functions
def get_provider(provider_type: Optional[str] = None) -> LLMProvider:
    """Get the active LLM provider."""
    return ProviderFactory.get_provider(provider_type)


def get_embedding_provider(provider_type: Optional[str] = None) -> EmbeddingProvider:
    """Get the active embedding provider."""
    return ProviderFactory.get_embedding_provider(provider_type)
