"""
Parse endpoints for uploading and parsing UAC archives.
"""
from flask import Blueprint, request, jsonify, current_app, Response
from werkzeug.utils import secure_filename
import uuid
import json
import queue
from gevent.threadpool import ThreadPoolExecutor as _NativeExecutor
from pathlib import Path
from datetime import datetime, date

from app.models import db, Investigation, User
from app.services.parser_service import ParserService

parse_bp = Blueprint("parse", __name__)


class DateTimeEncoder(json.JSONEncoder):
    """Custom JSON encoder that handles datetime objects."""
    def default(self, obj):
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        return super().default(obj)


def json_dumps(obj):
    """JSON dumps with datetime support."""
    return json.dumps(obj, cls=DateTimeEncoder)


def get_parser() -> ParserService:
    """Create parser service with current app config."""
    return ParserService(
        chroma_persist_dir=current_app.config.get("CHROMA_PERSIST_DIR"),
        chunk_size=current_app.config.get("RAG_CHUNK_SIZE", 512),
        chunk_overlap=current_app.config.get("RAG_CHUNK_OVERLAP", 50),
        hot_cache_size=current_app.config.get("RAG_HOT_CACHE_SIZE", 1000)
    )


def get_or_create_default_investigation() -> int:
    """Get or create a default investigation for the default user."""
    # Get or create default user
    user = User.query.filter_by(username="default").first()
    if not user:
        user = User(
            username="default",
            email="default@local",
            password_hash="not-implemented"
        )
        db.session.add(user)
        db.session.commit()
    
    # Get or create default investigation
    investigation = Investigation.query.filter_by(
        user_id=user.id,
        name="Default Investigation"
    ).first()
    
    if not investigation:
        investigation = Investigation(
            name="Default Investigation",
            description="Auto-created default investigation",
            user_id=user.id
        )
        db.session.add(investigation)
        db.session.commit()
    
    return investigation.id


def allowed_file(filename: str) -> bool:
    """Check if file extension is allowed."""
    return (
        "." in filename and
        (filename.rsplit(".", 1)[1].lower() in current_app.config["ALLOWED_EXTENSIONS"] or
         filename.endswith(".tar.gz"))
    )


@parse_bp.route("", methods=["POST"])
def upload_and_parse():
    """
    Upload and parse a UAC archive file.
    
    Accepts: multipart/form-data with 'file' field
    Optional: investigation_id form field (uses default if not provided)
    Returns: Session ID and parsing summary
    """
    if "file" not in request.files:
        return jsonify({
            "error": "no_file",
            "message": "No file provided in request"
        }), 400
    
    file = request.files["file"]
    
    if file.filename == "":
        return jsonify({
            "error": "empty_filename",
            "message": "No file selected"
        }), 400
    
    if not allowed_file(file.filename):
        return jsonify({
            "error": "invalid_format",
            "message": "File must be tar.gz or zip format"
        }), 400
    
    # Get investigation ID from form data or use default
    investigation_id = request.form.get("investigation_id", type=int)
    if not investigation_id:
        investigation_id = get_or_create_default_investigation()
    
    # Verify investigation exists
    investigation = Investigation.query.get(investigation_id)
    if not investigation:
        return jsonify({
            "error": "invalid_investigation",
            "message": "Investigation not found"
        }), 400
    
    # Generate session ID and save file
    session_id = str(uuid.uuid4())
    filename = secure_filename(file.filename)
    upload_dir = current_app.config["UPLOAD_FOLDER"] / session_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    
    file_path = upload_dir / filename
    file.save(file_path)
    
    # Parse the archive and index into tiered storage
    try:
        parser_service = get_parser()
        result = parser_service.parse(file_path, session_id, investigation_id)
        
        return jsonify({
            "session_id": session_id,
            "investigation_id": investigation_id,
            "status": "completed",
            "summary": result["summary"],
            "artifacts_preview": result["preview"],
            "system_info": result.get("system_info", {}),
            "rag_stats": {
                "chunks_created": result["rag_stats"].get("chunks_created", 0),
                "files_processed": result["rag_stats"].get("files_processed", 0),
                "total_tokens": result["rag_stats"].get("total_tokens", 0)
            }
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            "error": "parse_error",
            "message": str(e)
        }), 500


