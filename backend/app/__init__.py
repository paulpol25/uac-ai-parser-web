"""
UAC AI Parser - Flask Application Factory

Creates and configures the Flask application instance.
"""
import os
import logging
from flask import Flask, request as flask_request
from flask_cors import CORS
from flask_migrate import Migrate
from sqlalchemy import event, text

from config import config_by_name
from app.models import db

# Configure root logger so all logger.info/warning/error calls actually print
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger(__name__)
migrate = Migrate()


def _set_sqlite_pragma(dbapi_connection, connection_record):
    """Enable WAL mode and other SQLite optimizations for better concurrency."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=30000")  # 30 second timeout
    cursor.close()


def _is_sqlite(app):
    """Check if the configured database is SQLite."""
    return app.config.get("SQLALCHEMY_DATABASE_URI", "").startswith("sqlite")


def _sqlite_migrate(db):
    """Add columns to existing SQLite tables that db.create_all() can't handle."""
    migrations = [
        ("investigations", "sheetstorm_incident_id", "VARCHAR(100)"),
    ]
    with db.engine.connect() as conn:
        for table, column, col_type in migrations:
            cols = [row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))]
            if column not in cols:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))
                conn.commit()


def _cleanup_stuck_sessions():
    """
    Mark any sessions stuck in 'processing' state as 'failed'.
    
    This handles cases where the server restarted during parsing.
    Called on application startup.
    """
    from app.models import Session
    
    stuck_sessions = Session.query.filter_by(status="processing").all()
    if stuck_sessions:
        logger.info(f"[Cleanup] Found {len(stuck_sessions)} stuck session(s) from previous run")
        for session in stuck_sessions:
            session.status = "failed"
            session.error_message = "Processing interrupted - server restarted"
            logger.info(f"  - Marked session {session.session_id} as failed")
        db.session.commit()


def _init_redis(app):
    """Initialize Redis connection if REDIS_URL is configured."""
    redis_url = app.config.get("REDIS_URL", "")
    if redis_url:
        try:
            import redis
            app.redis = redis.from_url(redis_url, decode_responses=True)
            app.redis.ping()
            logger.info(f"[Redis] Connected to {redis_url}")
        except Exception as e:
            logger.warning(f"[Redis] Connection failed: {e} — caching disabled")
            app.redis = None
    else:
        app.redis = None


def _load_integration_settings(app):
    """Load saved integration settings into Flask app config at startup."""
    from pathlib import Path
    import json
    import os as _os
    settings_file = Path(
        _os.environ.get("UAC_SETTINGS_PATH",
                        "/app/data/settings.json" if _os.path.isdir("/app/data") else str(Path.home() / ".uac-ai" / "settings.json"))
    )
    if settings_file.exists():
        try:
            with open(settings_file, "r") as f:
                saved = json.load(f)
            integrations = saved.get("integrations", {})
            mapping = {
                "sheetstorm_url": "SHEETSTORM_API_URL",
                "sheetstorm_api_token": "SHEETSTORM_API_TOKEN",
                "sheetstorm_username": "SHEETSTORM_USERNAME",
                "sheetstorm_password": "SHEETSTORM_PASSWORD",
            }
            for src, dest in mapping.items():
                val = integrations.get(src, "")
                if val:
                    app.config[dest] = val
            if integrations.get("sheetstorm_url"):
                logger.info("[Integrations] Sheetstorm integration loaded from saved settings")
        except Exception as e:
            logger.warning(f"[Integrations] Failed to load settings: {e}")


