"""
YARA rules management endpoints.

Provides CRUD for managed YARA rules, GitHub sync from Elastic's
protections-artifacts repo, and a combined-rules download endpoint
that agents use before running scans.
"""
import logging
from functools import wraps

from flask import Blueprint, request, jsonify, g, Response

from app.models import db
from app.services.yara_rule_service import YaraRuleService
from app.services.auth_providers import get_auth_provider
from app.routes.auth import require_auth, require_permission

logger = logging.getLogger(__name__)

yara_bp = Blueprint("yara", __name__)
_svc = YaraRuleService()


# ------------------------------------------------------------------ #
#   Auth helpers (same pattern as agents.py)
# ------------------------------------------------------------------ #

def _get_current_user_id() -> int | None:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        provider = get_auth_provider()
        user = provider.verify_token(token)
        if user:
            return user.id
    return None


def require_user(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        uid = _get_current_user_id()
        if uid is None:
            return jsonify({"error": "unauthorized", "message": "Valid Bearer token required"}), 401
        g.current_user_id = uid
        return f(*args, **kwargs)
    return decorated


def _require_agent_key(f):
    """Allow agents to download combined rules using their API key."""
    @wraps(f)
    def decorated(*args, **kwargs):
        api_key = request.headers.get("X-Api-Key", "")
        if not api_key:
            return jsonify({"error": "unauthorized"}), 401
        from app.services.agent_service import AgentService
        agent = AgentService().get_agent_by_key(api_key)
        if agent is None:
            return jsonify({"error": "unauthorized"}), 401
        g.current_agent = agent
        return f(*args, **kwargs)
    return decorated


# ================================================================== #
#   UI-facing endpoints (Bearer auth)
# ================================================================== #

@yara_bp.route("", methods=["GET"])
@require_auth
def list_rules():
    """List all YARA rules. ?source=upload|elastic_github  ?enabled=true"""
    source = request.args.get("source")
    enabled_only = request.args.get("enabled", "").lower() == "true"
    rules = _svc.list_rules(source=source, enabled_only=enabled_only)
    return jsonify(rules)


@yara_bp.route("/<int:rule_id>", methods=["GET"])
@require_auth
def get_rule(rule_id: int):
    """Get a single rule (metadata only)."""
    rule = _svc.get_rule(rule_id)
    if not rule:
        return jsonify({"error": "not_found"}), 404
    return jsonify(rule.to_dict())


@yara_bp.route("/<int:rule_id>/content", methods=["GET"])
@require_auth
def get_rule_content(rule_id: int):
    """Download the raw .yar content."""
    rule = _svc.get_rule(rule_id)
    if not rule:
        return jsonify({"error": "not_found"}), 404
    return Response(rule.content, mimetype="text/plain",
                    headers={"Content-Disposition": f"attachment; filename={rule.filename}"})


@yara_bp.route("/upload", methods=["POST"])
@require_permission("manage_yara_rules")
def upload_rule():
    """Upload a YARA rule file (multipart 'file' field or JSON body)."""
    # Multipart upload
    if "file" in request.files:
        f = request.files["file"]
        if not f.filename:
            return jsonify({"error": "missing_filename"}), 400
        content = f.read().decode("utf-8", errors="replace")
        description = request.form.get("description", "")
        try:
            result = _svc.upload_rule(f.filename, content, description)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        return jsonify(result), 201

    # JSON body upload
    data = request.get_json(silent=True) or {}
    filename = data.get("filename", "")
    content = data.get("content", "")
    if not filename or not content:
        return jsonify({"error": "Provide a 'file' upload or JSON with 'filename' and 'content'"}), 400
    try:
        result = _svc.upload_rule(filename, content, data.get("description", ""))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(result), 201


@yara_bp.route("/<int:rule_id>", methods=["DELETE"])
@require_permission("manage_yara_rules")
def delete_rule(rule_id: int):
    """Delete a YARA rule."""
    if not _svc.delete_rule(rule_id):
        return jsonify({"error": "not_found"}), 404
    return jsonify({"status": "deleted"}), 200


@yara_bp.route("/<int:rule_id>/toggle", methods=["PATCH"])
@require_permission("manage_yara_rules")
def toggle_rule(rule_id: int):
    """Enable or disable a rule. Body: {"enabled": true/false}"""
    data = request.get_json(silent=True) or {}
    enabled = data.get("enabled")
    if enabled is None:
        return jsonify({"error": "missing 'enabled' field"}), 400
    result = _svc.toggle_rule(rule_id, bool(enabled))
    if result is None:
        return jsonify({"error": "not_found"}), 404
    return jsonify(result)


@yara_bp.route("/batch-toggle", methods=["PATCH"])
@require_permission("manage_yara_rules")
def batch_toggle():
    """Enable or disable all rules (or a filtered subset). Body: {"enabled": true/false, "source"?: string}"""
    data = request.get_json(silent=True) or {}
    enabled = data.get("enabled")
    if enabled is None:
        return jsonify({"error": "missing 'enabled' field"}), 400
    source = data.get("source")
    count = _svc.batch_toggle(bool(enabled), source=source)
    return jsonify({"updated": count, "enabled": bool(enabled)})


@yara_bp.route("/sync-github", methods=["POST"])
@require_permission("manage_yara_rules")
def sync_github():
    """Sync Linux YARA rules from Elastic's protections-artifacts repo."""
    try:
        result = _svc.sync_elastic_github()
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 502
    return jsonify(result)


# ================================================================== #
#   Agent-facing endpoint (X-Api-Key auth)
# ================================================================== #

@yara_bp.route("/combined", methods=["GET"])
def download_combined():
    """
    Download all enabled rules as a single .yar file.
    Accepts either Bearer token (UI) or X-Api-Key (agent).
    """
    # Try bearer first
    uid = _get_current_user_id()
    if uid is None:
        # Try agent key
        api_key = request.headers.get("X-Api-Key", "")
        if not api_key:
            return jsonify({"error": "unauthorized"}), 401
        from app.services.agent_service import AgentService
        agent = AgentService().get_agent_by_key(api_key)
        if agent is None:
            return jsonify({"error": "unauthorized"}), 401

    combined = _svc.get_combined_rules()
    return Response(combined, mimetype="text/plain",
                    headers={"Content-Disposition": "attachment; filename=combined_rules.yar"})
