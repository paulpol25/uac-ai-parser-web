"""
Local authentication provider.

Extracted from the original auth routes. Uses PBKDF2-SHA256 password hashing
and DB-backed token storage (replacing the old in-memory dict).
"""
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional

from app.models import db, User, AuthToken
from .base import BaseAuthProvider


class LocalAuthProvider(BaseAuthProvider):
    """Local username/password authentication with DB-backed tokens."""
    
    provider_name = "local"
    TOKEN_EXPIRY_DAYS = 7
    
    # --- Password hashing ---
    
    @staticmethod
    def hash_password(password: str) -> str:
        """Hash a password with salt using PBKDF2-SHA256."""
        salt = secrets.token_hex(16)
        hashed = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode(),
            salt.encode(),
            100000,
        ).hex()
        return f"{salt}:{hashed}"
    
    @staticmethod
    def verify_password(password: str, stored_hash: str) -> bool:
        """Verify a password against stored hash."""
        try:
            salt, hashed = stored_hash.split(":")
            new_hash = hashlib.pbkdf2_hmac(
                "sha256",
                password.encode(),
                salt.encode(),
                100000,
            ).hex()
            return secrets.compare_digest(new_hash, hashed)
        except (ValueError, AttributeError):
            return False
    
    # --- Token management (DB-backed) ---
    
    def _generate_token(self, user_id: int) -> str:
        """Generate and store an auth token in the database."""
        token = secrets.token_urlsafe(32)
        expires = datetime.utcnow() + timedelta(days=self.TOKEN_EXPIRY_DAYS)
        
        auth_token = AuthToken(
            token=token,
            user_id=user_id,
            expires_at=expires,
        )
        db.session.add(auth_token)
        db.session.commit()
        return token
    
    # --- BaseAuthProvider implementation ---
    
    def verify_token(self, token: str) -> Optional[User]:
        """Verify token from the database."""
        auth_token = AuthToken.query.filter_by(token=token).first()
        if not auth_token:
            return None
        
        if datetime.utcnow() > auth_token.expires_at:
            db.session.delete(auth_token)
            db.session.commit()
            return None
        
        return User.query.get(auth_token.user_id)
    
    def login(self, identifier: str, password: str) -> Optional[dict]:
        """Login with username/email and password."""
        user = User.query.filter(
            (User.username == identifier) | (User.email == identifier.lower())
        ).first()
        
        if not user or not self.verify_password(password, user.password_hash):
            return None
        
        user.last_login = datetime.utcnow()
        db.session.commit()
        
        token = self._generate_token(user.id)
        return {"token": token, "user": self.user_to_dict(user)}
    
    def register(self, username: str, email: str, password: str) -> Optional[dict]:
        """Register a new local user."""
        # Validation
        errors = []
        if not username or len(username) < 3:
            errors.append("Username must be at least 3 characters")
        if not email or "@" not in email:
            errors.append("Valid email is required")
        if not password or len(password) < 6:
            errors.append("Password must be at least 6 characters")
        if errors:
            raise ValueError(errors[0])
        
        if User.query.filter_by(username=username).first():
            raise ValueError("Username is already taken")
        if User.query.filter_by(email=email.lower()).first():
            raise ValueError("Email is already registered")
        
        user = User(
            username=username,
            email=email.lower(),
            password_hash=self.hash_password(password),
        )
        db.session.add(user)
        db.session.commit()
        
        token = self._generate_token(user.id)
        return {"token": token, "user": self.user_to_dict(user)}
    
    def logout(self, token: str) -> bool:
        """Invalidate a token by removing it from the database."""
        auth_token = AuthToken.query.filter_by(token=token).first()
        if auth_token:
            db.session.delete(auth_token)
            db.session.commit()
            return True
        return False
    
    def cleanup_expired_tokens(self):
        """Remove all expired tokens from the database."""
        expired = AuthToken.query.filter(AuthToken.expires_at < datetime.utcnow()).all()
        for t in expired:
            db.session.delete(t)
        db.session.commit()
        return len(expired)
