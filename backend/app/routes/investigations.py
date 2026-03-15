"""
Investigation management endpoints.

Handles CRUD operations for investigations and sessions.
"""
import logging
import shutil
from pathlib import Path
from flask import Blueprint, request, jsonify, g
from datetime import datetime

from app.models import db, Investigation, Session, User, Chunk
from app.services.auth_providers import get_auth_provider

logger = logging.getLogger(__name__)

investigations_bp = Blueprint("investigations", __name__)


def get_current_user_id() -> int:
    """
    Get current user ID from auth token or create/use default user.
    
    If Authorization header is present and valid, use that user.
    Otherwise, fall back to default user for backwards compatibility.
    """
    # Check for auth token
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        provider = get_auth_provider()
        user = provider.verify_token(token)
        if user:
            return user.id
    
    # Fall back to default user
    user = User.query.filter_by(username="default").first()
    if not user:
        user = User(
            username="default",
            email="default@local",
            password_hash="not-implemented"
        )
        db.session.add(user)
        db.session.commit()
    return user.id


@investigations_bp.route("", methods=["GET"])
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
                "parsed_at": s.parsed_at.isoformat() if s.parsed_at else None
            }
            for s in sessions
        ]
    })


@investigations_bp.route("/<int:investigation_id>", methods=["PUT"])
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


@investigations_bp.route("/<int:investigation_id>", methods=["DELETE"])
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
    
    # Delete all session files and data
    sessions = Session.query.filter_by(investigation_id=investigation_id).all()
    files_deleted = 0
    
    for session in sessions:
        # Delete extracted files directory
        if session.extract_path:
            extract_path = Path(session.extract_path)
            if extract_path.exists():
                try:
                    shutil.rmtree(extract_path)
                    files_deleted += 1
                except Exception as e:
                    logger.warning(f"Could not delete extract path {extract_path}: {e}")
        
        # Delete archive file
        if session.archive_path:
            archive_path = Path(session.archive_path)
            if archive_path.exists():
                try:
                    archive_path.unlink()
                    files_deleted += 1
                except Exception as e:
                    logger.warning(f"Could not delete archive {archive_path}: {e}")
        
        # Delete chunks from database
        Chunk.query.filter_by(session_id=session.id).delete()
    
    # Delete all sessions
    Session.query.filter_by(investigation_id=investigation_id).delete()
    
    # Delete investigation
    db.session.delete(investigation)
    db.session.commit()
    
    return jsonify({
        "message": "Investigation and all associated files deleted",
        "files_deleted": files_deleted
    })


@investigations_bp.route("/<int:investigation_id>/sessions/<session_id>", methods=["GET"])
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
    
    # Delete extracted files directory
    if session.extract_path:
        extract_path = Path(session.extract_path)
        if extract_path.exists():
            try:
                shutil.rmtree(extract_path)
                files_deleted += 1
            except Exception as e:
                logger.warning(f"Could not delete extract path {extract_path}: {e}")
    
    # Delete archive file
    if session.archive_path:
        archive_path = Path(session.archive_path)
        if archive_path.exists():
            try:
                archive_path.unlink()
                files_deleted += 1
            except Exception as e:
                logger.warning(f"Could not delete archive {archive_path}: {e}")
    
    # Delete chunks from database
    Chunk.query.filter_by(session_id=session.id).delete()
    
    # Delete the session record
    db.session.delete(session)
    db.session.commit()
    
    return jsonify({
        "message": "Session and files deleted",
        "session_id": session_id,
        "files_deleted": files_deleted
    })
