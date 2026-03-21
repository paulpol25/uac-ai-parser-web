"""
Configuration endpoints for managing LLM providers and application settings.
"""
from flask import Blueprint, request, jsonify, current_app
from pathlib import Path
import json
import requests

from app.services.llm_providers import ProviderFactory
from app.routes.auth import require_auth, require_permission


config_bp = Blueprint("config", __name__)

# Settings file path — use persistent Docker volume when available
import os
SETTINGS_FILE = Path(
    os.environ.get("UAC_SETTINGS_PATH",
                   "/app/data/settings.json" if os.path.isdir("/app/data") else str(Path.home() / '.uac-ai' / 'settings.json'))
)

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
        "auto_embed": False,  # Skip GPU embeddings by default — queries use BM25 keyword search
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
@require_auth
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
@require_permission("manage_settings")
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
@require_auth
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
@require_auth
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
@require_permission("manage_settings")
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
@require_permission("manage_settings")
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
@require_permission("manage_settings")
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
@require_auth
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
@require_permission("manage_settings")
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
@require_auth
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
@require_permission("manage_settings")
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
@require_permission("manage_settings")
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
@require_auth
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
@require_auth
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
@require_permission("manage_settings")
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
@require_auth
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
@require_auth
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


# ===== Integration Settings =====

def _get_integration_settings() -> dict:
    """Get integration settings from settings file."""
    defaults = {
        "sheetstorm_url": "",
        "sheetstorm_api_token": "",
        "sheetstorm_username": "",
        "sheetstorm_password": "",
    }
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, "r") as f:
                saved = json.load(f)
                return {**defaults, **saved.get("integrations", {})}
        except Exception:
            pass
    return defaults


def _save_integration_settings(settings: dict) -> None:
    """Save integration settings to settings file."""
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)

    existing = {}
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, "r") as f:
                existing = json.load(f)
        except Exception:
            pass

    existing["integrations"] = settings

    with open(SETTINGS_FILE, "w") as f:
        json.dump(existing, f, indent=2)


def _apply_integration_to_app(settings: dict) -> None:
    """Push integration values into Flask config so SheetstormService picks them up."""
    current_app.config["SHEETSTORM_API_URL"] = settings.get("sheetstorm_url", "")
    current_app.config["SHEETSTORM_API_TOKEN"] = settings.get("sheetstorm_api_token", "")
    current_app.config["SHEETSTORM_USERNAME"] = settings.get("sheetstorm_username", "")
    current_app.config["SHEETSTORM_PASSWORD"] = settings.get("sheetstorm_password", "")


@config_bp.route("/settings/integrations", methods=["GET"])
@require_auth
def get_integration_settings():
    """Get integration settings (Sheetstorm, etc.)."""
    try:
        settings = _get_integration_settings()
        # Mask secrets
        safe = {**settings}
        for key in ("sheetstorm_api_token", "sheetstorm_password"):
            val = safe.get(key, "")
            if val:
                safe[key] = "****" + val[-4:] if len(val) > 4 else "****"
                safe[f"{key}_set"] = True
            else:
                safe[f"{key}_set"] = False
        return jsonify(safe)
    except Exception as e:
        return jsonify({"error": "settings_error", "message": str(e)}), 500


