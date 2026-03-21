"""
Base auth provider interface.
"""
from abc import ABC, abstractmethod
from typing import Optional
from app.models import User


class BaseAuthProvider(ABC):
    """Abstract base class for authentication providers."""
    
    provider_name: str = "base"
    
    @abstractmethod
    def verify_token(self, token: str) -> Optional[User]:
        """Verify an auth token and return the associated user, or None."""
        ...
    
    @abstractmethod
    def login(self, identifier: str, password: str) -> Optional[dict]:
        """
        Authenticate with credentials.
        Returns dict with 'token' and 'user' keys on success, None on failure.
        """
        ...
    
    @abstractmethod
    def register(self, username: str, email: str, password: str) -> Optional[dict]:
        """
        Register a new user.
        Returns dict with 'token' and 'user' keys on success, None on failure.
        Raises ValueError with message on validation errors.
        """
        ...
    
    @abstractmethod
    def logout(self, token: str) -> bool:
        """Invalidate a token. Returns True on success."""
        ...
    
    def user_to_dict(self, user: User) -> dict:
        """Serialize a User model to dict."""
        return {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "role": getattr(user, "role", "operator") or "operator",
            "operator_permissions": getattr(user, "operator_permissions", {}) or {},
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "last_login": user.last_login.isoformat() if user.last_login else None,
        }
