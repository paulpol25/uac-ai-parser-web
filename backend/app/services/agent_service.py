"""
Agent Service - Manages remote forensic collection agents.

Handles agent registration, heartbeat tracking, command dispatch,
artifact upload processing, and bootstrap script generation.
"""
import json
import secrets
import uuid
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import gevent
from flask import current_app

from app.models import db, Agent, AgentCommand, AgentEvent, Investigation

logger = logging.getLogger(__name__)

# Heartbeat timeout: agent considered offline after this period
HEARTBEAT_TIMEOUT = timedelta(minutes=5)


class AgentService:
    """Service for managing remote forensic agents."""

    # ------------------------------------------------------------------ #
    #   Agent lifecycle
    # ------------------------------------------------------------------ #

    def register_agent(self, investigation_id: int) -> dict[str, Any]:
        """
        Create a new agent record and return its credentials.

        Returns dict with agent id, api_key, and websocket URL.
        """
        investigation = db.session.get(Investigation, investigation_id)
        if not investigation:
            raise ValueError(f"Investigation {investigation_id} not found")

        agent_id = str(uuid.uuid4())
        api_key = f"uac-agent-{secrets.token_urlsafe(48)}"

        agent = Agent(
            id=agent_id,
            investigation_id=investigation_id,
            api_key=api_key,
            status="registered",
            config={"uac_profile": "ir_triage"},
        )
        db.session.add(agent)

        _log_event(agent_id, "registered", {"investigation_id": investigation_id})

        db.session.commit()

        return {
            "agent": _serialize_agent(agent),
            "agent_id": agent_id,
            "api_key": api_key,
            "investigation_id": investigation_id,
            "ws_url": _ws_url(),
        }

    def get_agent(self, agent_id: str) -> Agent | None:
        return db.session.get(Agent, agent_id)

    def get_agent_by_key(self, api_key: str) -> Agent | None:
        return Agent.query.filter_by(api_key=api_key).first()

    def list_agents(self, investigation_id: int | None = None) -> list[dict]:
        # Sweep stale agents before returning so the UI always sees accurate status
        self.mark_stale_agents()

        query = Agent.query
        if investigation_id is not None:
            query = query.filter_by(investigation_id=investigation_id)
        agents = query.order_by(Agent.registered_at.desc()).all()
        return [_serialize_agent(a) for a in agents]

    def delete_agent(self, agent_id: str) -> bool:
        agent = db.session.get(Agent, agent_id)
        if not agent:
            return False
        db.session.delete(agent)
        db.session.commit()
        return True

    # ------------------------------------------------------------------ #
    #   Checkin / heartbeat
    # ------------------------------------------------------------------ #

    def checkin(self, agent: Agent, system_info: dict | None = None) -> dict[str, Any]:
        """
        Process an agent heartbeat.  Updates status and returns any
        pending commands for the agent.
        """
        now = datetime.utcnow()
        agent.last_heartbeat = now

        if agent.status == "registered":
            agent.status = "idle"
            _log_event(agent.id, "status_change", {"from": "registered", "to": "idle"})
        elif agent.status == "collecting":
            # Check if all collection commands are done
            active = (
                AgentCommand.query
                .filter_by(agent_id=agent.id)
                .filter(AgentCommand.status.in_(["pending", "running"]))
                .count()
            )
            if active == 0:
                agent.status = "idle"
                _log_event(agent.id, "status_change", {"from": "collecting", "to": "idle", "trigger": "checkin_no_active_cmds"})
        elif agent.status == "offline":
            agent.status = "idle"
            _log_event(agent.id, "status_change", {"from": "offline", "to": "idle"})

        if system_info:
            agent.hostname = system_info.get("hostname", agent.hostname)
            agent.os_info = system_info.get("os", agent.os_info)
            agent.ip_address = system_info.get("ip", agent.ip_address)
            agent.agent_version = system_info.get("version", agent.agent_version)

        # Fetch pending commands
        pending = (
            AgentCommand.query
            .filter_by(agent_id=agent.id, status="pending")
            .order_by(AgentCommand.created_at.asc())
            .all()
        )

        commands = []
        for cmd in pending:
            cmd.status = "running"
            commands.append({
                "id": cmd.id,
                "type": cmd.command_type,
                "payload": cmd.payload if isinstance(cmd.payload, dict) else (json.loads(cmd.payload) if cmd.payload else {}),
            })

        db.session.commit()
        return {"commands": commands}

    # ------------------------------------------------------------------ #
    #   Command dispatch
    # ------------------------------------------------------------------ #

    VALID_COMMAND_TYPES = {"run_uac", "exec_command", "collect_file", "run_check", "shutdown"}

    def dispatch_command(
        self,
        agent_id: str,
        command_type: str,
        payload: dict | None = None,
    ) -> dict[str, Any]:
        """Queue a command for an agent."""
        if command_type not in self.VALID_COMMAND_TYPES:
            raise ValueError(f"Invalid command type: {command_type}")

        agent = db.session.get(Agent, agent_id)
        if not agent:
            raise ValueError(f"Agent {agent_id} not found")

        cmd_id = str(uuid.uuid4())
        cmd = AgentCommand(
            id=cmd_id,
            agent_id=agent_id,
            command_type=command_type,
            payload=payload or {},
            status="pending",
        )
        db.session.add(cmd)

        # Set status to 'collecting' for data-collection commands
        if command_type in ("run_uac", "collect_file"):
            prev = agent.status
            agent.status = "collecting"
            _log_event(agent_id, "status_change", {"from": prev, "to": "collecting", "trigger": command_type})

        _log_event(agent_id, "command_dispatched", {
            "command_id": cmd_id,
            "type": command_type,
        })

        db.session.commit()

        return {
            "command_id": cmd_id,
            "agent_id": agent_id,
            "type": command_type,
            "status": "pending",
        }

    def report_command_result(
        self, agent: Agent, command_id: str, status: str, result: dict | None = None
    ) -> bool:
        """Record the result of a command execution from the agent."""
        cmd = db.session.get(AgentCommand, command_id)
        if not cmd or cmd.agent_id != agent.id:
            return False

        cmd.status = status  # "completed" or "failed"
        cmd.result = result or {}
        cmd.completed_at = datetime.utcnow()

        _log_event(agent.id, "command_result", {
            "command_id": command_id,
            "status": status,
        })

        # Handle shutdown → mark agent offline
        if cmd.command_type == "shutdown" and status == "completed":
            prev = agent.status
            agent.status = "offline"
            _log_event(agent.id, "status_change", {"from": prev, "to": "offline", "trigger": "shutdown"})
        else:
            # Reset agent status if no other active (pending/running) commands
            active = (
                AgentCommand.query
                .filter_by(agent_id=agent.id)
                .filter(AgentCommand.status.in_(["pending", "running"]))
                .filter(AgentCommand.id != command_id)
                .count()
            )
            if active == 0 and agent.status == "collecting":
                agent.status = "idle"
                _log_event(agent.id, "status_change", {"from": "collecting", "to": "idle", "trigger": "command_complete"})

        db.session.commit()
        return True

    def get_command(self, command_id: str) -> dict | None:
        cmd = db.session.get(AgentCommand, command_id)
        if not cmd:
            return None
        return _serialize_command(cmd)

    def list_commands(self, agent_id: str, status: str | None = None) -> list[dict]:
        query = AgentCommand.query.filter_by(agent_id=agent_id)
        if status:
            query = query.filter_by(status=status)
        return [_serialize_command(c) for c in query.order_by(AgentCommand.created_at.desc()).all()]

    # ------------------------------------------------------------------ #
    #   Upload handling
    # ------------------------------------------------------------------ #

    def handle_upload(
        self,
        agent: Agent,
        file_storage,
        filename: str,
        command_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Save an uploaded archive from an agent and trigger parsing.
        Links the file to the originating command so users can download it.
        """
        upload_dir = Path(current_app.config.get("UPLOAD_FOLDER", "uploads"))
        agent_dir = upload_dir / "agents" / agent.id
        agent_dir.mkdir(parents=True, exist_ok=True)

        safe_name = Path(filename).name  # strip directory components
        dest = agent_dir / safe_name
        file_storage.save(str(dest))

        file_size = dest.stat().st_size

        _log_event(agent.id, "upload_complete", {
            "filename": safe_name,
            "size": file_size,
            "command_id": command_id,
        })

        # Link uploaded file to the command that triggered it.
        # IMPORTANT: build a NEW dict so SQLAlchemy detects the change on
        # the JSON column — in-place mutation of the same dict object is
        # silently ignored by the ORM's change-tracking.
        if command_id:
            cmd = db.session.get(AgentCommand, command_id)
            if cmd and cmd.agent_id == agent.id:
                prev = cmd.result if isinstance(cmd.result, dict) else (json.loads(cmd.result) if cmd.result else {})
                cmd.result = {
                    **prev,
                    "uploaded_file": safe_name,
                    "uploaded_path": str(dest),
                    "uploaded_size": file_size,
                }

        # Reset status back to connected (upload is done)
        if agent.status == "collecting":
            active = (
                AgentCommand.query
                .filter_by(agent_id=agent.id)
                .filter(AgentCommand.status.in_(["pending", "running"]))
                .count()
            )
            if active == 0:
                agent.status = "idle"
                _log_event(agent.id, "status_change", {"from": "collecting", "to": "idle", "trigger": "upload_complete"})

        db.session.commit()

        # Auto-parse archive uploads in background so the HTTP response
        # is returned immediately.  Only attempt for recognized archives
        # from run_uac commands — collect_file uploads should stay as raw
        # downloadable files and NOT appear as data sources.
        is_archive = any(safe_name.lower().endswith(ext) for ext in (".tar.gz", ".tgz", ".zip"))
        is_uac_output = False
        if command_id:
            cmd_check = db.session.get(AgentCommand, command_id)
            if cmd_check and cmd_check.command_type == "run_uac":
                is_uac_output = True
        if is_archive and is_uac_output:
            app = current_app._get_current_object()
            inv_id = agent.investigation_id
            agent_id = agent.id

            def _bg_parse():
                with app.app_context():
                    self._auto_parse_upload_inner(agent_id, inv_id, dest, safe_name)

            gevent.spawn(_bg_parse)

        return {
            "filename": safe_name,
            "path": str(dest),
            "size": file_size,
            "agent_id": agent.id,
            "investigation_id": agent.investigation_id,
            "command_id": command_id,
        }

    def _auto_parse_upload_inner(self, agent_id: str, investigation_id: int,
                                   filepath: Path, filename: str) -> None:
        """Parse an uploaded archive into the agent's investigation (runs in background greenlet)."""
        try:
            from app.services.parser_service import ParserService
            parser = ParserService(
                chroma_persist_dir=current_app.config.get("CHROMA_PERSIST_DIR"),
                chunk_size=current_app.config.get("RAG_CHUNK_SIZE", 512),
                chunk_overlap=current_app.config.get("RAG_CHUNK_OVERLAP", 50),
                hot_cache_size=current_app.config.get("RAG_HOT_CACHE_SIZE", 1000),
            )
            session_id = str(uuid.uuid4())
            parser.parse(
                file_path=filepath,
                session_id=session_id,
                investigation_id=investigation_id,
            )
            _log_event(agent_id, "auto_parse_complete", {
                "filename": filename,
                "investigation_id": investigation_id,
                "session_id": session_id,
            })
            logger.info("Auto-parsed %s into investigation %d", filename, investigation_id)
        except Exception as e:
            _log_event(agent_id, "auto_parse_failed", {
                "filename": filename,
                "error": str(e),
            })
            logger.warning("Auto-parse failed for %s: %s", filename, e)

    def get_upload_path(self, agent_id: str, filename: str) -> Path | None:
        """Return the filesystem path for a downloaded agent file."""
        upload_dir = Path(current_app.config.get("UPLOAD_FOLDER", "uploads"))
        path = (upload_dir / "agents" / agent_id / Path(filename).name).resolve()
        # Prevent path traversal
        agent_dir = (upload_dir / "agents" / agent_id).resolve()
        if not str(path).startswith(str(agent_dir)):
            return None
        if not path.is_file():
            return None
        return path

    # ------------------------------------------------------------------ #
    #   Bootstrap script generation
    # ------------------------------------------------------------------ #

    def generate_bootstrap_script(
        self,
        agent_id: str,
        api_key: str,
        backend_url: str,
    ) -> str:
        """Return a Bash bootstrap script that downloads and starts the agent."""
        return BOOTSTRAP_TEMPLATE.format(
            backend_url=backend_url,
            agent_id=agent_id,
            api_key=api_key,
        )

    # ------------------------------------------------------------------ #
    #   Housekeeping
    # ------------------------------------------------------------------ #

    def mark_stale_agents(self) -> int:
        """Mark agents that have not sent a heartbeat recently as offline."""
        cutoff = datetime.utcnow() - HEARTBEAT_TIMEOUT
        stale = Agent.query.filter(
            Agent.status.in_(["idle", "collecting"]),
            Agent.last_heartbeat < cutoff,
        ).all()
        for agent in stale:
            prev = agent.status
            agent.status = "offline"
            _log_event(agent.id, "status_change", {"from": prev, "to": "offline", "reason": "heartbeat_timeout"})
        if stale:
            db.session.commit()
        return len(stale)

    def get_events(self, agent_id: str, limit: int = 50) -> list[dict]:
        events = (
            AgentEvent.query
            .filter_by(agent_id=agent_id)
            .order_by(AgentEvent.created_at.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "id": e.id,
                "type": e.event_type,
                "data": e.data if isinstance(e.data, dict) else (json.loads(e.data) if e.data else {}),
                "created_at": e.created_at.isoformat(),
            }
            for e in events
        ]


# ------------------------------------------------------------------ #
#   Helpers
# ------------------------------------------------------------------ #

def _log_event(agent_id: str, event_type: str, data: dict | None = None) -> None:
    db.session.add(AgentEvent(
        agent_id=agent_id,
        event_type=event_type,
        data=data or {},
    ))


def _ws_url() -> str:
    base = current_app.config.get("BASE_URL", "")
    scheme = "wss" if base.startswith("https") else "ws"
    host = base.replace("https://", "").replace("http://", "").rstrip("/")
    return f"{scheme}://{host}/ws/agent"


def _to_iso_utc(dt) -> str | None:
    """Convert a datetime to ISO 8601 UTC string (always ends with Z)."""
    if dt is None:
        return None
    # Strip tzinfo so .isoformat() never includes +00:00
    if dt.tzinfo is not None:
        from datetime import timezone
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.isoformat() + "Z"


def _serialize_agent(agent: Agent) -> dict:
    return {
        "id": agent.id,
        "investigation_id": agent.investigation_id,
        "hostname": agent.hostname,
        "os_info": agent.os_info,
        "ip_address": agent.ip_address,
        "status": agent.status,
        "agent_version": agent.agent_version,
        "last_heartbeat": _to_iso_utc(agent.last_heartbeat),
        "registered_at": _to_iso_utc(agent.registered_at),
        "config": (agent.config if isinstance(agent.config, dict) else json.loads(agent.config)) if agent.config else {},
    }


def _serialize_command(cmd: AgentCommand) -> dict:
    return {
        "id": cmd.id,
        "agent_id": cmd.agent_id,
        "type": cmd.command_type,
        "payload": (cmd.payload if isinstance(cmd.payload, dict) else json.loads(cmd.payload)) if cmd.payload else {},
        "status": cmd.status,
        "result": (cmd.result if isinstance(cmd.result, dict) else json.loads(cmd.result)) if cmd.result else None,
        "created_at": _to_iso_utc(cmd.created_at),
        "started_at": _to_iso_utc(cmd.started_at),
        "completed_at": _to_iso_utc(cmd.completed_at),
    }


# ------------------------------------------------------------------ #
#   Bootstrap template
# ------------------------------------------------------------------ #

BOOTSTRAP_TEMPLATE = r"""#!/usr/bin/env bash
# ============================================================
# UAC-AI Agent Bootstrap Script
# Auto-generated — do not edit.
# ============================================================
set -euo pipefail

BACKEND_URL="{backend_url}"
AGENT_ID="{agent_id}"
API_KEY="{api_key}"

INSTALL_DIR="/opt/uac-ai-agent"
AGENT_BIN="$INSTALL_DIR/uac-agent"

echo "[*] UAC-AI Agent Bootstrap"
echo "    Backend : $BACKEND_URL"
echo "    Agent ID: $AGENT_ID"

# --- Pre-flight checks ------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
    echo "[!] This script must be run as root." >&2
    exit 1
fi

command -v curl >/dev/null 2>&1 || {{ echo "[!] curl is required"; exit 1; }}

# --- Download agent binary --------------------------------------------
mkdir -p "$INSTALL_DIR"

echo "[*] Downloading agent binary..."
ARCH=$(uname -m)
case "$ARCH" in
    x86_64)  BINARY_ARCH="amd64" ;;
    aarch64) BINARY_ARCH="arm64" ;;
    *)       echo "[!] Unsupported architecture: $ARCH"; exit 1 ;;
esac

if ! curl -fsSL "$BACKEND_URL/api/v1/agents/binary/linux-$BINARY_ARCH" -o "$AGENT_BIN" \
     -H "X-Api-Key: $API_KEY" </dev/null; then
    echo "[!] Failed to download agent binary."
    echo "    URL: $BACKEND_URL/api/v1/agents/binary/linux-$BINARY_ARCH"
    echo "    Ensure the binary is built on the server: ./start.sh --rebuild-agent"
    exit 1
fi
chmod +x "$AGENT_BIN"

# --- Write configuration -----------------------------------------------
cat > "$INSTALL_DIR/agent.conf" <<CONF
{{
    "agent_id": "$AGENT_ID",
    "api_key": "$API_KEY",
    "backend_url": "$BACKEND_URL",
    "ws_endpoint": "/ws/agent",
    "heartbeat_interval": 30,
    "uac_profile": "ir_triage"
}}
CONF

# --- Install systemd service -------------------------------------------
cat > /etc/systemd/system/uac-ai-agent.service <<SVC
[Unit]
Description=UAC-AI Forensic Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$AGENT_BIN --config $INSTALL_DIR/agent.conf
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVC

systemctl daemon-reload
systemctl enable --now uac-ai-agent.service

echo "[+] Agent installed and started."
echo "    Logs: journalctl -u uac-ai-agent -f"
"""
