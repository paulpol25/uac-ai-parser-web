"""
Health check endpoint for monitoring and readiness probes.
"""
from flask import Blueprint, jsonify, current_app
import requests

health_bp = Blueprint("health", __name__)


@health_bp.route("/health", methods=["GET"])
def health_check():
    """
    Basic health check endpoint.
    
    Returns service status and dependency availability.
    """
    ollama_status = check_ollama_status(current_app.config["OLLAMA_BASE_URL"])
    
    return jsonify({
        "status": "healthy",
        "service": "uac-ai-parser",
        "version": "1.0.0",
        "dependencies": {
            "ollama": ollama_status
        }
    })


def check_ollama_status(base_url: str) -> str:
    """Check if Ollama is available."""
    try:
        response = requests.get(f"{base_url}/api/tags", timeout=2)
        return "connected" if response.status_code == 200 else "error"
    except requests.exceptions.RequestException:
        return "unavailable"
