"""
Cleanup & Data Retention Service.

Handles automatic and manual cleanup:
- Expired sessions based on retention policy
- Extracted archives after parsing
- Orphaned ChromaDB collections
- Orphaned upload files
- SQLite VACUUM
- Disk usage reporting
"""
import logging
import os
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from flask import current_app

from app.models import (
    db, Session, Investigation, Chunk, Entity, EntityRelationship,
    MitreMapping, IOCEntry, FileHash, CleanupPolicy, AuthToken,
)

logger = logging.getLogger(__name__)


class CleanupService:
    """Service for disk cleanup and data retention management."""

    def get_storage_report(self) -> dict:
        """Get disk usage report for all data stores."""
        db_path = current_app.config.get("SQLALCHEMY_DATABASE_URI", "")
        if db_path.startswith("sqlite:///"):
            db_file = db_path.replace("sqlite:///", "")
            db_size = self._get_file_size(db_file)
        else:
            # PostgreSQL — query actual database size
            try:
                result = db.session.execute(db.text("SELECT pg_database_size(current_database())"))
                db_size = result.scalar() or 0
            except Exception:
                db_size = 0
        chroma_dir = current_app.config.get("CHROMA_PERSIST_DIR", "chroma_db")
        uploads_dir = current_app.config.get("UPLOAD_FOLDER", "uploads")
        chroma_size = self._get_dir_size(chroma_dir)
        uploads_size = self._get_dir_size(uploads_dir)
        total = db_size + chroma_size + uploads_size

        max_gb = float(current_app.config.get("MAX_STORAGE_GB", 50))
        warning = total > (max_gb * 1024 * 1024 * 1024 * 0.9)

        return {
            "db_bytes": db_size,
            "chroma_bytes": chroma_size,
            "uploads_bytes": uploads_size,
            "total_bytes": total,
            "total_gb": round(total / (1024 ** 3), 2),
            "max_gb": max_gb,
            "warning": warning,
        }

    def run_cleanup_cycle(self) -> dict:
        """Run a full cleanup cycle. Returns summary of actions taken."""
        results = {}

        retention_days = int(current_app.config.get("DATA_RETENTION_DAYS", 90))
        if retention_days > 0:
            results["expired_sessions"] = self._cleanup_expired_sessions(retention_days)

        results["orphaned_extracts"] = self._cleanup_extracted_archives()
        results["orphaned_uploads"] = self._cleanup_orphaned_uploads()
        results["expired_tokens"] = self._cleanup_expired_tokens()

        # VACUUM (SQLite only — PostgreSQL auto-vacuums and cannot VACUUM inside a transaction)
        db_uri = current_app.config.get("SQLALCHEMY_DATABASE_URI", "")
        if db_uri.startswith("sqlite"):
            try:
                db.session.execute(db.text("VACUUM"))
                results["vacuum"] = True
            except Exception as e:
                logger.warning(f"VACUUM failed: {e}")
                results["vacuum"] = False
        else:
            results["vacuum"] = "skipped (PostgreSQL auto-vacuum)"

        logger.info(f"Cleanup cycle complete: {results}")
        return results

    def delete_session_data(self, session_id: int) -> dict:
        """
        Delete a session and ALL associated data (chunks, entities, relationships,
        ChromaDB collection, extracted files, uploaded archive).
        """
        session = Session.query.get(session_id)
        if not session:
            return {"error": "not_found"}

        freed = 0

        # Delete ChromaDB collection
        try:
            import chromadb
            chroma_dir = current_app.config.get("CHROMA_PERSIST_DIR", "chroma_db")
            client = chromadb.PersistentClient(path=chroma_dir)
            collection_name = f"session_{session.session_id}"
            try:
                client.delete_collection(collection_name)
            except Exception:
                pass
        except ImportError:
            pass

        # Delete extracted files
        if session.extract_path and os.path.exists(session.extract_path):
            freed += self._get_dir_size(session.extract_path)
            shutil.rmtree(session.extract_path, ignore_errors=True)

        # Delete uploaded archive
        if session.archive_path and os.path.exists(session.archive_path):
            freed += self._get_file_size(session.archive_path)
            try:
                os.remove(session.archive_path)
            except OSError:
                pass

        # Delete DB records in correct order (relationships first)
        MitreMapping.query.filter_by(session_id=session_id).delete()
        FileHash.query.filter_by(session_id=session_id).delete()

        entity_ids = [e.id for e in Entity.query.filter_by(session_id=session_id).all()]
        if entity_ids:
            EntityRelationship.query.filter(
                db.or_(
                    EntityRelationship.source_entity_id.in_(entity_ids),
                    EntityRelationship.target_entity_id.in_(entity_ids),
                )
            ).delete(synchronize_session="fetch")
        Entity.query.filter_by(session_id=session_id).delete()
        Chunk.query.filter_by(session_id=session_id).delete()
        db.session.delete(session)
        db.session.commit()

        return {"deleted_session": session_id, "bytes_freed": freed}

    def delete_investigation_data(self, investigation_id: int) -> dict:
        """Delete an investigation and all its sessions + data."""
        investigation = Investigation.query.get(investigation_id)
        if not investigation:
            return {"error": "not_found"}

        sessions = Session.query.filter_by(investigation_id=investigation_id).all()
        total_freed = 0
        session_count = 0

        for session in sessions:
            result = self.delete_session_data(session.id)
            total_freed += result.get("bytes_freed", 0)
            session_count += 1

        # Delete investigation-level data
        IOCEntry.query.filter_by(investigation_id=investigation_id).delete()
        CleanupPolicy.query.filter_by(investigation_id=investigation_id).delete()
        db.session.delete(investigation)
        db.session.commit()

        return {
            "deleted_investigation": investigation_id,
            "sessions_deleted": session_count,
            "bytes_freed": total_freed,
        }

    # ── Internal helpers ───────────────────────────────────────

    def _cleanup_expired_sessions(self, retention_days: int) -> int:
        """Delete sessions older than retention period."""
        cutoff = datetime.utcnow() - timedelta(days=retention_days)
        expired = Session.query.filter(Session.parsed_at < cutoff).all()
        count = 0
        for session in expired:
            # Check per-investigation policy override
            policy = CleanupPolicy.query.filter_by(
                investigation_id=session.investigation_id
            ).first()
            if policy and policy.retention_days == 0:
                continue  # 0 = never auto-delete
            if policy and policy.retention_days:
                inv_cutoff = datetime.utcnow() - timedelta(days=policy.retention_days)
                if session.parsed_at >= inv_cutoff:
                    continue

            self.delete_session_data(session.id)
            count += 1
        return count

    def _cleanup_extracted_archives(self) -> int:
        """Delete extracted archive directories for completed sessions."""
        if not current_app.config.get("CLEANUP_EXTRACTED_AFTER_PARSE", True):
            return 0

        sessions = Session.query.filter(
            Session.status.in_(["searchable", "ready"]),
            Session.extract_path.isnot(None),
        ).all()

        count = 0
        for session in sessions:
            if session.extract_path and os.path.exists(session.extract_path):
                shutil.rmtree(session.extract_path, ignore_errors=True)
                session.extract_path = None
                count += 1

        if count:
            db.session.commit()
        return count

    def _cleanup_orphaned_uploads(self) -> int:
        """Delete upload files that don't belong to any session."""
        uploads_dir = current_app.config.get("UPLOAD_FOLDER", "uploads")
        if not os.path.exists(uploads_dir):
            return 0

        known_archives = {
            s.archive_path
            for s in Session.query.filter(Session.archive_path.isnot(None)).all()
        }

        count = 0
        for f in Path(uploads_dir).iterdir():
            if f.is_file() and str(f) not in known_archives:
                try:
                    f.unlink()
                    count += 1
                except OSError:
                    pass
        return count

    def _cleanup_expired_tokens(self) -> int:
        """Delete expired auth tokens."""
        count = AuthToken.query.filter(AuthToken.expires_at < datetime.utcnow()).delete()
        db.session.commit()
        return count

    def _get_file_size(self, path: str) -> int:
        try:
            return os.path.getsize(path)
        except OSError:
            return 0

    def _get_dir_size(self, path: str) -> int:
        total = 0
        try:
            for dirpath, _, filenames in os.walk(path):
                for f in filenames:
                    fp = os.path.join(dirpath, f)
                    try:
                        total += os.path.getsize(fp)
                    except OSError:
                        pass
        except OSError:
            pass
        return total
