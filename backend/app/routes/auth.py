"""
Authentication routes.

Handles user registration, login, logout, and session management.
Delegates to the configured auth provider (Supabase or local).
"""
from functools import wraps

from flask import Blueprint, request, jsonify, g

from app.models import db, User
from app.services.auth_providers import get_auth_provider, get_provider_name

auth_bp = Blueprint("auth", __name__)


def require_auth(f):
    """Decorator to require authentication (works with any provider)."""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        
        if not auth_header.startswith("Bearer "):
            return jsonify({
                "error": "unauthorized",
                "message": "Missing or invalid authorization header"
            }), 401
        
        token = auth_header[7:]
        provider = get_auth_provider()
        user = provider.verify_token(token)
        
        if not user:
            return jsonify({
                "error": "unauthorized",
                "message": "Invalid or expired token"
            }), 401
        
        g.current_user = user
        return f(*args, **kwargs)
    
    return decorated


@auth_bp.route("/provider", methods=["GET"])
def get_active_provider():
    """Return which auth provider is active."""
    return jsonify({"provider": get_provider_name()})


@auth_bp.route("/register", methods=["POST"])
def register():
    """Register a new user."""
    data = request.get_json() or {}
    
    username = data.get("username", "").strip()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")
    
    provider = get_auth_provider()
    try:
        result = provider.register(username, email, password)
    except ValueError as e:
        return jsonify({
            "error": "validation_error",
            "message": str(e),
        }), 400
    
    if not result:
        return jsonify({
            "error": "registration_failed",
            "message": "Registration failed",
        }), 400
    
    status = 201
    response = {
        "token": result["token"],
        "user": result["user"],
    }
    if "message" in result:
        response["message"] = result["message"]
    
    return jsonify(response), status


@auth_bp.route("/login", methods=["POST"])
def login():
    """Login with username/email and password."""
    data = request.get_json() or {}
    
    identifier = data.get("username", "").strip()
    password = data.get("password", "")
    
    if not identifier or not password:
        return jsonify({
            "error": "invalid_credentials",
            "message": "Username/email and password are required"
        }), 400
    
    provider = get_auth_provider()
    result = provider.login(identifier, password)
    
    if not result:
        return jsonify({
            "error": "invalid_credentials",
            "message": "Invalid username/email or password"
        }), 401
    
    return jsonify(result)


@auth_bp.route("/logout", methods=["POST"])
@require_auth
def logout():
    """Logout and invalidate token."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else ""
    
    provider = get_auth_provider()
    provider.logout(token)
    
    return jsonify({"message": "Logged out successfully"})


@auth_bp.route("/me", methods=["GET"])
@require_auth
def get_current_user():
    """Get current authenticated user."""
    user = g.current_user
    
    return jsonify({
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "last_login": user.last_login.isoformat() if user.last_login else None
    })


@auth_bp.route("/me", methods=["PUT"])
@require_auth
def update_current_user():
    """Update current user profile."""
    user = g.current_user
    data = request.get_json() or {}
    
    if "email" in data:
        email = data["email"].strip().lower()
        if email != user.email:
            existing = User.query.filter_by(email=email).first()
            if existing:
                return jsonify({
                    "error": "email_taken",
                    "message": "Email is already registered"
                }), 409
            user.email = email
    
    if "password" in data:
        # Password change only supported for local provider
        if get_provider_name() == "local":
            from app.services.auth_providers.local_provider import LocalAuthProvider
            password = data["password"]
            if len(password) < 6:
                return jsonify({
                    "error": "invalid_password",
                    "message": "Password must be at least 6 characters"
                }), 400
            user.password_hash = LocalAuthProvider.hash_password(password)
        else:
            return jsonify({
                "error": "not_supported",
                "message": "Password changes must be done through Supabase"
            }), 400
    
    db.session.commit()
    
    return jsonify({
        "id": user.id,
        "username": user.username,
        "email": user.email
    })
