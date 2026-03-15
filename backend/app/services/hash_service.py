"""
Hash Verification Service.

Provides analysis of file hashes collected by UAC's hash_executables module.
Supports cross-session comparison to detect new/modified executables,
and known-good baseline marking.
"""
import json
import logging
from typing import Optional

from app.models import db, FileHash, Session

logger = logging.getLogger(__name__)


class HashService:
    """Service for file hash analysis and cross-session comparison."""

    def get_session_hashes(self, session_id: int, unknown_only: bool = False) -> list[dict]:
        """Get all file hashes for a session."""
        query = FileHash.query.filter_by(session_id=session_id)
        if unknown_only:
            query = query.filter(FileHash.is_known_good.is_(None))
        
        hashes = query.order_by(FileHash.file_path).all()
        return [self._hash_to_dict(h) for h in hashes]

    def compare_sessions(self, session_id_a: int, session_id_b: int) -> dict:
        """
        Compare file hashes between two sessions.
        Returns new, removed, and changed files.
        """
        hashes_a = {h.file_path: h for h in FileHash.query.filter_by(session_id=session_id_a).all()}
        hashes_b = {h.file_path: h for h in FileHash.query.filter_by(session_id=session_id_b).all()}

        paths_a = set(hashes_a.keys())
        paths_b = set(hashes_b.keys())

        new_files = []
        for path in paths_b - paths_a:
            new_files.append(self._hash_to_dict(hashes_b[path]))

        removed_files = []
        for path in paths_a - paths_b:
            removed_files.append(self._hash_to_dict(hashes_a[path]))

        changed_files = []
        for path in paths_a & paths_b:
            ha, hb = hashes_a[path], hashes_b[path]
            if self._hashes_differ(ha, hb):
                changed_files.append({
                    "file_path": path,
                    "before": self._hash_to_dict(ha),
                    "after": self._hash_to_dict(hb),
                })

        return {
            "session_a": session_id_a,
            "session_b": session_id_b,
            "new_files": new_files,
            "removed_files": removed_files,
            "changed_files": changed_files,
            "summary": {
                "total_a": len(paths_a),
                "total_b": len(paths_b),
                "new": len(new_files),
                "removed": len(removed_files),
                "changed": len(changed_files),
                "unchanged": len(paths_a & paths_b) - len(changed_files),
            },
        }

    def mark_known_good(self, session_id: int, file_paths: Optional[list[str]] = None) -> int:
        """
        Mark files as known-good baseline. If file_paths is None, marks all files in session.
        Returns count of updated records.
        """
        query = FileHash.query.filter_by(session_id=session_id)
        if file_paths:
            query = query.filter(FileHash.file_path.in_(file_paths))
        
        count = query.update({"is_known_good": True}, synchronize_session="fetch")
        db.session.commit()
        logger.info(f"Marked {count} file(s) as known-good in session {session_id}")
        return count

    def find_unknown_executables(self, session_id: int) -> list[dict]:
        """Find executables that haven't been marked as known-good."""
        hashes = FileHash.query.filter(
            FileHash.session_id == session_id,
            FileHash.is_known_good.is_(None),
        ).order_by(FileHash.file_path).all()
        return [self._hash_to_dict(h) for h in hashes]

    def search_hash(self, investigation_id: int, hash_value: str) -> list[dict]:
        """Search for a specific hash value across all sessions in an investigation."""
        sessions = Session.query.filter_by(investigation_id=investigation_id).all()
        session_ids = [s.id for s in sessions]
        if not session_ids:
            return []

        results = FileHash.query.filter(
            FileHash.session_id.in_(session_ids),
            db.or_(
                FileHash.hash_md5 == hash_value.lower(),
                FileHash.hash_sha1 == hash_value.lower(),
                FileHash.hash_sha256 == hash_value.lower(),
            ),
        ).all()

        return [
            {**self._hash_to_dict(h), "session_id": h.session_id}
            for h in results
        ]

    def _hashes_differ(self, a: FileHash, b: FileHash) -> bool:
        """Check if any available hash differs between two records."""
        if a.hash_sha256 and b.hash_sha256:
            return a.hash_sha256 != b.hash_sha256
        if a.hash_sha1 and b.hash_sha1:
            return a.hash_sha1 != b.hash_sha1
        if a.hash_md5 and b.hash_md5:
            return a.hash_md5 != b.hash_md5
        return False

    def _hash_to_dict(self, h: FileHash) -> dict:
        return {
            "file_path": h.file_path,
            "md5": h.hash_md5,
            "sha1": h.hash_sha1,
            "sha256": h.hash_sha256,
            "file_size": h.file_size,
            "is_known_good": h.is_known_good,
        }
