"""
Session Comparison Service.

Compares two UAC sessions to find differences in users, processes,
network connections, and file system state. Useful for baseline vs
compromised analysis.
"""
import json
import logging
from typing import Optional

from app.models import db, Session, Entity, FileHash

logger = logging.getLogger(__name__)


class ComparisonService:
    """Service for comparing two forensic sessions."""

    def compare(self, session_id_a: int, session_id_b: int) -> dict:
        """
        Compare two sessions across multiple dimensions.
        session_a is treated as baseline, session_b as the target.
        """
        result = {
            "session_a": session_id_a,
            "session_b": session_id_b,
        }

        result["users"] = self._compare_entity_type(session_id_a, session_id_b, "username")
        result["processes"] = self._compare_entity_type(session_id_a, session_id_b, "command")
        result["network"] = self._compare_entity_type(session_id_a, session_id_b, "ipv4")
        result["services"] = self._compare_entity_type(session_id_a, session_id_b, "service")
        result["files"] = self._compare_file_hashes(session_id_a, session_id_b)

        # Summary
        result["summary"] = {
            dim: {
                "new": len(result[dim].get("added", [])),
                "removed": len(result[dim].get("removed", [])),
            }
            for dim in ["users", "processes", "network", "services"]
        }
        result["summary"]["files"] = {
            "new": len(result["files"].get("new_files", [])),
            "removed": len(result["files"].get("removed_files", [])),
            "changed": len(result["files"].get("changed_files", [])),
        }

        return result

    def _compare_entity_type(
        self, session_a: int, session_b: int, entity_type: str
    ) -> dict:
        """Compare entities of a given type between two sessions."""
        values_a = set(
            e.normalized_value
            for e in Entity.query.filter_by(
                session_id=session_a, entity_type=entity_type
            ).all()
            if e.normalized_value
        )
        values_b = set(
            e.normalized_value
            for e in Entity.query.filter_by(
                session_id=session_b, entity_type=entity_type
            ).all()
            if e.normalized_value
        )

        return {
            "added": sorted(values_b - values_a),
            "removed": sorted(values_a - values_b),
            "common": sorted(values_a & values_b),
        }

    def _compare_file_hashes(self, session_a: int, session_b: int) -> dict:
        """Compare file hashes between two sessions."""
        from app.services.hash_service import HashService
        return HashService().compare_sessions(session_a, session_b)
