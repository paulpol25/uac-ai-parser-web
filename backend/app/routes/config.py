"""
Configuration endpoints for managing LLM providers and application settings.
"""
from flask import Blueprint, request, jsonify, current_app
from pathlib import Path
import json
import requests

from app.services.llm_providers import ProviderFactory


config_bp = Blueprint("config", __name__)

# Settings file path
SETTINGS_FILE = Path.home() / '.uac-ai' / 'settings.json'

def _get_processing_settings() -> dict:
    """Get processing settings from file or defaults."""
    defaults = {
        "max_file_size_mb": 500,  # 500MB default
        "max_individual_file_mb": 5,  # 5MB per file for indexing
        "chunk_size": 512,
        "chunk_overlap": 50,
        "hot_cache_size": 1000,
        "timeline_max_events": 10000,
        "bodyfile_max_events": 5000,
        "enable_hybrid_search": True,
        "enable_query_expansion": True,
        "embedding_model": "BAAI/bge-small-en-v1.5",  # Fast default
    }
    
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, 'r') as f:
                saved = json.load(f)
                return {**defaults, **saved.get("processing", {})}
        except Exception:
            pass
    
    return defaults

def _save_processing_settings(settings: dict) -> None:
    """Save processing settings to file."""
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    
    existing = {}
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, 'r') as f:
                existing = json.load(f)
        except Exception:
            pass
    
    existing["processing"] = settings
    
    with open(SETTINGS_FILE, 'w') as f:
        json.dump(existing, f, indent=2)


# ===== Processing Settings =====

@config_bp.route("/settings/processing", methods=["GET"])
def get_processing_settings():
    """Get processing settings (file limits, RAG settings, etc.)."""
    try:
        settings = _get_processing_settings()
        return jsonify(settings)
    except Exception as e:
        return jsonify({
            "error": "settings_error",
            "message": str(e)
        }), 500


@config_bp.route("/settings/processing", methods=["PUT"])
def update_processing_settings():
    """Update processing settings."""
    data = request.get_json()
    
    if not data:
        return jsonify({
            "error": "missing_data",
            "message": "Request body is required"
        }), 400
    
    try:
        current = _get_processing_settings()
        
        # Validate and update settings
        valid_keys = [
            "max_file_size_mb", "max_individual_file_mb", "chunk_size",
            "chunk_overlap", "hot_cache_size", "timeline_max_events",
            "bodyfile_max_events", "enable_hybrid_search", "enable_query_expansion",
            "embedding_model"
        ]
        
        for key in valid_keys:
            if key in data:
                if key.endswith("_mb") or key.endswith("_size") or key.endswith("_events") or key == "chunk_overlap":
                    # Numeric values
                    current[key] = int(data[key])
                elif key.startswith("enable_"):
                    # Boolean values
                    current[key] = bool(data[key])
                elif key == "embedding_model":
                    # String value - validate against available models
                    current[key] = str(data[key])
                else:
                    current[key] = data[key]
        
        _save_processing_settings(current)
        
        return jsonify({
            "message": "Processing settings updated",
            "settings": current
        })
    except Exception as e:
        return jsonify({
            "error": "update_error",
            "message": str(e)
        }), 500


# ===== LLM Provider Configuration =====

@config_bp.route("/providers", methods=["GET"])
def list_providers():
    """
    List all available LLM providers with their status.
    
    Returns information about each provider's availability,
    configuration status, and current model.
    """
    try:
        providers = ProviderFactory.list_providers()
        config = ProviderFactory.get_config()
        
        return jsonify({
            "providers": providers,
            "active_provider": config.get("active_provider", "ollama"),
        })
    except Exception as e:
        return jsonify({
            "error": "provider_list_error",
            "message": str(e)
        }), 500


@config_bp.route("/providers/<provider_type>", methods=["GET"])
def get_provider_config(provider_type: str):
    """Get configuration for a specific provider."""
    try:
        config = ProviderFactory.get_config()
        provider_config = config.get("providers", {}).get(provider_type, {})
        
        # Don't expose full API keys
        safe_config = {**provider_config}
        if "api_key" in safe_config and safe_config["api_key"]:
            safe_config["api_key_set"] = True
            safe_config["api_key"] = "***" + safe_config["api_key"][-4:] if len(safe_config["api_key"]) > 4 else "****"
        else:
            safe_config["api_key_set"] = False
            safe_config["api_key"] = ""
        
        return jsonify({
            "provider": provider_type,
            "config": safe_config,
        })
    except Exception as e:
        return jsonify({
            "error": "config_error",
            "message": str(e)
        }), 500


