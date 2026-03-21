"""
Sheetstorm integration endpoints.

Proxies Sheetstorm operations and manages sync between
UAC-AI investigations and Sheetstorm incidents.
"""
import logging
from flask import Blueprint, request, jsonify, g

from app.models import db, Investigation
from app.services.sheetstorm_service import SheetstormService
from app.routes.auth import require_auth

logger = logging.getLogger(__name__)

sheetstorm_bp = Blueprint("sheetstorm", __name__)
_svc = SheetstormService()


def _require_enabled(f):
    """Decorator to check Sheetstorm is configured."""
    from functools import wraps

    @wraps(f)
    def decorated(*args, **kwargs):
        if not _svc.enabled:
            return jsonify({
                "error": "not_configured",
                "message": "Sheetstorm integration is not configured",
            }), 503
        return f(*args, **kwargs)
    return decorated


# ------------------------------------------------------------------ #
#   Status
# ------------------------------------------------------------------ #

@sheetstorm_bp.route("/status", methods=["GET"])
@require_auth
def status():
    """Check if Sheetstorm integration is enabled and reachable."""
    if not _svc.enabled:
        return jsonify({"enabled": False})

    try:
        _svc.list_incidents(limit=1)
        return jsonify({"enabled": True, "reachable": True})
    except Exception as e:
        return jsonify({"enabled": True, "reachable": False, "error": str(e)})


# ------------------------------------------------------------------ #
#   Incidents
# ------------------------------------------------------------------ #

@sheetstorm_bp.route("/incidents", methods=["GET"])
@require_auth
@_require_enabled
def list_incidents():
    limit = request.args.get("limit", 50, type=int)
    return jsonify({"incidents": _svc.list_incidents(limit=limit)})


@sheetstorm_bp.route("/incidents", methods=["POST"])
@require_auth
@_require_enabled
def create_incident():
    data = request.get_json() or {}
    title = data.get("title")
    if not title:
        return jsonify({"error": "missing_field", "message": "title is required"}), 400

    result = _svc.create_incident(
        title=title,
        description=data.get("description", ""),
        severity=data.get("severity", "medium"),
        classification=data.get("classification", "Incident"),
    )
    return jsonify(result), 201


@sheetstorm_bp.route("/incidents/<incident_id>", methods=["GET"])
@require_auth
@_require_enabled
def get_incident(incident_id: str):
    return jsonify(_svc.get_incident(incident_id))


# ------------------------------------------------------------------ #
#   Sync investigation ↔ Sheetstorm
# ------------------------------------------------------------------ #

@sheetstorm_bp.route("/sync/<int:investigation_id>", methods=["POST"])
@require_auth
@_require_enabled
def sync_investigation(investigation_id: int):
    """Create or update a Sheetstorm incident from a UAC-AI investigation."""
    investigation = db.session.get(Investigation, investigation_id)
    if not investigation:
        return jsonify({"error": "not_found", "message": "Investigation not found"}), 404

    agents = list(investigation.agents)
    incident_id = _svc.sync_investigation(investigation, agents=agents)
    db.session.commit()

    return jsonify({
        "investigation_id": investigation_id,
        "sheetstorm_incident_id": incident_id,
        "synced_hosts": len(agents),
    })


# ------------------------------------------------------------------ #
#   IOCs
# ------------------------------------------------------------------ #

@sheetstorm_bp.route("/incidents/<incident_id>/iocs", methods=["GET"])
@require_auth
@_require_enabled
def list_iocs(incident_id: str):
    return jsonify({"iocs": _svc.list_iocs(incident_id)})


@sheetstorm_bp.route("/incidents/<incident_id>/iocs", methods=["POST"])
@require_auth
@_require_enabled
def add_ioc(incident_id: str):
    data = request.get_json() or {}
    ioc_type = data.get("type")
    value = data.get("value")
    if not ioc_type or not value:
        return jsonify({"error": "missing_field", "message": "type and value are required"}), 400

    result = _svc.add_ioc(incident_id, ioc_type, value, data.get("description", ""))
    return jsonify(result), 201


# ------------------------------------------------------------------ #
#   Hosts
# ------------------------------------------------------------------ #

@sheetstorm_bp.route("/incidents/<incident_id>/hosts", methods=["GET"])
@require_auth
@_require_enabled
def list_hosts(incident_id: str):
    return jsonify({"hosts": _svc.list_hosts(incident_id)})
