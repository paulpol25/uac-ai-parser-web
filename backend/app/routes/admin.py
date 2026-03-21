"""
Admin routes for cleanup, storage management, and system administration.
"""
from flask import Blueprint, request, jsonify

from app.routes.auth import require_role

admin_bp = Blueprint("admin", __name__)


@admin_bp.route("/storage", methods=["GET"])
@require_role("admin")
def storage_report():
    """Get disk usage report."""
    from app.services.cleanup_service import CleanupService
    svc = CleanupService()
    return jsonify(svc.get_storage_report())


@admin_bp.route("/cleanup/run", methods=["POST"])
@require_role("admin")
def run_cleanup():
    """Force an immediate cleanup cycle."""
    from app.services.cleanup_service import CleanupService
    svc = CleanupService()
    results = svc.run_cleanup_cycle()
    return jsonify(results)


@admin_bp.route("/cleanup/sessions", methods=["POST"])
@require_role("admin")
def cleanup_sessions():
    """
    Delete specific sessions and all associated data.

    Body: {"session_ids": [<int>, ...]}
    """
    from app.services.cleanup_service import CleanupService

    data = request.get_json()
    session_ids = data.get("session_ids", []) if data else []
    if not session_ids:
        return jsonify({"error": "missing_session_ids"}), 400

    svc = CleanupService()
    results = []
    for sid in session_ids:
        results.append(svc.delete_session_data(int(sid)))
    return jsonify({"results": results})


@admin_bp.route("/cleanup/investigation/<int:investigation_id>", methods=["POST"])
@require_role("admin")
def cleanup_investigation(investigation_id: int):
    """Delete an investigation and all its sessions + data."""
    from app.services.cleanup_service import CleanupService
    svc = CleanupService()
    return jsonify(svc.delete_investigation_data(investigation_id))