def create_app(config_name: str | None = None) -> Flask:
    """
    Application factory for creating the Flask app.
    
    Args:
        config_name: Configuration environment name (development, testing, production)
        
    Returns:
        Configured Flask application instance
    """
    if config_name is None:
        config_name = os.environ.get("APP_ENV", "development")
    
    app = Flask(__name__)
    app.config.from_object(config_by_name[config_name])
    
    # Ensure directories exist
    app.config["UPLOAD_FOLDER"].mkdir(parents=True, exist_ok=True)
    if _is_sqlite(app):
        app.config["DATABASE_PATH"].parent.mkdir(parents=True, exist_ok=True)
    app.config["CHROMA_PERSIST_DIR"].mkdir(parents=True, exist_ok=True)
    
    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)
    CORS(app, origins=app.config["CORS_ORIGINS"], supports_credentials=True)
    
    # Database-specific setup
    with app.app_context():
        if _is_sqlite(app):
            # Enable SQLite WAL mode for better concurrency
            event.listen(db.engine, "connect", _set_sqlite_pragma)
            # Auto-create tables for SQLite dev; PostgreSQL uses migrations/init scripts
            db.create_all()
            # Add columns that create_all can't add to existing tables
            _sqlite_migrate(db)
        
        # Cleanup any sessions stuck in "processing" state from previous crashes
        _cleanup_stuck_sessions()
    
    # Load saved integration settings into Flask config
    _load_integration_settings(app)
    
    # Initialize Redis (for caching / MCP session persistence)
    _init_redis(app)
    
    # Log every request so we can see frontend traffic
    @app.after_request
    def log_request(response):
        logger.info("%s %s %s", flask_request.method, flask_request.path, response.status_code)
        return response
    
    # Register blueprints
    from app.routes.health import health_bp
    from app.routes.auth import auth_bp
    from app.routes.parse import parse_bp
    from app.routes.analyze import analyze_bp
    from app.routes.timeline import timeline_bp
    from app.routes.export import export_bp
    from app.routes.config import config_bp
    from app.routes.investigations import investigations_bp
    from app.routes.search import search_bp
    from app.routes.chats import chats_bp
    from app.routes.admin import admin_bp
    from app.routes.agents import agents_bp
    from app.routes.sheetstorm import sheetstorm_bp
    
    app.register_blueprint(health_bp, url_prefix="/api/v1")
    app.register_blueprint(auth_bp, url_prefix="/api/v1/auth")
    app.register_blueprint(parse_bp, url_prefix="/api/v1/parse")
    app.register_blueprint(analyze_bp, url_prefix="/api/v1/analyze")
    app.register_blueprint(timeline_bp, url_prefix="/api/v1/timeline")
    app.register_blueprint(export_bp, url_prefix="/api/v1/export")
    app.register_blueprint(config_bp, url_prefix="/api/v1/config")
    app.register_blueprint(investigations_bp, url_prefix="/api/v1/investigations")
    app.register_blueprint(search_bp, url_prefix="/api/v1/search")
    app.register_blueprint(chats_bp, url_prefix="/api/v1/chats")
    app.register_blueprint(admin_bp, url_prefix="/api/v1/admin")
    app.register_blueprint(agents_bp, url_prefix="/api/v1/agents")
    app.register_blueprint(sheetstorm_bp, url_prefix="/api/v1/sheetstorm")
    
    # Initialize WebSocket support
    from app.websocket import init_socketio
    init_socketio(app)
    
    # Serve static files in production (when built frontend is present)
    static_folder = os.environ.get("STATIC_FOLDER") or os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "static")
    logger.info(f"Looking for static files at: {static_folder}")
    if os.path.exists(static_folder):
        from flask import send_from_directory
        
        @app.route("/", defaults={"path": ""})
        @app.route("/<path:path>")
        def serve_static(path):
            # API routes are handled by blueprints
            if path.startswith("api/"):
                return {"error": "not_found"}, 404
            
            # Try to serve the file directly
            file_path = os.path.join(static_folder, path)
            if path and os.path.exists(file_path) and os.path.isfile(file_path):
                return send_from_directory(static_folder, path)
            
            # Fall back to index.html for SPA routing
            return send_from_directory(static_folder, "index.html")
    
    # Register error handlers
    register_error_handlers(app)
    
    return app


def register_error_handlers(app: Flask) -> None:
    """Register global error handlers."""
    
    @app.errorhandler(400)
    def bad_request(error):
        return {"error": "bad_request", "message": str(error.description)}, 400
    
    @app.errorhandler(404)
    def not_found(error):
        return {"error": "not_found", "message": "Resource not found"}, 404
    
    @app.errorhandler(413)
    def request_entity_too_large(error):
        return {"error": "file_too_large", "message": "File exceeds maximum allowed size (2GB)"}, 413
    
    @app.errorhandler(500)
    def internal_error(error):
        return {"error": "internal_error", "message": "An unexpected error occurred"}, 500
