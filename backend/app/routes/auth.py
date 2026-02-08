"""
Authentication routes.

Handles user registration, login, logout, and session management.
"""
from datetime import datetime, timedelta
import hashlib
import secrets
from functools import wraps

from flask import Blueprint, request, jsonify, g, current_app

from app.models import db, User

auth_bp = Blueprint("auth", __name__)

# Simple token storage (in production, use Redis or database)
# Token format: {token: {"user_id": int, "expires": datetime}}
_tokens: dict[str, dict] = {}


def hash_password(password: str) -> str:
    """Hash a password with salt."""
    salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode(),
        salt.encode(),
        100000
    ).hex()
    return f"{salt}:{hashed}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify a password against stored hash."""
    try:
        salt, hashed = stored_hash.split(":")
        new_hash = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode(),
            salt.encode(),
            100000
        ).hex()
        return new_hash == hashed
    except (ValueError, AttributeError):
        return False


def generate_token(user_id: int) -> str:
    """Generate an auth token for a user."""
    token = secrets.token_urlsafe(32)
    _tokens[token] = {
        "user_id": user_id,
        "expires": datetime.utcnow() + timedelta(days=7)
    }
    return token


def get_user_from_token(token: str) -> User | None:
    """Get user from auth token."""
    token_data = _tokens.get(token)
    if not token_data:
        return None
    
    if datetime.utcnow() > token_data["expires"]:
        del _tokens[token]
        return None
    
    return User.query.get(token_data["user_id"])


def require_auth(f):
    """Decorator to require authentication."""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        
        if not auth_header.startswith("Bearer "):
            return jsonify({
                "error": "unauthorized",
                "message": "Missing or invalid authorization header"
            }), 401
        
        token = auth_header[7:]
        user = get_user_from_token(token)
        
        if not user:
            return jsonify({
                "error": "unauthorized",
                "message": "Invalid or expired token"
            }), 401
        
        g.current_user = user
        return f(*args, **kwargs)
    
    return decorated


@auth_bp.route("/register", methods=["POST"])
def register():
    """Register a new user."""
    data = request.get_json() or {}
    
    username = data.get("username", "").strip()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")
    
    # Validation
    errors = []
    
    if not username or len(username) < 3:
        errors.append("Username must be at least 3 characters")
    
    if not email or "@" not in email:
        errors.append("Valid email is required")
    
    if not password or len(password) < 6:
        errors.append("Password must be at least 6 characters")
    
    if errors:
        return jsonify({
            "error": "validation_error",
            "message": errors[0],
            "errors": errors
        }), 400
    
    # Check if username or email already exists
    if User.query.filter_by(username=username).first():
        return jsonify({
            "error": "username_taken",
            "message": "Username is already taken"
        }), 409
    
    if User.query.filter_by(email=email).first():
        return jsonify({
            "error": "email_taken",
            "message": "Email is already registered"
        }), 409
    
    # Create user
    user = User(
        username=username,
        email=email,
        password_hash=hash_password(password)
    )
    
    db.session.add(user)
    db.session.commit()
    
    # Generate token
    token = generate_token(user.id)
    
    return jsonify({
        "token": token,
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email
        }
    }), 201


@auth_bp.route("/login", methods=["POST"])
def login():
    """Login with username/email and password."""
    data = request.get_json() or {}
    
    identifier = data.get("username", "").strip()  # Can be username or email
    password = data.get("password", "")
    
    if not identifier or not password:
        return jsonify({
            "error": "invalid_credentials",
            "message": "Username/email and password are required"
        }), 400
    
    # Find user by username or email
    user = User.query.filter(
        (User.username == identifier) | (User.email == identifier.lower())
    ).first()
    
    if not user or not verify_password(password, user.password_hash):
        return jsonify({
            "error": "invalid_credentials",
            "message": "Invalid username/email or password"
        }), 401
    
    # Update last login
    user.last_login = datetime.utcnow()
    db.session.commit()
    
    # Generate token
    token = generate_token(user.id)
    
    return jsonify({
        "token": token,
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email
        }
    })


@auth_bp.route("/logout", methods=["POST"])
@require_auth
def logout():
    """Logout and invalidate token."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else ""
    
    if token in _tokens:
        del _tokens[token]
    
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
        password = data["password"]
        if len(password) < 6:
            return jsonify({
                "error": "invalid_password",
                "message": "Password must be at least 6 characters"
            }), 400
        user.password_hash = hash_password(password)
    
    db.session.commit()
    
    return jsonify({
        "id": user.id,
        "username": user.username,
        "email": user.email
    })
