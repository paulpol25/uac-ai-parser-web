"""
Raw WebSocket support for real-time agent and UI communication.

Uses gevent-websocket for native WebSocket handling — no Socket.IO
protocol overhead.  The Go agent and browser both speak the same raw
WebSocket + JSON envelope format.

Endpoints:
  /ws/agent  — agents connect here (X-Api-Key auth via header or query param)
  /ws/ui     — browser UI connects here (Bearer token via query param)

Agent registry keeps track of connected agents for instant command push.
UI registry keeps track of browser clients to broadcast status updates.
"""
import json
import logging
import threading
from datetime import datetime

from app.models import db, Agent
from app.services.agent_service import AgentService

logger = logging.getLogger(__name__)

_svc = AgentService()


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Connection registries
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class _AgentRegistry:
    """Thread-safe map of agent_id → WebSocket for connected agents."""

    def __init__(self):
        self._lock = threading.Lock()
        self._agents: dict[str, object] = {}          # agent_id → ws
        self._inv_map: dict[str, str] = {}             # agent_id → investigation_id

    def add(self, agent_id: str, ws, investigation_id: str):
        with self._lock:
            self._agents[agent_id] = ws
            self._inv_map[agent_id] = investigation_id

    def remove(self, agent_id: str):
        with self._lock:
            self._agents.pop(agent_id, None)
            self._inv_map.pop(agent_id, None)

    def get(self, agent_id: str):
        with self._lock:
            return self._agents.get(agent_id)

    def get_investigation_id(self, agent_id: str):
        with self._lock:
            return self._inv_map.get(agent_id)

    def send_to_agent(self, agent_id: str, message: dict) -> bool:
        ws = self.get(agent_id)
        if ws is None:
            return False
        try:
            ws.send(json.dumps(message))
            return True
        except Exception:
            self.remove(agent_id)
            return False


class _UIRegistry:
    """Thread-safe set of UI WebSocket connections, grouped by investigation."""

    def __init__(self):
        self._lock = threading.Lock()
        self._clients: dict[str, set] = {}   # investigation_id → set of ws ids
        self._all: dict[int, object] = {}     # ws_id → ws

    def add(self, ws):
        ws_id = id(ws)
        with self._lock:
            self._all[ws_id] = ws

    def subscribe(self, ws, investigation_id: str):
        with self._lock:
            inv_set = self._clients.setdefault(investigation_id, set())
            inv_set.add(id(ws))

    def remove(self, ws):
        ws_id = id(ws)
        with self._lock:
            self._all.pop(ws_id, None)
            for inv_set in self._clients.values():
                inv_set.discard(ws_id)

    def broadcast_to_investigation(self, investigation_id: str, message: dict):
        """Send a message to all UI clients watching an investigation."""
        with self._lock:
            ws_ids = self._clients.get(investigation_id, set()).copy()
            sockets = [(wid, self._all.get(wid)) for wid in ws_ids]

        payload = json.dumps(message)
        dead = []
        for ws_id, ws in sockets:
            if ws is None:
                dead.append(ws_id)
                continue
            try:
                ws.send(payload)
            except Exception:
                dead.append(ws_id)

        if dead:
            with self._lock:
                for ws_id in dead:
                    self._all.pop(ws_id, None)
                    for inv_set in self._clients.values():
                        inv_set.discard(ws_id)


agent_registry = _AgentRegistry()
ui_registry = _UIRegistry()


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Public API — called from REST routes to push via WS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def push_command_to_agent(agent_id: str, command_id: str, command_type: str, payload: dict | None = None):
    """Push a command to a connected agent immediately (called from REST dispatch)."""
    message = {
        "type": "commands",
        "commands": [{
            "id": command_id,
            "type": command_type,
            "payload": payload or {},
        }],
    }
    sent = agent_registry.send_to_agent(agent_id, message)
    if sent:
        logger.debug("Pushed command %s to agent %s via WS", command_id[:8], agent_id[:8])
    return sent


def notify_ui_command_update(agent_id: str, command_id: str, status: str, result: dict | None = None):
    """Notify UI watchers that a command status changed."""
    inv_id = agent_registry.get_investigation_id(agent_id)
    if inv_id is None:
        return
    ui_registry.broadcast_to_investigation(inv_id, {
        "type": "command_update",
        "agent_id": agent_id,
        "command_id": command_id,
        "status": status,
        "result": result,
    })


def notify_ui_agent_heartbeat(agent):
    """Broadcast agent heartbeat info to UI watchers."""
    ui_registry.broadcast_to_investigation(str(agent.investigation_id), {
        "type": "agent_heartbeat",
        "agent_id": agent.id,
        "hostname": agent.hostname,
        "status": agent.status,
        "ip_address": agent.ip_address,
    })


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  WebSocket request handlers
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _parse_qs_param(environ, key):
    """Extract a query-string parameter from WSGI environ."""
    qs = environ.get("QUERY_STRING", "")
    for part in qs.split("&"):
        if part.startswith(f"{key}="):
            return part[len(key) + 1:]
    return ""