@config_bp.route("/providers/<provider_type>", methods=["PUT"])
def update_provider_config(provider_type: str):
    """Update configuration for a specific provider."""
    data = request.get_json()
    
    if not data:
        return jsonify({
            "error": "missing_data",
            "message": "Request body is required"
        }), 400
    
    try:
        ProviderFactory.update_provider_config(provider_type, data)
        
        return jsonify({
            "message": f"Provider {provider_type} configuration updated",
            "provider": provider_type,
        })
    except Exception as e:
        return jsonify({
            "error": "update_error",
            "message": str(e)
        }), 500


@config_bp.route("/providers/active", methods=["PUT"])
def set_active_provider():
    """Set the active LLM provider."""
    data = request.get_json()
    
    if not data or "provider" not in data:
        return jsonify({
            "error": "missing_provider",
            "message": "provider field is required"
        }), 400
    
    provider_type = data["provider"]
    valid_providers = ["ollama", "openai", "gemini", "claude"]
    
    if provider_type not in valid_providers:
        return jsonify({
            "error": "invalid_provider",
            "message": f"Provider must be one of: {', '.join(valid_providers)}"
        }), 400
    
    try:
        ProviderFactory.set_active_provider(provider_type)
        
        return jsonify({
            "message": f"Active provider set to {provider_type}",
            "active_provider": provider_type,
        })
    except Exception as e:
        return jsonify({
            "error": "update_error",
            "message": str(e)
        }), 500


@config_bp.route("/providers/<provider_type>/test", methods=["POST"])
def test_provider(provider_type: str):
    """Test connection to a specific provider."""
    try:
        provider = ProviderFactory.get_provider(provider_type)
        
        if not provider.is_available():
            return jsonify({
                "success": False,
                "provider": provider_type,
                "message": "Provider not available - check API key and configuration"
            })
        
        # Try to list models as a basic connectivity test
        models = provider.list_models()
        
        return jsonify({
            "success": True,
            "provider": provider_type,
            "models_available": len(models),
            "message": f"Successfully connected to {provider_type}"
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "provider": provider_type,
            "message": str(e)
        })


# ===== Model Selection =====

@config_bp.route("/models", methods=["GET"])
def list_models():
    """
    List available models for the current active provider.
    
    For backward compatibility, also returns Ollama-style response.
    """
    try:
        config = ProviderFactory.get_config()
        active_provider = config.get("active_provider", "ollama")
        
        provider = ProviderFactory.get_provider()
        models = provider.list_models()
        current_model = provider.get_model()
        
        return jsonify({
            "models": models,
            "current": current_model,
            "provider": active_provider,
            "ollama_status": "connected" if provider.is_available() else "unavailable",
        })
    except Exception as e:
        return jsonify({
            "models": [],
            "current": "",
            "provider": "unknown",
            "ollama_status": "error",
            "error": str(e)
        })


@config_bp.route("/models", methods=["PUT"])
def set_model():
    """Set the active LLM model for the current provider."""
    data = request.get_json()
    
    if not data or "model" not in data:
        return jsonify({
            "error": "missing_model",
            "message": "model field is required"
        }), 400
    
    model = data["model"]
    
    try:
        config = ProviderFactory.get_config()
        active_provider = config.get("active_provider", "ollama")
        
        # Update the model in provider config
        ProviderFactory.update_provider_config(active_provider, {"model": model})
        
        return jsonify({
            "model": model,
            "provider": active_provider,
            "message": f"Model set to {model}"
        })
    except Exception as e:
        return jsonify({
            "error": "model_update_error",
            "message": str(e)
        }), 500


# ===== Embedding Provider Configuration =====

@config_bp.route("/embeddings/providers", methods=["GET"])
def list_embedding_providers():
    """List all available embedding providers."""
    try:
        providers = ProviderFactory.list_embedding_providers()
        config = ProviderFactory.get_config()
        
        return jsonify({
            "providers": providers,
            "active_provider": config.get("active_embedding_provider", "ollama"),
        })
    except Exception as e:
        return jsonify({
            "error": "provider_list_error",
            "message": str(e)
        }), 500


@config_bp.route("/embeddings/providers/<provider_type>", methods=["PUT"])
def update_embedding_provider_config(provider_type: str):
    """Update configuration for a specific embedding provider."""
    data = request.get_json()
    
    if not data:
        return jsonify({
            "error": "missing_data",
            "message": "Request body is required"
        }), 400
    
    try:
        ProviderFactory.update_embedding_provider_config(provider_type, data)
        
        return jsonify({
            "message": f"Embedding provider {provider_type} configuration updated",
            "provider": provider_type,
        })
    except Exception as e:
        return jsonify({
            "error": "update_error",
            "message": str(e)
        }), 500


