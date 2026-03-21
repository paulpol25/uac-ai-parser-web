"""
Supabase authentication provider.

Verifies JWT tokens issued by Supabase and syncs users to the local database.
"""
import logging
from datetime import datetime
from typing import Optional

from app.models import db, User
from .base import BaseAuthProvider

logger = logging.getLogger(__name__)


class SupabaseAuthProvider(BaseAuthProvider):
    """Supabase-based authentication with local user sync."""
    
    provider_name = "supabase"
    
    def __init__(self, supabase_url: str, supabase_key: str):
        from supabase import create_client
        self._client = create_client(supabase_url, supabase_key)
        self._url = supabase_url
        self._key = supabase_key
    
    def _sync_user_to_local(self, supabase_user) -> User:
        """
        Ensure a Supabase user has a corresponding local User row.
        Creates one if it doesn't exist, updates last_login if it does.
        """
        sub = supabase_user.id  # Supabase user UUID
        email = supabase_user.email or f"{sub}@supabase.local"
        
        # Look up by email first (most reliable identifier)
        user = User.query.filter_by(email=email).first()
        
        if not user:
            # Create local user synced from Supabase
            username = (
                supabase_user.user_metadata.get("username")
                or supabase_user.user_metadata.get("full_name")
                or email.split("@")[0]
            )
            # Ensure username uniqueness
            base_username = username
            counter = 1
            while User.query.filter_by(username=username).first():
                username = f"{base_username}_{counter}"
                counter += 1
            
            user = User(
                username=username,
                email=email,
                password_hash=f"supabase:{sub}",  # Not a real hash, marks as Supabase user
            )
            # First user ever registered becomes admin
            if User.query.count() == 0:
                user.role = "admin"
            db.session.add(user)
        
        user.last_login = datetime.utcnow()
        db.session.commit()
        return user
    
    def verify_token(self, token: str) -> Optional[User]:
        """Verify a Supabase JWT and return the local user."""
        try:
            response = self._client.auth.get_user(token)
            if response and response.user:
                return self._sync_user_to_local(response.user)
        except Exception as e:
            logger.debug(f"Supabase token verification failed: {e}")
        return None
    
    def login(self, identifier: str, password: str) -> Optional[dict]:
        """
        Login via Supabase email/password.
        The identifier is treated as email for Supabase.
        """
        try:
            # If identifier looks like a username, try to find the email  
            if "@" not in identifier:
                local_user = User.query.filter_by(username=identifier).first()
                if local_user:
                    identifier = local_user.email
                else:
                    return None
            
            response = self._client.auth.sign_in_with_password({
                "email": identifier,
                "password": password,
            })
            
            if response and response.user and response.session:
                user = self._sync_user_to_local(response.user)
                return {
                    "token": response.session.access_token,
                    "user": self.user_to_dict(user),
                }
        except Exception as e:
            logger.debug(f"Supabase login failed: {e}")
        return None
    
    def register(self, username: str, email: str, password: str) -> Optional[dict]:
        """Register via Supabase."""
        if not username or len(username) < 3:
            raise ValueError("Username must be at least 3 characters")
        if not email or "@" not in email:
            raise ValueError("Valid email is required")
        if not password or len(password) < 6:
            raise ValueError("Password must be at least 6 characters")
        
        try:
            response = self._client.auth.sign_up({
                "email": email.lower(),
                "password": password,
                "options": {
                    "data": {"username": username},
                },
            })
            
            if response and response.user:
                user = self._sync_user_to_local(response.user)
                token = response.session.access_token if response.session else None
                
                if not token:
                    # Email confirmation required — user created but no session yet
                    return {
                        "token": None,
                        "user": self.user_to_dict(user),
                        "message": "Check your email to confirm your account",
                    }
                
                return {"token": token, "user": self.user_to_dict(user)}
        except Exception as e:
            error_msg = str(e)
            if "already registered" in error_msg.lower():
                raise ValueError("Email is already registered")
            raise ValueError(f"Registration failed: {error_msg}")
    
    def logout(self, token: str) -> bool:
        """Sign out from Supabase."""
        try:
            self._client.auth.sign_out()
            return True
        except Exception as e:
            logger.debug(f"Supabase logout error: {e}")
            return False
