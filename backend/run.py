"""
UAC AI Parser - Flask Application Entry Point
"""
import os
from app import create_app

# Use environment variable for config, default to development
env = os.environ.get("FLASK_ENV", "development")

app = create_app(env)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    debug = os.environ.get("FLASK_DEBUG", "true").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)