@config_bp.route("/settings/integrations", methods=["PUT"])
@require_permission("manage_settings")
def update_integration_settings():
    """Update integration settings."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "missing_data", "message": "Request body is required"}), 400

    try:
        current = _get_integration_settings()

        valid_keys = ["sheetstorm_url", "sheetstorm_api_token", "sheetstorm_username", "sheetstorm_password"]
        for key in valid_keys:
            if key in data:
                current[key] = str(data[key])

        _save_integration_settings(current)
        _apply_integration_to_app(current)

        return jsonify({"message": "Integration settings updated", "settings": {
            k: (current[k] if k in ("sheetstorm_url", "sheetstorm_username") else ("****" if current[k] else ""))
            for k in valid_keys
        }})
    except Exception as e:
        return jsonify({"error": "update_error", "message": str(e)}), 500


@config_bp.route("/settings/integrations/test", methods=["POST"])
@require_permission("manage_settings")
def test_integration():
    """Test Sheetstorm integration connectivity."""
    try:
        from app.services.sheetstorm_service import SheetstormService
        svc = SheetstormService()
        if not svc.enabled:
            return jsonify({"success": False, "message": "Sheetstorm URL not configured"})
        svc.list_incidents(limit=1)
        return jsonify({"success": True, "message": "Successfully connected to Sheetstorm"})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)})


# ===== General / Application Settings =====

# Settings that map to ENV variables / Flask config
GENERAL_SETTINGS_SCHEMA = {
    "base_url": {
        "label": "Base URL",
        "description": "Public URL of this server (used for agent bootstrap scripts)",
        "type": "string",
        "config_key": "BASE_URL",
    },
    "data_retention_days": {
        "label": "Data Retention (days)",
        "description": "Number of days to keep data before auto-cleanup (0 = never)",
        "type": "int",
        "config_key": "DATA_RETENTION_DAYS",
    },
    "max_storage_gb": {
        "label": "Max Storage (GB)",
        "description": "Maximum storage in GB before oldest data is cleaned up",
        "type": "float",
        "config_key": "MAX_STORAGE_GB",
    },
    "cleanup_extracted_after_parse": {
        "label": "Cleanup Extracted Files After Parse",
        "description": "Automatically delete extracted archive files after parsing completes",
        "type": "bool",
        "config_key": "CLEANUP_EXTRACTED_AFTER_PARSE",
    },
    "cors_origins": {
        "label": "CORS Origins",
        "description": "Allowed CORS origins (comma-separated URLs)",
        "type": "string",
        "config_key": "CORS_ORIGINS",
    },
    "auth_provider": {
        "label": "Auth Provider",
        "description": "Authentication provider: 'local' or 'supabase'",
        "type": "string",
        "config_key": "AUTH_PROVIDER",
        "read_only": True,
    },
}


def _get_general_settings() -> dict:
    """Read general settings from the settings file + current Flask config."""
    saved = {}
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, "r") as f:
                saved = json.load(f).get("general", {})
        except Exception:
            pass

    result = {}
    for key, schema in GENERAL_SETTINGS_SCHEMA.items():
        config_key = schema["config_key"]

        # Prefer saved value, fall back to current Flask config
        if key in saved:
            result[key] = saved[key]
        else:
            val = current_app.config.get(config_key, "")
            if isinstance(val, list):
                val = ", ".join(val)
            result[key] = val

    return result


def _save_general_settings(settings: dict) -> None:
    """Save general settings to settings file and apply to running app."""
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)

    existing = {}
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, "r") as f:
                existing = json.load(f)
        except Exception:
            pass

    existing["general"] = settings

    with open(SETTINGS_FILE, "w") as f:
        json.dump(existing, f, indent=2)

    # Apply to running Flask config
    for key, schema in GENERAL_SETTINGS_SCHEMA.items():
        if key in settings and not schema.get("read_only"):
            config_key = schema["config_key"]
            val = settings[key]
            if schema["type"] == "int":
                val = int(val)
            elif schema["type"] == "float":
                val = float(val)
            elif schema["type"] == "bool":
                val = val if isinstance(val, bool) else str(val).lower() == "true"
            elif config_key == "CORS_ORIGINS":
                val = [s.strip() for s in str(val).split(",") if s.strip()]
            current_app.config[config_key] = val


@config_bp.route("/settings/general", methods=["GET"])
@require_auth
def get_general_settings():
    """Get general application settings."""
    try:
        settings = _get_general_settings()
        schema = {k: {kk: vv for kk, vv in v.items() if kk != "config_key"}
                  for k, v in GENERAL_SETTINGS_SCHEMA.items()}
        return jsonify({"settings": settings, "schema": schema})
    except Exception as e:
        return jsonify({"error": "settings_error", "message": str(e)}), 500


@config_bp.route("/settings/general", methods=["PUT"])
@require_permission("manage_settings")
def update_general_settings():
    """Update general application settings."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "missing_data", "message": "Request body is required"}), 400

    try:
        current = _get_general_settings()
        for key, schema in GENERAL_SETTINGS_SCHEMA.items():
            if key in data and not schema.get("read_only"):
                current[key] = data[key]
        _save_general_settings(current)
        return jsonify({"message": "General settings updated", "settings": current})
    except Exception as e:
        return jsonify({"error": "update_error", "message": str(e)}), 500