@parse_bp.route("/stream", methods=["POST"])
def upload_and_parse_stream():
    """
    Upload and parse a UAC archive file with SSE streaming progress.
    
    Accepts: multipart/form-data with 'file' field
    Optional: investigation_id form field (uses default if not provided)
    Returns: SSE stream with progress updates and final result
    """
    if "file" not in request.files:
        return jsonify({
            "error": "no_file",
            "message": "No file provided in request"
        }), 400
    
    file = request.files["file"]
    
    if file.filename == "":
        return jsonify({
            "error": "empty_filename",
            "message": "No file selected"
        }), 400
    
    if not allowed_file(file.filename):
        return jsonify({
            "error": "invalid_format",
            "message": "File must be tar.gz or zip format"
        }), 400
    
    # Get investigation ID from form data or use default
    investigation_id = request.form.get("investigation_id", type=int)
    if not investigation_id:
        investigation_id = get_or_create_default_investigation()
    
    # Verify investigation exists
    investigation = Investigation.query.get(investigation_id)
    if not investigation:
        return jsonify({
            "error": "invalid_investigation",
            "message": "Investigation not found"
        }), 400
    
    # Generate session ID and save file
    session_id = str(uuid.uuid4())
    filename = secure_filename(file.filename)
    upload_dir = current_app.config["UPLOAD_FOLDER"] / session_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    
    file_path = upload_dir / filename
    file.save(file_path)
    
    # Create a queue for progress updates
    progress_queue = queue.Queue()
    result_holder = {"result": None, "error": None}
    
    # Capture app reference for use in background thread
    # (current_app is a proxy that doesn't work in other threads)
    app = current_app._get_current_object()
    
    def progress_callback(step: str, progress: int, detail: str):
        """Callback invoked by parser to report progress."""
        progress_queue.put({
            "type": "progress",
            "step": step,
            "progress": progress,
            "detail": detail,
            "session_id": session_id  # Include session_id so frontend can use it early
        })
    
    def parse_worker():
        """Background worker to run parsing."""
        try:
            # Need app context for database operations
            with app.app_context():
                parser_service = get_parser()
                result = parser_service.parse(file_path, session_id, investigation_id, progress_callback)
                result_holder["result"] = {
                    "session_id": session_id,
                    "investigation_id": investigation_id,
                    "status": "completed",
                    "summary": result["summary"],
                    "artifacts_preview": result["preview"],
                    "system_info": result.get("system_info", {}),
                    "rag_stats": {
                        "chunks_created": result["rag_stats"].get("chunks_created", 0),
                        "files_processed": result["rag_stats"].get("files_processed", 0),
                        "total_tokens": result["rag_stats"].get("total_tokens", 0)
                    }
                }
        except Exception as e:
            import traceback
            traceback.print_exc()
            result_holder["error"] = str(e)
        finally:
            # Signal completion
            progress_queue.put(None)
    
    def generate():
        """Generate SSE stream."""
        # Run parsing on a REAL OS thread (not a gevent greenlet) so that
        # CPU-bound work (tokenisation, regex entity extraction) does not
        # starve the gevent event loop and block SSE keepalives / other
        # HTTP requests.
        pool = _NativeExecutor(max_workers=1)
        future = pool.submit(parse_worker)
        
        # Stream progress updates
        while True:
            try:
                item = progress_queue.get(timeout=0.5)
                if item is None:
                    # Parsing complete
                    break
                yield f"data: {json_dumps(item)}\n\n"
            except queue.Empty:
                # Send keepalive
                yield f"data: {json_dumps({'type': 'keepalive'})}\n\n"
        
        # Wait for the native thread to finish
        future.result()
        pool.shutdown(wait=False)
        
        # Send final result or error
        if result_holder["error"]:
            yield f"data: {json_dumps({'type': 'error', 'error': result_holder['error']})}\n\n"
        else:
            yield f"data: {json_dumps({'type': 'complete', 'result': result_holder['result']})}\n\n"
    
    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive"
        }
    )


@parse_bp.route("/<session_id>/status", methods=["GET"])
def get_parse_status(session_id: str):
    """Get the parsing status for a session."""
    parser_service = get_parser()
    status = parser_service.get_status(session_id)
    
    if status is None:
        return jsonify({
            "error": "not_found",
            "message": f"Session {session_id} not found"
        }), 404
    
    return jsonify(status)


@parse_bp.route("/<session_id>/artifacts", methods=["GET"])
def get_artifacts(session_id: str):
    """Get parsed artifacts for a session."""
    parser_service = get_parser()
    artifacts = parser_service.get_artifacts(session_id)
    
    if artifacts is None:
        return jsonify({
            "error": "not_found",
            "message": f"Session {session_id} not found"
        }), 404
    
    return jsonify({
        "session_id": session_id,
        "artifacts": artifacts
    })