@config_bp.route("/embeddings/providers/active", methods=["PUT"])
def set_active_embedding_provider():
    """Set the active embedding provider."""
    data = request.get_json()
    
    if not data or "provider" not in data:
        return jsonify({
            "error": "missing_provider",
            "message": "provider field is required"
        }), 400
    
    provider_type = data["provider"]
    valid_providers = ["ollama", "openai"]
    
    if provider_type not in valid_providers:
        return jsonify({
            "error": "invalid_provider",
            "message": f"Provider must be one of: {', '.join(valid_providers)}"
        }), 400
    
    try:
        ProviderFactory.set_active_embedding_provider(provider_type)
        
        return jsonify({
            "message": f"Active embedding provider set to {provider_type}",
            "active_provider": provider_type,
        })
    except Exception as e:
        return jsonify({
            "error": "update_error",
            "message": str(e)
        }), 500


@config_bp.route("/embeddings/models", methods=["GET"])
def list_embedding_models():
    """List available embedding models for the current provider."""
    try:
        config = ProviderFactory.get_config()
        active_provider = config.get("active_embedding_provider", "ollama")
        
        provider = ProviderFactory.get_embedding_provider()
        
        # Get models based on provider type
        if hasattr(provider, "list_embedding_models"):
            models = provider.list_embedding_models()
        else:
            models = []
        
        return jsonify({
            "models": models,
            "current": provider.config.model,
            "provider": active_provider,
            "dimension": provider.get_embedding_dimension(),
        })
    except Exception as e:
        return jsonify({
            "models": [],
            "current": "",
            "provider": "unknown",
            "error": str(e)
        })


@config_bp.route("/embeddings/local/models", methods=["GET"])
def list_local_embedding_models():
    """List available local embedding models (sentence-transformers)."""
    try:
        from app.services.embedding_service import list_embedding_models, get_current_embedding_info
        
        models = list_embedding_models()
        current = get_current_embedding_info()
        
        return jsonify({
            "models": models,
            "current": current["model"],
            "dimension": current["dimension"],
            "device": current["device"],
            "available": current["available"],
        })
    except Exception as e:
        return jsonify({
            "models": [],
            "current": "",
            "dimension": 384,
            "device": "unknown",
            "available": False,
            "error": str(e)
        })


@config_bp.route("/embeddings/local/reload", methods=["POST"])
def reload_local_embedding_model():
    """Reload the local embedding model (after changing settings)."""
    try:
        from app.services.embedding_service import EmbeddingService, get_current_embedding_info
        
        # Reload the model
        EmbeddingService.reload_model()
        
        # Get updated info
        current = get_current_embedding_info()
        
        return jsonify({
            "message": "Embedding model reloaded",
            "model": current["model"],
            "dimension": current["dimension"],
            "device": current["device"],
        })
    except Exception as e:
        return jsonify({
            "error": "reload_error",
            "message": str(e)
        }), 500


# ===== Full Configuration =====

@config_bp.route("/all", methods=["GET"])
def get_full_config():
    """
    Get full configuration (providers, models, settings).
    
    API keys are masked for security.
    """
    try:
        config = ProviderFactory.get_config()
        
        # Mask API keys
        safe_config = {}
        for key, value in config.items():
            if key in ["providers", "embedding_providers"]:
                safe_config[key] = {}
                for provider, pconfig in value.items():
                    safe_pconfig = {**pconfig}
                    if "api_key" in safe_pconfig and safe_pconfig["api_key"]:
                        safe_pconfig["api_key_set"] = True
                        safe_pconfig["api_key"] = "****"
                    else:
                        safe_pconfig["api_key_set"] = False
                    safe_config[key][provider] = safe_pconfig
            else:
                safe_config[key] = value
        
        return jsonify(safe_config)
    except Exception as e:
        return jsonify({
            "error": "config_error",
            "message": str(e)
        }), 500


# ===== Legacy Ollama endpoint for backwards compatibility =====

@config_bp.route("/ollama", methods=["GET"])
def get_ollama_config():
    """Get Ollama configuration (legacy endpoint)."""
    try:
        config = ProviderFactory.get_config()
        ollama_config = config.get("providers", {}).get("ollama", {})
        
        return jsonify({
            "base_url": ollama_config.get("base_url", "http://localhost:11434"),
            "model": ollama_config.get("model", "llama3.1"),
        })
    except Exception as e:
        return jsonify({
            "error": "config_error",
            "message": str(e)
        }), 500
