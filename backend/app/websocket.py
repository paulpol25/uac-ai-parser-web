"""
WebSocket support for real-time agent communication.

Uses Flask-SocketIO with the /ws/agent namespace.
Agents authenticate on connect via X-Api-Key query parameter.
UI clients authenticate via Bearer token query parameter.
"""
import json
import logging
from datetime import datetime

from flask import request
from flask_socketio import SocketIO, Namespace, emit, disconnect, join_room, leave_room

from app.models import db, Agent, AgentCommand
from app.services.agent_service import AgentService
from app.services.auth_providers import get_auth_provider

logger = logging.getLogger(__name__)

socketio = SocketIO()
_svc = AgentService()


class AgentNamespace(Namespace):
    """
    /ws/agent namespace.

    Rooms:
      • agent:<agent_id>  — the individual agent lives here
      • inv:<inv_id>      — all agents + UI watchers for an investigation
    """

    def on_connect(self):
        api_key = request.args.get("api_key", "")
        token = request.args.get("token", "")

        if api_key:
            agent = _svc.get_agent_by_key(api_key)
            if agent is None:
                logger.warning("WS connect rejected: invalid api_key")
                disconnect()
                return False
            request.sid_agent_id = agent.id
            request.sid_role = "agent"
            join_room(f"agent:{agent.id}")
            join_room(f"inv:{agent.investigation_id}")

            agent.status = "idle"
            agent.last_heartbeat = datetime.utcnow()
            db.session.commit()

            logger.info("Agent %s connected via WS", agent.id[:8])
            emit("welcome", {"agent_id": agent.id, "status": "idle"})

        elif token:
            provider = get_auth_provider()
            user = provider.verify_token(token)
            if not user:
                logger.warning("WS connect rejected: invalid Bearer token")
                disconnect()
                return False
            request.sid_role = "ui"
            # UI can join specific investigation rooms via 'subscribe' event
            emit("welcome", {"role": "ui"})

        else:
            disconnect()
            return False

    def on_disconnect(self):
        role = getattr(request, "sid_role", None)
        if role == "agent":
            agent_id = getattr(request, "sid_agent_id", None)
            if agent_id:
                agent = db.session.get(Agent, agent_id)
                if agent:
                    agent.status = "offline"
                    db.session.commit()
                logger.info("Agent %s disconnected", agent_id[:8])

    # -- Agent events ------------------------------------------------- #

    def on_heartbeat(self, data):
        """Agent sends periodic heartbeat with optional system info."""
        agent_id = getattr(request, "sid_agent_id", None)
        if not agent_id:
            return
        agent = db.session.get(Agent, agent_id)
        if not agent:
            return

        result = _svc.checkin(agent, system_info=data.get("system_info"))

        # Push pending commands to agent immediately
        if result.get("commands"):
            emit("commands", {"commands": result["commands"]})

        # Notify UI watchers in the investigation room
        emit("agent_heartbeat", {
            "agent_id": agent_id,
            "hostname": agent.hostname,
            "status": agent.status,
        }, room=f"inv:{agent.investigation_id}", include_self=False)

    def on_command_result(self, data):
        """Agent reports command completion."""
        agent_id = getattr(request, "sid_agent_id", None)
        if not agent_id:
            return
        agent = db.session.get(Agent, agent_id)
        if not agent:
            return

        command_id = data.get("command_id")
        status = data.get("status")
        result = data.get("result")

        if command_id and status in ("completed", "failed"):
            _svc.report_command_result(agent, command_id, status, result)

            # Relay to UI watchers
            emit("command_update", {
                "agent_id": agent_id,
                "command_id": command_id,
                "status": status,
                "result": result,
            }, room=f"inv:{agent.investigation_id}", include_self=False)

    def on_upload_ready(self, data):
        """Agent signals that an artifact archive is ready (metadata only)."""
        agent_id = getattr(request, "sid_agent_id", None)
        if not agent_id:
            return

        emit("upload_notification", {
            "agent_id": agent_id,
            "filename": data.get("filename"),
            "size": data.get("size"),
        }, room=f"inv:{_get_inv_id(agent_id)}", include_self=False)

    # -- UI events ---------------------------------------------------- #

    def on_subscribe(self, data):
        """UI client subscribes to an investigation room."""
        if getattr(request, "sid_role", None) != "ui":
            return
        inv_id = data.get("investigation_id")
        if inv_id:
            join_room(f"inv:{inv_id}")
            emit("subscribed", {"investigation_id": inv_id})

    def on_unsubscribe(self, data):
        """UI client leaves an investigation room."""
        inv_id = data.get("investigation_id")
        if inv_id:
            leave_room(f"inv:{inv_id}")

    def on_dispatch_command(self, data):
        """UI dispatches a command to an agent via WS (alternative to REST)."""
        if getattr(request, "sid_role", None) != "ui":
            return

        agent_id = data.get("agent_id")
        command_type = data.get("type")
        payload = data.get("payload")

        try:
            result = _svc.dispatch_command(agent_id, command_type, payload)
        except ValueError as e:
            emit("error", {"message": str(e)})
            return

        # Push the command to the agent immediately
        emit("commands", {"commands": [{
            "id": result["command_id"],
            "type": command_type,
            "payload": payload or {},
        }]}, room=f"agent:{agent_id}")

        emit("command_dispatched", result)


def _get_inv_id(agent_id: str) -> int | None:
    agent = db.session.get(Agent, agent_id)
    return agent.investigation_id if agent else None


def init_socketio(app):
    """Initialize SocketIO on the Flask app."""
    socketio.init_app(
        app,
        cors_allowed_origins="*",
        async_mode="gevent",
        message_queue=app.config.get("REDIS_URL"),
        path="/ws",
    )
    socketio.on_namespace(AgentNamespace("/ws/agent"))
    logger.info("Flask-SocketIO initialized on /ws/agent")
