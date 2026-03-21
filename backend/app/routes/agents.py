"""
Agent management endpoints.

Two audiences share this blueprint:
  • UI / MCP callers  → Bearer-token auth  (manage agents, dispatch commands)
  • Remote agents     → X-Api-Key auth     (checkin, upload, report)
"""
import hashlib
import hmac
import logging
import re
import time
from functools import wraps
from pathlib import Path

from flask import Blueprint, request, jsonify, g, current_app, send_file

from app.models import db, Playbook
from app.services.agent_service import AgentService
from app.services.auth_providers import get_auth_provider
from app.routes.auth import require_auth, require_permission

logger = logging.getLogger(__name__)

agents_bp = Blueprint("agents", __name__)
_svc = AgentService()


# ------------------------------------------------------------------ #
#   Auth helpers
# ------------------------------------------------------------------ #

def _get_current_user_id() -> int | None:
    """Resolve user from Bearer token (returns None if not authenticated)."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        provider = get_auth_provider()
        user = provider.verify_token(token)
        if user:
            return user.id
    return None


def require_user(f):
    """Require a valid user (Bearer token)."""
    @wraps(f)
    def decorated(*args, **kwargs):
        uid = _get_current_user_id()
        if uid is None:
            return jsonify({"error": "unauthorized", "message": "Valid Bearer token required"}), 401
        g.current_user_id = uid
        return f(*args, **kwargs)
    return decorated


def require_agent(f):
    """Require a valid agent (X-Api-Key header)."""
    @wraps(f)
    def decorated(*args, **kwargs):
        api_key = request.headers.get("X-Api-Key", "")
        if not api_key:
            return jsonify({"error": "unauthorized", "message": "X-Api-Key header required"}), 401
        agent = _svc.get_agent_by_key(api_key)
        if agent is None:
            return jsonify({"error": "unauthorized", "message": "Invalid API key"}), 401
        g.current_agent = agent
        return f(*args, **kwargs)
    return decorated


# ------------------------------------------------------------------ #
#   Bootstrap one-time token helpers (HMAC-SHA256, 15-min window)
# ------------------------------------------------------------------ #

_BOOTSTRAP_WINDOW = 900  # seconds (15 minutes)


def _generate_bootstrap_token(api_key: str) -> str:
    window = str(int(time.time()) // _BOOTSTRAP_WINDOW)
    return hmac.new(api_key.encode(), window.encode(), hashlib.sha256).hexdigest()


def _verify_bootstrap_token(api_key: str, token: str) -> bool:
    """Accept current window and the immediately previous one (grace period)."""
    for offset in (0, -1):
        window = str(int(time.time()) // _BOOTSTRAP_WINDOW + offset)
        expected = hmac.new(api_key.encode(), window.encode(), hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected, token):
            return True
    return False


# ================================================================== #
#   UI / MCP-facing endpoints  (Bearer auth)
# ================================================================== #

@agents_bp.route("", methods=["GET"])
@require_auth
def list_agents():
    """List agents, optionally filtered by investigation."""
    inv_id = request.args.get("investigation_id", type=int)
    return jsonify({"agents": _svc.list_agents(investigation_id=inv_id)})


@agents_bp.route("", methods=["POST"])
@require_permission("manage_agents")
def register_agent():
    """Register a new agent for an investigation."""
    data = request.get_json() or {}
    investigation_id = data.get("investigation_id")
    if not investigation_id:
        return jsonify({"error": "missing_field", "message": "investigation_id is required"}), 400

    try:
        result = _svc.register_agent(investigation_id)
    except ValueError as e:
        return jsonify({"error": "not_found", "message": str(e)}), 404

    return jsonify(result), 201


@agents_bp.route("/<agent_id>", methods=["GET"])
@require_auth
def get_agent(agent_id: str):
    """Get details for a specific agent."""
    agent = _svc.get_agent(agent_id)
    if not agent:
        return jsonify({"error": "not_found", "message": "Agent not found"}), 404

    agents = _svc.list_agents()
    matches = [a for a in agents if a["id"] == agent_id]
    return jsonify(matches[0] if matches else {})


@agents_bp.route("/<agent_id>", methods=["DELETE"])
@require_permission("manage_agents")
def delete_agent(agent_id: str):
    """Delete an agent and all associated data."""
    if not _svc.delete_agent(agent_id):
        return jsonify({"error": "not_found", "message": "Agent not found"}), 404
    return jsonify({"message": "Agent deleted"}), 200


@agents_bp.route("/<agent_id>/commands", methods=["GET"])
@require_auth
def list_commands(agent_id: str):
    """List commands for an agent."""
    status = request.args.get("status")
    return jsonify({"commands": _svc.list_commands(agent_id, status=status)})


@agents_bp.route("/<agent_id>/commands", methods=["POST"])
@require_permission("dispatch_commands")
def dispatch_command(agent_id: str):
    """Dispatch a command to an agent."""
    data = request.get_json() or {}
    command_type = data.get("type")
    if not command_type:
        return jsonify({"error": "missing_field", "message": "command type is required"}), 400

    try:
        result = _svc.dispatch_command(agent_id, command_type, data.get("payload"))
    except ValueError as e:
        return jsonify({"error": "bad_request", "message": str(e)}), 400

    # Push immediately via WebSocket (if agent is connected)
    from app.websocket import push_command_to_agent
    push_command_to_agent(agent_id, result["command_id"], command_type, data.get("payload"))

    return jsonify(result), 201


@agents_bp.route("/<agent_id>/commands/batch", methods=["POST"])
@require_permission("dispatch_commands")
def batch_dispatch(agent_id: str):
    """Dispatch multiple commands to an agent at once."""
    data = request.get_json() or {}
    commands = data.get("commands", [])
    if not commands or not isinstance(commands, list):
        return jsonify({"error": "missing_field", "message": "commands array is required"}), 400
    if len(commands) > 20:
        return jsonify({"error": "bad_request", "message": "Maximum 20 commands per batch"}), 400

    try:
        results = _svc.batch_dispatch(agent_id, commands)
    except ValueError as e:
        return jsonify({"error": "bad_request", "message": str(e)}), 400

    # Push all dispatched commands via WebSocket
    from app.websocket import push_command_to_agent
    for cmd_result, cmd_input in zip(results, commands):
        push_command_to_agent(agent_id, cmd_result["command_id"], cmd_input["type"], cmd_input.get("payload"))

    return jsonify({"commands": results}), 201


@agents_bp.route("/commands/<command_id>/cancel", methods=["POST"])
@require_permission("dispatch_commands")
def cancel_command(command_id: str):
    """Cancel a pending or running command."""
    if not _svc.cancel_command(command_id):
        return jsonify({"error": "not_found", "message": "Command not found or already completed"}), 404
    return jsonify({"message": "Command cancelled"})


@agents_bp.route("/<agent_id>/playbook", methods=["POST"])
@require_permission("run_playbooks")
def run_playbook(agent_id: str):
    """Run a predefined playbook (sequence of forensic commands)."""
    data = request.get_json() or {}
    playbook_name = data.get("playbook")
    if not playbook_name:
        return jsonify({"error": "missing_field", "message": "playbook name is required"}), 400

    try:
        result = _svc.run_playbook(agent_id, playbook_name)
    except ValueError as e:
        return jsonify({"error": "bad_request", "message": str(e)}), 400

    return jsonify(result), 201


@agents_bp.route("/playbooks", methods=["GET"])
@require_auth
def list_playbooks():
    """List available playbooks (built-in + custom) from the database."""
    playbooks = Playbook.query.order_by(Playbook.is_builtin.desc(), Playbook.name).all()
    return jsonify({"playbooks": {p.name: p.to_dict() for p in playbooks}})


@agents_bp.route("/playbooks", methods=["POST"])
@require_permission("manage_playbooks")
def create_playbook():
    """Create a custom playbook."""
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "bad_request", "message": "Playbook name is required"}), 400
    if Playbook.query.filter_by(name=name).first():
        return jsonify({"error": "conflict", "message": "A playbook with that name already exists"}), 409
    commands = data.get("commands", [])
    if not commands or not isinstance(commands, list):
        return jsonify({"error": "bad_request", "message": "commands must be a non-empty list"}), 400
    # Validate each command
    for cmd in commands:
        if not isinstance(cmd, dict) or "type" not in cmd:
            return jsonify({"error": "bad_request", "message": "Each command must have a 'type' field"}), 400
        if cmd["type"] not in _svc.VALID_COMMAND_TYPES:
            return jsonify({"error": "bad_request", "message": f"Invalid command type: {cmd['type']}"}), 400

    pb = Playbook(
        name=name,
        description=data.get("description", ""),
        commands=commands,
        is_builtin=False,
        created_by=g.current_user.id if hasattr(g, "current_user") else None,
    )
    db.session.add(pb)
    db.session.commit()
    return jsonify(pb.to_dict()), 201


@agents_bp.route("/playbooks/<int:playbook_id>", methods=["PUT"])
@require_permission("manage_playbooks")
def update_playbook(playbook_id: int):
    """Update a custom playbook. Built-in playbooks cannot be modified."""
    pb = db.session.get(Playbook, playbook_id)
    if not pb:
        return jsonify({"error": "not_found", "message": "Playbook not found"}), 404
    if pb.is_builtin:
        return jsonify({"error": "forbidden", "message": "Built-in playbooks cannot be modified"}), 403

    data = request.get_json() or {}
    if "name" in data:
        new_name = data["name"].strip()
        existing = Playbook.query.filter_by(name=new_name).first()
        if existing and existing.id != pb.id:
            return jsonify({"error": "conflict", "message": "A playbook with that name already exists"}), 409
        pb.name = new_name
    if "description" in data:
        pb.description = data["description"]
    if "commands" in data:
        commands = data["commands"]
        if not commands or not isinstance(commands, list):
            return jsonify({"error": "bad_request", "message": "commands must be a non-empty list"}), 400
        for cmd in commands:
            if not isinstance(cmd, dict) or "type" not in cmd:
                return jsonify({"error": "bad_request", "message": "Each command must have a 'type' field"}), 400
            if cmd["type"] not in _svc.VALID_COMMAND_TYPES:
                return jsonify({"error": "bad_request", "message": f"Invalid command type: {cmd['type']}"}), 400
        pb.commands = commands

    db.session.commit()
    return jsonify(pb.to_dict())


@agents_bp.route("/playbooks/<int:playbook_id>", methods=["DELETE"])
@require_permission("manage_playbooks")
def delete_playbook(playbook_id: int):
    """Delete a custom playbook. Built-in playbooks cannot be deleted."""
    pb = db.session.get(Playbook, playbook_id)
    if not pb:
        return jsonify({"error": "not_found", "message": "Playbook not found"}), 404
    if pb.is_builtin:
        return jsonify({"error": "forbidden", "message": "Built-in playbooks cannot be deleted"}), 403
    db.session.delete(pb)
    db.session.commit()
    return jsonify({"message": "Playbook deleted"})


@agents_bp.route("/command-types", methods=["GET"])
@require_auth
def list_command_types():
    """List all valid command types available for playbook building."""
    return jsonify({"command_types": sorted(_svc.VALID_COMMAND_TYPES)})


@agents_bp.route("/<agent_id>/events", methods=["GET"])
@require_auth
def list_events(agent_id: str):
    """List audit events for an agent."""
    limit = request.args.get("limit", 50, type=int)
    return jsonify({"events": _svc.get_events(agent_id, limit=limit)})


@agents_bp.route("/<agent_id>/bootstrap-token", methods=["POST"])
@require_permission("manage_agents")
def get_bootstrap_token(agent_id: str):
    """Generate a short-lived one-time token for the bootstrap endpoint (15-min window)."""
    agent = _svc.get_agent(agent_id)
    if not agent:
        return jsonify({"error": "not_found", "message": "Agent not found"}), 404
    token = _generate_bootstrap_token(agent.api_key)
    return jsonify({"token": token, "expires_in": _BOOTSTRAP_WINDOW})


@agents_bp.route("/<agent_id>/bootstrap", methods=["GET"])
def get_bootstrap_script(agent_id: str):
    """Download the bash bootstrap script for an agent.

    Accepts either:
      - Authorization: Bearer <user-token>   (browser / MCP)
      - ?token=<bootstrap-token>             (curl pipe-to-bash, short-lived HMAC)
    """
    uid = _get_current_user_id()
    token_param = request.args.get("token", "")

    agent = _svc.get_agent(agent_id)
    if not agent:
        return jsonify({"error": "not_found", "message": "Agent not found"}), 404

    if uid is None and not (token_param and _verify_bootstrap_token(agent.api_key, token_param)):
        return jsonify({"error": "unauthorized", "message": "Valid Bearer token or bootstrap token required"}), 401

    # Allow caller to override the backend URL the agent will connect to.
    # This is useful when the UI and agent backend are reachable on different
    # addresses (e.g. internal IP vs public hostname).
    custom_backend = request.args.get("backend_url", "").strip()
    if custom_backend:
        if not custom_backend.startswith(("http://", "https://")):
            return jsonify({"error": "invalid_backend_url", "message": "backend_url must start with http:// or https://"}), 400
        backend_url = custom_backend.rstrip("/")
    else:
        # Prefer X-Forwarded-Host (set by nginx) to preserve port,
        # then fall back to request.host_url.
        fwd_host = request.headers.get("X-Forwarded-Host", "").strip()
        fwd_proto = request.headers.get("X-Forwarded-Proto", "http").strip()
        if fwd_host:
            backend_url = f"{fwd_proto}://{fwd_host}".rstrip("/")
        else:
            backend_url = request.host_url.rstrip("/")

    script = _svc.generate_bootstrap_script(agent_id, agent.api_key, backend_url)

    return script, 200, {
        "Content-Type": "text/x-shellscript",
        "Content-Disposition": f"attachment; filename=bootstrap-{agent_id[:8]}.sh",
    }


@agents_bp.route("/commands/<command_id>", methods=["GET"])
@require_auth
def get_command(command_id: str):
    """Get details for a specific command."""
    cmd = _svc.get_command(command_id)
    if not cmd:
        return jsonify({"error": "not_found", "message": "Command not found"}), 404
    return jsonify(cmd)


@agents_bp.route("/<agent_id>/files/<filename>", methods=["GET"])
@require_auth
def download_agent_file(agent_id: str, filename: str):
    """Download a collected file from an agent."""
    path = _svc.get_upload_path(agent_id, filename)
    if not path:
        return jsonify({"error": "not_found", "message": "File not found"}), 404
    return send_file(path, mimetype="application/octet-stream",
                     download_name=path.name)


@agents_bp.route("/binary/<platform>", methods=["GET"])
def download_binary(platform: str):
    """Download a pre-built agent binary.  Auth via X-Api-Key or Bearer."""
    # Allow agents (key) or users (token) to fetch
    api_key = request.headers.get("X-Api-Key", "")
    if not api_key and _get_current_user_id() is None:
        return jsonify({"error": "unauthorized"}), 401

    # Validate platform string to prevent path traversal
    if not re.fullmatch(r"linux-(amd64|arm64)", platform):
        return jsonify({"error": "bad_request", "message": "Invalid platform. Use linux-amd64 or linux-arm64"}), 400

    bin_dir = Path(current_app.config.get("AGENT_BINARIES_DIR", "agent/bin"))
    binary_path = (bin_dir / f"uac-agent-{platform}").resolve()

    # Ensure resolved path is still inside bin_dir (prevent traversal)
    if not str(binary_path).startswith(str(bin_dir.resolve())):
        return jsonify({"error": "bad_request"}), 400

    if not binary_path.is_file():
        return jsonify({"error": "not_found", "message": f"Binary not found: {platform}. Build it first with 'make build' in agent/"}), 404

    return send_file(binary_path, mimetype="application/octet-stream",
                     download_name=f"uac-agent-{platform}")


# ================================================================== #
#   Agent-facing endpoints  (X-Api-Key auth)
# ================================================================== #

@agents_bp.route("/checkin", methods=["POST"])
@require_agent
def agent_checkin():
    """
    Agent heartbeat / checkin.

    Body (optional):
        { "system_info": { "hostname": "...", "os": "...", "ip": "...", "version": "..." } }

    Returns pending commands.
    """
    data = request.get_json(silent=True) or {}
    result = _svc.checkin(g.current_agent, system_info=data.get("system_info"))

    # Notify UI clients via WebSocket
    try:
        from app.websocket import notify_ui_agent_heartbeat
        notify_ui_agent_heartbeat(g.current_agent)
    except Exception:
        pass  # WS notification not critical for checkin

    return jsonify(result)


@agents_bp.route("/upload", methods=["POST"])
@require_agent
def agent_upload():
    """
    Receive an artifact archive from the agent.

    Multipart file upload with field name 'file'.
    Optional form field 'command_id' to link upload to originating command.
    """
    if "file" not in request.files:
        return jsonify({"error": "missing_file", "message": "No file part in request"}), 400

    uploaded = request.files["file"]
    if not uploaded.filename:
        return jsonify({"error": "empty_filename", "message": "Empty filename"}), 400

    command_id = request.form.get("command_id")
    result = _svc.handle_upload(g.current_agent, uploaded, uploaded.filename, command_id=command_id)
    return jsonify(result), 201


@agents_bp.route("/report", methods=["POST"])
@require_agent
def agent_report():
    """
    Agent reports the result of a command.

    Body:
        { "command_id": "...", "status": "completed|failed", "result": { ... } }
    """
    data = request.get_json() or {}
    command_id = data.get("command_id")
    status = data.get("status")
    if not command_id or status not in ("completed", "failed"):
        return jsonify({"error": "bad_request", "message": "command_id and status (completed|failed) required"}), 400

    ok = _svc.report_command_result(g.current_agent, command_id, status, data.get("result"))
    if not ok:
        return jsonify({"error": "not_found", "message": "Command not found or not owned by this agent"}), 404

    return jsonify({"message": "Result recorded"})
