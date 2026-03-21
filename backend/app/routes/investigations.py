"""
Investigation management endpoints.

Handles CRUD operations for investigations and sessions.
"""
import logging
import shutil
import subprocess
from pathlib import Path
from flask import Blueprint, request, jsonify, g, current_app
from datetime import datetime

from app.models import db, Investigation, Session, User, Chunk, FileHash, Entity, EntityRelationship, ChunkRelevance, Chat, MitreMapping
from app.routes.auth import require_auth, require_permission

logger = logging.getLogger(__name__)

investigations_bp = Blueprint("investigations", __name__)


def get_current_user_id() -> int:
    """Get current user ID from g.current_user set by @require_auth."""
    return g.current_user.id


@investigations_bp.route("", methods=["GET"])
@require_auth
def list_investigations():
    """List all investigations for the current user."""
    user_id = get_current_user_id()
    
    investigations = Investigation.query.filter_by(
        user_id=user_id
    ).filter(
        Investigation.status != "deleted"
    ).order_by(Investigation.updated_at.desc()).all()
    
    return jsonify({
        "investigations": [
            {
                "id": inv.id,
                "name": inv.name,
                "description": inv.description,
                "case_number": inv.case_number,
                "status": inv.status,
                "created_at": inv.created_at.isoformat(),
                "updated_at": inv.updated_at.isoformat(),
                "session_count": inv.sessions.count(),
                "query_count": inv.queries.count()
            }
            for inv in investigations
        ]
    })


@investigations_bp.route("", methods=["POST"])
@require_permission("manage_investigations")
def create_investigation():
    """Create a new investigation."""
    user_id = get_current_user_id()
    data = request.get_json() or {}
    
    name = data.get("name")
    if not name:
        return jsonify({
            "error": "missing_name",
            "message": "Investigation name is required"
        }), 400
    
    investigation = Investigation(
        name=name,
        description=data.get("description"),
        case_number=data.get("case_number"),
        user_id=user_id
    )
    
    db.session.add(investigation)
    db.session.commit()
    
    return jsonify({
        "id": investigation.id,
        "name": investigation.name,
        "description": investigation.description,
        "case_number": investigation.case_number,
        "status": investigation.status,
        "created_at": investigation.created_at.isoformat()
    }), 201


@investigations_bp.route("/<int:investigation_id>", methods=["GET"])
@require_auth
def get_investigation(investigation_id: int):
    """Get investigation details including sessions."""
    user_id = get_current_user_id()
    
    investigation = Investigation.query.filter_by(
        id=investigation_id,
        user_id=user_id
    ).first()
    
    if not investigation:
        return jsonify({
            "error": "not_found",
            "message": "Investigation not found"
        }), 404
    
    sessions = Session.query.filter_by(
        investigation_id=investigation_id
    ).order_by(Session.parsed_at.desc()).all()
    
    return jsonify({
        "id": investigation.id,
        "name": investigation.name,
        "description": investigation.description,
        "case_number": investigation.case_number,
        "status": investigation.status,
        "created_at": investigation.created_at.isoformat(),
        "updated_at": investigation.updated_at.isoformat(),
        "sessions": [
            {
                "id": s.id,
                "session_id": s.session_id,
                "original_filename": s.original_filename,
                "hostname": s.hostname,
                "os_type": s.os_type,
                "total_artifacts": s.total_artifacts,
                "total_chunks": s.total_chunks,
                "status": s.status,
                "has_embeddings": s.has_embeddings,
                "parsed_at": s.parsed_at.isoformat() if s.parsed_at else None
            }
            for s in sessions
        ]
    })


@investigations_bp.route("/<int:investigation_id>", methods=["PUT"])
@require_permission("manage_investigations")
def update_investigation(investigation_id: int):
    """Update investigation details."""
    user_id = get_current_user_id()
    
    investigation = Investigation.query.filter_by(
        id=investigation_id,
        user_id=user_id
    ).first()
    
    if not investigation:
        return jsonify({
            "error": "not_found",
            "message": "Investigation not found"
        }), 404
    
    data = request.get_json() or {}
    
    if "name" in data:
        investigation.name = data["name"]
    if "description" in data:
        investigation.description = data["description"]
    if "case_number" in data:
        investigation.case_number = data["case_number"]
    if "status" in data and data["status"] in ["active", "archived"]:
        investigation.status = data["status"]
    
    db.session.commit()
    
    return jsonify({
        "id": investigation.id,
        "name": investigation.name,
        "description": investigation.description,
        "case_number": investigation.case_number,
        "status": investigation.status,
        "updated_at": investigation.updated_at.isoformat()
    })


def _safe_rmtree(path: Path):
    """Remove a directory tree using subprocess to avoid Python EMFILE errors."""
    try:
        subprocess.run(["rm", "-rf", str(path)], timeout=120, check=False)
    except Exception as e:
        logger.warning(f"Could not delete {path}: {e}")


