"""
UAC AI Parser - Flask Application Entry Point
"""
from gevent import monkey
monkey.patch_all()

import os
from app import create_app
from app.websocket import init_websocket

# Use environment variable for config, default to development
env = os.environ.get("FLASK_ENV", "development")

_flask_app = create_app(env)

# Wrap Flask with raw-WebSocket middleware.
# Gunicorn loads `run:app` — this ensures WebSocket routing works in production.
app = init_websocket(_flask_app)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    debug = os.environ.get("FLASK_DEBUG", "true").lower() == "true"

    print(f" * UAC AI backend running on http://0.0.0.0:{port}")

    from gevent.pywsgi import WSGIServer
    from geventwebsocket.handler import WebSocketHandler

    server = WSGIServer(("0.0.0.0", port), app, handler_class=WebSocketHandler, log=None)
    server.serve_forever()
