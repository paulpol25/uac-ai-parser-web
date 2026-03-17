"""
UAC AI Parser - Flask Application Entry Point
"""
from gevent import monkey
monkey.patch_all()

import os
from app import create_app

# Use environment variable for config, default to development
env = os.environ.get("FLASK_ENV", "development")

app = create_app(env)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    debug = os.environ.get("FLASK_DEBUG", "true").lower() == "true"

    print(f" * UAC AI backend running on http://0.0.0.0:{port}")

    # Use SocketIO runner when available (supports WebSocket)
    # Reloader is disabled: it restarts the server when parse writes files,
    # killing in-flight requests. Torch re-import also takes minutes.
    from app.websocket import socketio
    socketio.run(app, host="0.0.0.0", port=port, debug=debug, use_reloader=False, log_output=True)
