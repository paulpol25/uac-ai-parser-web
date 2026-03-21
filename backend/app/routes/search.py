"""
Search endpoints for manual log searching.
"""
from flask import Blueprint, request, jsonify
from sqlalchemy import or_

from app.models import db, Chunk, Session
from app.routes.auth import require_auth

search_bp = Blueprint("search", __name__)


@search_bp.route("", methods=["GET"])
@require_auth
def search_logs():
    """
    Search through parsed log chunks.
    
    Query params:
        session_id: Required session identifier
        q: Search query (text to search for)
        source_type: Optional filter by source type
        artifact_category: Optional filter by artifact category
        page: Page number (default 1)
        per_page: Results per page (default 50, max 200)
    """
    session_id = request.args.get("session_id")
    
    if not session_id:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id query parameter is required"
        }), 400
    
    # Get session
    session = Session.query.filter_by(session_id=session_id).first()
    if not session:
        return jsonify({
            "error": "session_not_found",
            "message": f"Session {session_id} not found"
        }), 404
    
    # Search parameters
    query_text = request.args.get("q", "").strip()
    source_type = request.args.get("source_type")
    artifact_category = request.args.get("artifact_category")
    page = max(1, int(request.args.get("page", 1)))
    per_page = min(200, max(1, int(request.args.get("per_page", 50))))
    
    # Build query
    chunks_query = Chunk.query.filter(Chunk.session_id == session.id)
    
    # Text search if provided
    if query_text:
        # Case-insensitive search in content
        chunks_query = chunks_query.filter(
            Chunk.content.ilike(f"%{query_text}%")
        )
    
    # Filter by source type
    if source_type:
        chunks_query = chunks_query.filter(Chunk.source_type == source_type)
    
    # Filter by artifact category
    if artifact_category:
        chunks_query = chunks_query.filter(Chunk.artifact_category == artifact_category)
    
    # Order by importance and source file
    chunks_query = chunks_query.order_by(
        Chunk.importance_score.desc(),
        Chunk.source_file,
        Chunk.id
    )
    
    # Paginate
    pagination = chunks_query.paginate(page=page, per_page=per_page, error_out=False)
    
    # Format results
    results = []
    for chunk in pagination.items:
        results.append({
            "chunk_id": chunk.chunk_id,
            "content": chunk.content,
            "source_file": chunk.source_file,
            "source_type": chunk.source_type,
            "artifact_category": chunk.artifact_category,
            "section": chunk.section,
            "importance_score": chunk.importance_score,
            "file_modified": chunk.file_modified.isoformat() if chunk.file_modified else None,
        })
    
    return jsonify({
        "results": results,
        "total": pagination.total,
        "page": page,
        "per_page": per_page,
        "pages": pagination.pages,
        "has_next": pagination.has_next,
        "has_prev": pagination.has_prev
    })


@search_bp.route("/filters", methods=["GET"])
@require_auth
def get_search_filters():
    """
    Get available filter options for a session.
    
    Query params:
        session_id: Required session identifier
    """
    session_id = request.args.get("session_id")
    
    if not session_id:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id query parameter is required"
        }), 400
    
    # Get session
    session = Session.query.filter_by(session_id=session_id).first()
    if not session:
        return jsonify({
            "error": "session_not_found",
            "message": f"Session {session_id} not found"
        }), 404
    
    # Get distinct source types
    source_types = db.session.query(Chunk.source_type).filter(
        Chunk.session_id == session.id,
        Chunk.source_type.isnot(None)
    ).distinct().all()
    
    # Get distinct artifact categories
    artifact_categories = db.session.query(Chunk.artifact_category).filter(
        Chunk.session_id == session.id,
        Chunk.artifact_category.isnot(None)
    ).distinct().all()
    
    return jsonify({
        "source_types": sorted([st[0] for st in source_types if st[0]]),
        "artifact_categories": sorted([ac[0] for ac in artifact_categories if ac[0]])
    })


@search_bp.route("/chunk/<chunk_id>", methods=["GET"])
@require_auth
def get_chunk_detail(chunk_id):
    """
    Get full details of a specific chunk.
    """
    chunk = Chunk.query.filter_by(chunk_id=chunk_id).first()
    
    if not chunk:
        return jsonify({
            "error": "chunk_not_found",
            "message": f"Chunk {chunk_id} not found"
        }), 404
    
    # Increment access count
    chunk.access_count += 1
    from datetime import datetime
    chunk.last_accessed = datetime.utcnow()
    db.session.commit()
    
    return jsonify({
        "chunk_id": chunk.chunk_id,
        "content": chunk.content,
        "source_file": chunk.source_file,
        "source_type": chunk.source_type,
        "artifact_category": chunk.artifact_category,
        "section": chunk.section,
        "importance_score": chunk.importance_score,
        "token_count": chunk.token_count,
        "file_modified": chunk.file_modified.isoformat() if chunk.file_modified else None,
        "created_at": chunk.created_at.isoformat() if chunk.created_at else None,
        "access_count": chunk.access_count
    })
