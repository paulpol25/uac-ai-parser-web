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
        "role": getattr(user, "role", "operator") or "operator",
        "operator_permissions": getattr(user, "operator_permissions", {}) or {},
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


# ------------------------------------------------------------------ #
#   RBAC helpers
# ------------------------------------------------------------------ #

# All granular permissions that can be granted to operators
OPERATOR_PERMISSIONS = {
    "dispatch_commands": "Dispatch commands to agents",
    "manage_agents": "Register / delete agents",
    "run_playbooks": "Run playbooks on agents",
    "manage_playbooks": "Create / edit / delete custom playbooks",
    "manage_yara_rules": "Upload / delete / toggle YARA rules",
    "manage_investigations": "Create / delete investigations",
    "upload_artifacts": "Upload UAC archives",
    "query_data": "Run RAG queries and analysis",
    "export_data": "Export investigation data",
    "view_settings": "View application settings",
    "manage_settings": "Change application settings",
    "manage_users": "Manage users (admin-level)",
}


def require_role(*allowed_roles):
    """Decorator: require authenticated user with one of the given roles."""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                return jsonify({"error": "unauthorized", "message": "Missing authorization"}), 401
            token = auth_header[7:]
            provider = get_auth_provider()
            user = provider.verify_token(token)
            if not user:
                return jsonify({"error": "unauthorized", "message": "Invalid token"}), 401
            role = getattr(user, "role", "operator") or "operator"
            if role not in allowed_roles:
                return jsonify({"error": "forbidden", "message": f"Requires role: {', '.join(allowed_roles)}"}), 403
            g.current_user = user
            return f(*args, **kwargs)
        return decorated
    return decorator


def require_permission(permission: str):
    """Decorator: require admin or operator with the given permission.
    Viewers are always denied. Admins always pass."""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                return jsonify({"error": "unauthorized", "message": "Missing authorization"}), 401
            token = auth_header[7:]
            provider = get_auth_provider()
            user = provider.verify_token(token)
            if not user:
                return jsonify({"error": "unauthorized", "message": "Invalid token"}), 401
            role = getattr(user, "role", "operator") or "operator"
            if role == "viewer":
                return jsonify({"error": "forbidden", "message": "Viewers have read-only access"}), 403
            if role == "operator":
                perms = getattr(user, "operator_permissions", {}) or {}
                if not perms.get(permission, False):
                    return jsonify({"error": "forbidden", "message": f"Missing permission: {permission}"}), 403
            # admin passes through
            g.current_user = user
            return f(*args, **kwargs)
        return decorated
    return decorator


# ------------------------------------------------------------------ #
#   Admin: user management
# ------------------------------------------------------------------ #

@auth_bp.route("/users", methods=["GET"])
@require_role("admin")
def list_users():
    """List all users (admin only)."""
    users = User.query.order_by(User.id).all()
    provider = get_auth_provider()
    return jsonify({"users": [provider.user_to_dict(u) for u in users]})


@auth_bp.route("/users/<int:user_id>", methods=["PUT"])
@require_role("admin")
def update_user(user_id: int):
    """Update a user's role and operator_permissions (admin only)."""
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"error": "not_found", "message": "User not found"}), 404

    data = request.get_json() or {}

    if "role" in data:
        if data["role"] not in ("admin", "operator", "viewer"):
            return jsonify({"error": "bad_request", "message": "Invalid role"}), 400
        # Prevent removing the last admin
        if user.role == "admin" and data["role"] != "admin":
            admin_count = User.query.filter_by(role="admin").count()
            if admin_count <= 1:
                return jsonify({"error": "bad_request", "message": "Cannot remove the last admin"}), 400
        user.role = data["role"]

    if "operator_permissions" in data and isinstance(data["operator_permissions"], dict):
        # Only allow known permission keys
        clean = {k: bool(v) for k, v in data["operator_permissions"].items() if k in OPERATOR_PERMISSIONS}
        user.operator_permissions = clean

    if "email" in data:
        user.email = data["email"].strip().lower()

    db.session.commit()
    provider = get_auth_provider()
    return jsonify(provider.user_to_dict(user))


@auth_bp.route("/users/<int:user_id>", methods=["DELETE"])
@require_role("admin")
def delete_user(user_id: int):
    """Delete a user (admin only). Cannot delete yourself."""
    if g.current_user.id == user_id:
        return jsonify({"error": "bad_request", "message": "Cannot delete yourself"}), 400
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"error": "not_found", "message": "User not found"}), 404
    if user.role == "admin":
        admin_count = User.query.filter_by(role="admin").count()
        if admin_count <= 1:
            return jsonify({"error": "bad_request", "message": "Cannot delete the last admin"}), 400
    # Delete associated tokens
    from app.models import AuthToken
    AuthToken.query.filter_by(user_id=user_id).delete()
    db.session.delete(user)
    db.session.commit()
    return jsonify({"message": "User deleted"})


@auth_bp.route("/permissions", methods=["GET"])
@require_auth
def list_permissions():
    """List all available operator permissions."""
    return jsonify({"permissions": OPERATOR_PERMISSIONS})
