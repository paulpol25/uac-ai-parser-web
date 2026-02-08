"""
Session Manager - Shared session state across services.

This module provides a centralized store for session data that can be
accessed by all services. In production, this should be replaced with
a persistent store like Redis or a database.
"""
from datetime import datetime
from typing import Any


class SessionManager:
    """Centralized session state manager."""
    
    # Singleton pattern for shared state
    _instance = None
    _sessions: dict[str, dict] = {}
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def create_session(self, session_id: str) -> None:
        """Create a new session."""
        self._sessions[session_id] = {
            "id": session_id,
            "status": "created",
            "created_at": datetime.utcnow().isoformat(),
            "artifacts": [],
            "summary": None,
            "file_path": None,
            "extract_dir": None
        }
    
    def get_session(self, session_id: str) -> dict | None:
        """Get session data."""
        return self._sessions.get(session_id)
    
    def update_session(self, session_id: str, **kwargs) -> None:
        """Update session data."""
        if session_id not in self._sessions:
            return
        self._sessions[session_id].update(kwargs)
        self._sessions[session_id]["updated_at"] = datetime.utcnow().isoformat()
    
    def get_artifacts(self, session_id: str) -> list[dict] | None:
        """Get artifacts for a session."""
        session = self.get_session(session_id)
        if session is None:
            return None
        return session.get("artifacts", [])
    
    def get_summary(self, session_id: str) -> dict | None:
        """Get summary for a session."""
        session = self.get_session(session_id)
        if session is None:
            return None
        return session.get("summary")
    
    def session_exists(self, session_id: str) -> bool:
        """Check if session exists."""
        return session_id in self._sessions
    
    def delete_session(self, session_id: str) -> bool:
        """Delete a session."""
        if session_id in self._sessions:
            del self._sessions[session_id]
            return True
        return False


# Global instance
session_manager = SessionManager()
