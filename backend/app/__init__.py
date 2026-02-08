"""
UAC AI Parser - Flask Application Factory

Creates and configures the Flask application instance.
"""
import os
import logging
from flask import Flask
from flask_cors import CORS
from sqlalchemy import event

from config import config_by_name
from app.models import db

logger = logging.getLogger(__name__)


def _set_sqlite_pragma(dbapi_connection, connection_record):
    """Enable WAL mode and other SQLite optimizations for better concurrency."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=30000")  # 30 second timeout
    cursor.close()


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
    app.config["DATABASE_PATH"].parent.mkdir(parents=True, exist_ok=True)
    app.config["CHROMA_PERSIST_DIR"].mkdir(parents=True, exist_ok=True)
    
    # Initialize extensions
    db.init_app(app)
    CORS(app, origins=app.config["CORS_ORIGINS"], supports_credentials=True)
    
    # Enable SQLite WAL mode for better concurrency
    with app.app_context():
        event.listen(db.engine, "connect", _set_sqlite_pragma)
    
    # Create database tables
    with app.app_context():
        db.create_all()
        
        # Cleanup any sessions stuck in "processing" state from previous crashes
        _cleanup_stuck_sessions()
    
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
    
    # Serve static files in production (when built frontend is present)
    static_folder = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "static")
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