def _handle_agent_ws(ws, app):
    """Handle a single agent WebSocket connection (runs in its own greenlet)."""
    agent_id = None
    api_key = ws.environ.get("HTTP_X_API_KEY", "") or _parse_qs_param(ws.environ, "api_key")

    if not api_key:
        ws.send(json.dumps({"type": "error", "message": "missing api_key"}))
        return

    with app.app_context():
        agent = _svc.get_agent_by_key(api_key)
        if agent is None:
            ws.send(json.dumps({"type": "error", "message": "invalid api_key"}))
            return

        agent_id = agent.id
        inv_id = str(agent.investigation_id)

        agent.status = "idle"
        agent.last_heartbeat = datetime.utcnow()
        db.session.commit()

        agent_registry.add(agent_id, ws, inv_id)
        logger.info("Agent %s connected via WS", agent_id[:8])

        ws.send(json.dumps({"type": "welcome", "agent_id": agent_id, "status": "idle"}))

        # Push any pending commands immediately on connect
        result = _svc.checkin(agent, system_info=None)
        if result.get("commands"):
            ws.send(json.dumps({"type": "commands", "commands": result["commands"]}))

    try:
        while not ws.closed:
            raw = ws.receive()
            if raw is None:
                break

            try:
                msg = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                continue

            msg_type = msg.get("type", "")

            with app.app_context():
                agent = db.session.get(Agent, agent_id)
                if not agent:
                    break

                if msg_type == "auth":
                    system_info = msg.get("system_info")
                    if system_info:
                        _svc.checkin(agent, system_info=system_info)
                    ws.send(json.dumps({"type": "auth_ok", "agent_id": agent_id}))

                elif msg_type == "heartbeat":
                    result = _svc.checkin(agent, system_info=msg.get("system_info"))
                    ws.send(json.dumps({"type": "heartbeat_ack"}))
                    if result.get("commands"):
                        ws.send(json.dumps({"type": "commands", "commands": result["commands"]}))
                    notify_ui_agent_heartbeat(agent)

                elif msg_type == "result":
                    command_id = msg.get("command_id")
                    status = msg.get("status")
                    result_data = msg.get("result")
                    encrypted = msg.get("encrypted_result")

                    if encrypted and not result_data:
                        result_data = {"encrypted": True, "envelope": encrypted}

                    if command_id and status in ("completed", "failed"):
                        _svc.report_command_result(agent, command_id, status, result_data)
                        notify_ui_command_update(agent_id, command_id, status, result_data)

                elif msg_type == "upload_ready":
                    ui_registry.broadcast_to_investigation(inv_id, {
                        "type": "upload_notification",
                        "agent_id": agent_id,
                        "filename": msg.get("filename"),
                        "size": msg.get("size"),
                    })

    except Exception as e:
        if "closed" not in str(e).lower():
            logger.error("Agent WS error (%s): %s", agent_id[:8] if agent_id else "?", e)
    finally:
        agent_registry.remove(agent_id)
        with app.app_context():
            agent = db.session.get(Agent, agent_id)
            if agent and agent.status != "offline":
                agent.status = "offline"
                db.session.commit()
        logger.info("Agent %s disconnected", agent_id[:8] if agent_id else "?")


def _handle_ui_ws(ws, app):
    """Handle a single UI WebSocket connection for real-time updates."""
    from app.services.auth_providers import get_auth_provider

    token = _parse_qs_param(ws.environ, "token")

    if not token:
        ws.send(json.dumps({"type": "error", "message": "missing token"}))
        return

    with app.app_context():
        provider = get_auth_provider()
        user = provider.verify_token(token)
        if not user:
            ws.send(json.dumps({"type": "error", "message": "invalid token"}))
            return

    ui_registry.add(ws)
    ws.send(json.dumps({"type": "welcome", "role": "ui"}))
    logger.debug("UI client connected via WS")

    try:
        while not ws.closed:
            raw = ws.receive()
            if raw is None:
                break

            try:
                msg = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                continue

            msg_type = msg.get("type", "")

            if msg_type == "subscribe":
                inv_id = msg.get("investigation_id")
                if inv_id:
                    ui_registry.subscribe(ws, str(inv_id))
                    ws.send(json.dumps({"type": "subscribed", "investigation_id": inv_id}))

    except Exception as e:
        if "closed" not in str(e).lower():
            logger.debug("UI WS error: %s", e)
    finally:
        ui_registry.remove(ws)
        logger.debug("UI client disconnected")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  WSGI middleware — intercepts /ws/ for WebSocket upgrade
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class WebSocketMiddleware:
    """
    WSGI middleware that intercepts WebSocket upgrade requests on
    /ws/agent and /ws/ui, handing them to raw WS handlers.
    All other requests pass through to Flask normally.
    """

    def __init__(self, flask_app):
        self.flask_app = flask_app

    def __call__(self, environ, start_response):
        path = environ.get("PATH_INFO", "")
        ws = environ.get("wsgi.websocket")

        if ws and path.rstrip("/") == "/ws/agent":
            _handle_agent_ws(ws, self.flask_app)
            return []

        if ws and path.rstrip("/") == "/ws/ui":
            _handle_ui_ws(ws, self.flask_app)
            return []

        return self.flask_app(environ, start_response)


def init_websocket(app):
    """Wrap the Flask app with WebSocket middleware. Returns the wrapped WSGI app."""
    logger.info("Raw WebSocket support initialized on /ws/agent and /ws/ui")
    return WebSocketMiddleware(app)
