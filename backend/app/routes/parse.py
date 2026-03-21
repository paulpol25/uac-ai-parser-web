"""
Parse endpoints for uploading and parsing UAC archives.
"""
from flask import Blueprint, request, jsonify, current_app, Response
from werkzeug.utils import secure_filename
import uuid
import json
import queue
import threading
from gevent.threadpool import ThreadPoolExecutor as _NativeExecutor
from pathlib import Path
from datetime import datetime, date

from app.models import db, Investigation, Session, User
from app.services.parser_service import ParserService
from app.routes.auth import require_auth, require_permission
import logging

logger = logging.getLogger(__name__)

parse_bp = Blueprint("parse", __name__)

# Track active parse jobs for cancellation: session_id -> threading.Event
_active_parses: dict[str, threading.Event] = {}


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
@require_permission("upload_artifacts")
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
@require_permission("upload_artifacts")
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
    cancel_event = threading.Event()
    _active_parses[session_id] = cancel_event
    
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
                result = parser_service.parse(
                    file_path, session_id, investigation_id,
                    progress_callback, cancel_event,
                )
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
            # Signal completion and clean up cancel tracking
            _active_parses.pop(session_id, None)
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
@require_auth
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
@require_auth
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


@parse_bp.route("/<session_id>/cancel", methods=["POST"])
@require_permission("upload_artifacts")
def cancel_parse(session_id: str):
    """Cancel an in-progress parse job."""
    cancel_event = _active_parses.get(session_id)
    if cancel_event:
        cancel_event.set()
        return jsonify({"status": "cancelling", "session_id": session_id})
    
    # Not actively parsing — just mark session as cancelled in DB
    session = Session.query.filter_by(session_id=session_id).first()
    if not session:
        return jsonify({"error": "not_found", "message": "Session not found"}), 404
    if session.status == "processing":
        session.status = "cancelled"
        db.session.commit()
    return jsonify({"status": session.status, "session_id": session_id})


@parse_bp.route("/<session_id>/embed", methods=["POST"])
@require_permission("upload_artifacts")
def trigger_embed(session_id: str):
    """Trigger background embedding for a session that skipped auto-embed."""
    session = Session.query.filter_by(session_id=session_id).first()
    if not session:
        return jsonify({"error": "not_found", "message": "Session not found"}), 404

    # Only embed sessions that have chunks but no embeddings yet
    if session.status not in ("ready", "searchable"):
        return jsonify({"error": "invalid_state", "message": f"Session is {session.status}, cannot embed"}), 400

    from app.models import Chunk
    chunk_count = Chunk.query.filter_by(session_id=session.id).count()
    if chunk_count == 0:
        return jsonify({"error": "no_chunks", "message": "Session has no chunks to embed"}), 400

    # Check if already has embeddings in ChromaDB
    from app.services.tiered_rag_service import get_tiered_rag_service
    rag = get_tiered_rag_service()
    coll_name = f"session_{session_id.replace('-', '_')}"
    try:
        coll = rag.chroma.get_collection(coll_name)
        if coll.count() > 0:
            return jsonify({"error": "already_embedded", "message": "Session already has embeddings"}), 400
    except Exception:
        pass  # Collection doesn't exist — fine, we'll create it

    # Mark as embedding in progress
    session.status = "searchable"
    db.session.commit()

    # Spawn background embedding thread
    from gevent.threadpool import ThreadPoolExecutor as _NativePool
    from flask import current_app
    app = current_app._get_current_object()
    session_db_id = session.id

    def _bg_embed():
        try:
            with app.app_context():
                bg_session = Session.query.get(session_db_id)
                if not bg_session:
                    return
                chunks = Chunk.query.filter_by(session_id=session_db_id).all()
                if not chunks:
                    return

                from app.services.embedding_service import get_embedding_service
                embedding_service = get_embedding_service()
                total = len(chunks)

                if embedding_service.is_available:
                    logger.info(f"🚀 [Embed] Generating {total} embeddings with GPU for {session_id}...")
                    docs = [c.content for c in chunks]
                    embeddings = embedding_service.embed_documents(docs, batch_size=128, show_progress=False)
                    BATCH = 500
                    for i in range(0, total, BATCH):
                        batch_c = chunks[i:i+BATCH]
                        batch_e = embeddings[i:i+BATCH]
                        batch_d = docs[i:i+BATCH]
                        try:
                            collection = rag.chroma.get_or_create_collection(
                                name=coll_name, metadata={"session_id": session_id}
                            )
                            collection.upsert(
                                ids=[c.chunk_id for c in batch_c],
                                embeddings=batch_e,
                                documents=batch_d,
                                metadatas=[{
                                    "source_file": c.source_file,
                                    "source_type": c.source_type,
                                    "artifact_category": c.artifact_category,
                                    "importance_score": c.importance_score
                                } for c in batch_c]
                            )
                        except Exception:
                            import traceback
                            traceback.print_exc()
                else:
                    logger.warning("⚠️ [Embed] Using ChromaDB default embeddings (slower)")
                    BATCH = 250
                    for i in range(0, total, BATCH):
                        batch = chunks[i:i+BATCH]
                        try:
                            collection = rag.chroma.get_or_create_collection(
                                name=coll_name, metadata={"session_id": session_id}
                            )
                            collection.upsert(
                                ids=[c.chunk_id for c in batch],
                                documents=[c.content for c in batch],
                                metadatas=[{
                                    "source_file": c.source_file,
                                    "source_type": c.source_type,
                                    "artifact_category": c.artifact_category,
                                    "importance_score": c.importance_score
                                } for c in batch]
                            )
                        except Exception:
                            import traceback
                            traceback.print_exc()

                # Build graph
                try:
                    from app.services.graph_rag_service import get_graph_rag_service
                    graph_service = get_graph_rag_service()
                    graph_service.build_relationships_for_session(session_id)
                except Exception:
                    import traceback
                    traceback.print_exc()

                bg_session.status = "ready"
                bg_session.has_embeddings = True
                db.session.commit()
                logger.info(f"✅ [Embed] Session {session_id} embeddings complete")
        except Exception:
            import traceback
            traceback.print_exc()

    pool = _NativePool(max_workers=1)
    pool.submit(_bg_embed)
    return jsonify({"status": "embedding", "session_id": session_id, "chunks": chunk_count})
