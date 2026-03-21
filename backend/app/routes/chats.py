"""
Chat management endpoints.

Handles CRUD operations for chat conversations and messages.
"""
from flask import Blueprint, request, jsonify, g
from datetime import datetime
import json

from app.models import db, Chat, ChatMessage, Session, User
from app.routes.auth import require_auth

chats_bp = Blueprint("chats", __name__)


def get_current_user_id() -> int:
    """Get current user ID from g.current_user set by @require_auth."""
    return g.current_user.id


@chats_bp.route("", methods=["GET"])
@require_auth
def list_chats():
    """
    List all chats for a session.
    
    Query params:
        session_id: Required - the session to get chats for
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
            "message": "Session not found"
        }), 404
    
    user_id = get_current_user_id()
    
    chats = Chat.query.filter_by(
        session_id=session.id,
        user_id=user_id,
        is_active=True
    ).order_by(Chat.updated_at.desc()).all()
    
    return jsonify({
        "chats": [
            {
                "id": chat.id,
                "title": chat.title or f"Chat {chat.id}",
                "created_at": chat.created_at.isoformat(),
                "updated_at": chat.updated_at.isoformat(),
                "message_count": chat.messages.count()
            }
            for chat in chats
        ]
    })


@chats_bp.route("", methods=["POST"])
@require_auth
def create_chat():
    """
    Create a new chat for a session.
    
    Body:
        session_id: Required - the session this chat belongs to
        title: Optional - chat title (generated from first message if not provided)
    """
    data = request.get_json() or {}
    
    session_id = data.get("session_id")
    if not session_id:
        return jsonify({
            "error": "missing_session_id",
            "message": "session_id is required"
        }), 400
    
    # Get session
    session = Session.query.filter_by(session_id=session_id).first()
    if not session:
        return jsonify({
            "error": "session_not_found",
            "message": "Session not found"
        }), 404
    
    user_id = get_current_user_id()
    
    chat = Chat(
        session_id=session.id,
        user_id=user_id,
        title=data.get("title")
    )
    
    db.session.add(chat)
    db.session.commit()
    
    return jsonify({
        "id": chat.id,
        "title": chat.title,
        "session_id": session_id,
        "created_at": chat.created_at.isoformat(),
        "updated_at": chat.updated_at.isoformat()
    }), 201


@chats_bp.route("/<int:chat_id>", methods=["GET"])
@require_auth
def get_chat(chat_id: int):
    """
    Get a chat with all its messages.
    """
    user_id = get_current_user_id()
    
    chat = Chat.query.filter_by(
        id=chat_id,
        user_id=user_id,
        is_active=True
    ).first()
    
    if not chat:
        return jsonify({
            "error": "chat_not_found",
            "message": "Chat not found"
        }), 404
    
    # Get session_id (the UUID string)
    session = Session.query.get(chat.session_id)
    
    messages = ChatMessage.query.filter_by(
        chat_id=chat.id
    ).order_by(ChatMessage.created_at.asc()).all()
    
    return jsonify({
        "id": chat.id,
        "title": chat.title or f"Chat {chat.id}",
        "session_id": session.session_id if session else None,
        "created_at": chat.created_at.isoformat(),
        "updated_at": chat.updated_at.isoformat(),
        "messages": [
            {
                "id": msg.id,
                "role": msg.role,
                "content": msg.content,
                "sources": json.loads(msg.sources) if msg.sources else None,
                "reasoning_steps": json.loads(msg.reasoning_steps) if msg.reasoning_steps else None,
                "created_at": msg.created_at.isoformat()
            }
            for msg in messages
        ]
    })


@chats_bp.route("/<int:chat_id>", methods=["PATCH"])
@require_auth
def update_chat(chat_id: int):
    """
    Update chat metadata (title).
    """
    user_id = get_current_user_id()
    data = request.get_json() or {}
    
    chat = Chat.query.filter_by(
        id=chat_id,
        user_id=user_id,
        is_active=True
    ).first()
    
    if not chat:
        return jsonify({
            "error": "chat_not_found",
            "message": "Chat not found"
        }), 404
    
    if "title" in data:
        chat.title = data["title"]
    
    chat.updated_at = datetime.utcnow()
    db.session.commit()
    
    return jsonify({
        "id": chat.id,
        "title": chat.title,
        "updated_at": chat.updated_at.isoformat()
    })


@chats_bp.route("/<int:chat_id>", methods=["DELETE"])
@require_auth
def delete_chat(chat_id: int):
    """
    Delete a chat (soft delete).
    """
    user_id = get_current_user_id()
    
    chat = Chat.query.filter_by(
        id=chat_id,
        user_id=user_id,
        is_active=True
    ).first()
    
    if not chat:
        return jsonify({
            "error": "chat_not_found",
            "message": "Chat not found"
        }), 404
    
    # Soft delete
    chat.is_active = False
    chat.updated_at = datetime.utcnow()
    db.session.commit()
    
    return jsonify({
        "success": True,
        "message": "Chat deleted"
    })


@chats_bp.route("/<int:chat_id>/messages", methods=["POST"])
@require_auth
def add_message(chat_id: int):
    """
    Add a message to a chat.
    
    Body:
        role: 'user' or 'assistant'
        content: Message content
        sources: Optional - array of source references (for assistant)
        reasoning_steps: Optional - array of reasoning steps (for agentic assistant)
    """
    user_id = get_current_user_id()
    data = request.get_json() or {}
    
    chat = Chat.query.filter_by(
        id=chat_id,
        user_id=user_id,
        is_active=True
    ).first()
    
    if not chat:
        return jsonify({
            "error": "chat_not_found",
            "message": "Chat not found"
        }), 404
    
    role = data.get("role")
    content = data.get("content")
    
    if not role or role not in ["user", "assistant", "system"]:
        return jsonify({
            "error": "invalid_role",
            "message": "role must be 'user', 'assistant', or 'system'"
        }), 400
    
    if not content:
        return jsonify({
            "error": "missing_content",
            "message": "content is required"
        }), 400
    
    message = ChatMessage(
        chat_id=chat.id,
        role=role,
        content=content,
        sources=json.dumps(data.get("sources")) if data.get("sources") else None,
        reasoning_steps=json.dumps(data.get("reasoning_steps")) if data.get("reasoning_steps") else None,
        model_used=data.get("model_used")
    )
    
    db.session.add(message)
    
    # Auto-generate title from first user message if not set
    if not chat.title and role == "user":
        # Take first 50 chars of first user message as title
        chat.title = content[:50] + ("..." if len(content) > 50 else "")
    
    chat.updated_at = datetime.utcnow()
    db.session.commit()
    
    return jsonify({
        "id": message.id,
        "chat_id": chat.id,
        "role": message.role,
        "content": message.content,
        "created_at": message.created_at.isoformat()
    }), 201


@chats_bp.route("/<int:chat_id>/messages", methods=["GET"])
@require_auth
def get_messages(chat_id: int):
    """
    Get all messages for a chat (for conversation history).
    """
    user_id = get_current_user_id()
    
    chat = Chat.query.filter_by(
        id=chat_id,
        user_id=user_id,
        is_active=True
    ).first()
    
    if not chat:
        return jsonify({
            "error": "chat_not_found",
            "message": "Chat not found"
        }), 404
    
    messages = ChatMessage.query.filter_by(
        chat_id=chat.id
    ).order_by(ChatMessage.created_at.asc()).all()
    
    return jsonify({
        "messages": [
            {
                "id": msg.id,
                "role": msg.role,
                "content": msg.content,
                "sources": json.loads(msg.sources) if msg.sources else None,
                "created_at": msg.created_at.isoformat()
            }
            for msg in messages
        ]
    })