@investigations_bp.route("/<int:investigation_id>", methods=["DELETE"])
@require_permission("manage_investigations")
def delete_investigation(investigation_id: int):
    """Hard-delete an investigation and all associated files."""
    user_id = get_current_user_id()
    
    investigation = Investigation.query.filter_by(
        id=investigation_id,
        user_id=user_id
    ).first()
    
    if not investigation:
        return jsonify({
            "error": "not_found",
            "message": "Investigation not found"
        }), 404
    
    # Collect file paths to delete after DB commit
    sessions = Session.query.filter_by(investigation_id=investigation_id).all()
    paths_to_delete = []
    session_ids_for_chroma = []
    for session in sessions:
        session_ids_for_chroma.append(session.session_id)
        if session.extract_path:
            p = Path(session.extract_path)
            if p.exists():
                paths_to_delete.append(p)
        if session.archive_path:
            p = Path(session.archive_path)
            if p.exists():
                paths_to_delete.append(p)
    
    # Delete investigation — ON DELETE CASCADE handles all child rows
    db.session.delete(investigation)
    db.session.commit()
    
    # Clean up ChromaDB collections
    try:
        from app.services.tiered_rag_service import get_chroma_client
        client = get_chroma_client()
        for sid in session_ids_for_chroma:
            try:
                client.delete_collection(f"session_{sid}")
            except Exception:
                pass
    except Exception:
        pass
    
    # Clean up filesystem after successful DB commit
    for p in paths_to_delete:
        _safe_rmtree(p)
    
    return jsonify({
        "message": "Investigation and all associated files deleted",
        "files_deleted": len(paths_to_delete)
    })


@investigations_bp.route("/<int:investigation_id>/sessions/<session_id>", methods=["GET"])
@require_auth
def get_session(investigation_id: int, session_id: str):
    """Get session details."""
    user_id = get_current_user_id()
    
    # Verify investigation ownership
    investigation = Investigation.query.filter_by(
        id=investigation_id,
        user_id=user_id
    ).first()
    
    if not investigation:
        return jsonify({
            "error": "not_found",
            "message": "Investigation not found"
        }), 404
    
    session = Session.query.filter_by(
        session_id=session_id,
        investigation_id=investigation_id
    ).first()
    
    if not session:
        return jsonify({
            "error": "not_found",
            "message": "Session not found"
        }), 404
    
    return jsonify({
        "id": session.id,
        "session_id": session.session_id,
        "investigation_id": session.investigation_id,
        "original_filename": session.original_filename,
        "file_hash": session.file_hash,
        "file_size": session.file_size,
        "hostname": session.hostname,
        "os_type": session.os_type,
        "collection_date": session.collection_date.isoformat() if session.collection_date else None,
        "total_artifacts": session.total_artifacts,
        "total_chunks": session.total_chunks,
        "status": session.status,
        "error_message": session.error_message,
        "parsed_at": session.parsed_at.isoformat() if session.parsed_at else None
    })


@investigations_bp.route("/<int:investigation_id>/sessions/<session_id>", methods=["DELETE"])
@require_permission("manage_investigations")
def delete_session(investigation_id: int, session_id: str):
    """Delete a session and its files from an investigation."""
    user_id = get_current_user_id()
    
    # Verify investigation ownership
    investigation = Investigation.query.filter_by(
        id=investigation_id,
        user_id=user_id
    ).first()
    
    if not investigation:
        return jsonify({
            "error": "not_found",
            "message": "Investigation not found"
        }), 404
    
    session = Session.query.filter_by(
        session_id=session_id,
        investigation_id=investigation_id
    ).first()
    
    if not session:
        return jsonify({
            "error": "not_found",
            "message": "Session not found"
        }), 404
    
    files_deleted = 0
    paths_to_delete = []
    
    # Collect file paths before DB deletion
    if session.extract_path:
        p = Path(session.extract_path)
        if p.exists():
            paths_to_delete.append(p)
    
    if session.archive_path:
        p = Path(session.archive_path)
        if p.exists():
            paths_to_delete.append(p)
    
    # Delete session — ON DELETE CASCADE handles child rows
    chroma_collection_name = f"session_{session.session_id}"
    db.session.delete(session)
    db.session.commit()
    
    # Clean up ChromaDB collection
    try:
        from app.services.tiered_rag_service import get_chroma_client
        client = get_chroma_client()
        try:
            client.delete_collection(chroma_collection_name)
        except Exception:
            pass
    except Exception:
        pass
    
    # Clean up filesystem after DB commit
    for p in paths_to_delete:
        _safe_rmtree(p)
        files_deleted += 1
    
    return jsonify({
        "message": "Session and files deleted",
        "session_id": session_id,
        "files_deleted": files_deleted
    })
