"""
IOC Correlation Service.

Cross-references extracted entities as Indicators of Compromise (IOCs)
across sessions within an investigation. Provides deduplication,
enrichment, and correlation capabilities.

IOC types tracked: ip, domain, url, hash, email, user_agent
"""
import json
import logging
import time
from datetime import datetime
from typing import Optional

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.models import db, Entity, Chunk, IOCEntry, Session

logger = logging.getLogger(__name__)

# Entity types that qualify as IOCs
IOC_TYPE_MAP = {
    "ipv4": "ip",
    "ipv6": "ip",
    "domain": "domain",
    "url": "url",
    "email": "email",
    "hash": "hash",
    "hash_md5": "hash",
    "hash_sha1": "hash",
    "hash_sha256": "hash",
    "mac_address": "mac_address",
}

MAX_RETRIES = 3
RETRY_BASE_DELAY = 0.3


class IOCService:
    """Service for IOC extraction, deduplication, and cross-session correlation."""

    def extract_iocs_for_session(self, session_id: int) -> int:
        """
        Extract IOCs from entity table for a given session and upsert into IOCEntry.
        Uses batch SQL upsert to avoid deadlocks from concurrent workers.
        Returns the number of new/updated IOC entries.
        """
        session_obj = Session.query.get(session_id)
        if not session_obj:
            return 0

        investigation_id = session_obj.investigation_id

        entities = Entity.query.filter(
            Entity.session_id == session_id,
            Entity.entity_type.in_(IOC_TYPE_MAP.keys()),
        ).all()

        if not entities:
            return 0

        # Pre-fetch all needed chunks in one query to avoid N+1
        chunk_ids = {e.chunk_id for e in entities if e.chunk_id}
        chunks = {}
        if chunk_ids:
            for chunk in Chunk.query.filter(Chunk.chunk_id.in_(chunk_ids)).all():
                chunks[chunk.chunk_id] = chunk

        # Build deduplicated IOC batch: (ioc_type, normalized_value) -> info
        batch = {}
        for entity in entities:
            ioc_type = IOC_TYPE_MAP[entity.entity_type]
            normalized = entity.normalized_value or entity.entity_value.lower()
            key = (ioc_type, normalized)

            chunk = chunks.get(entity.chunk_id)
            forensic_ts = (chunk.file_modified or chunk.created_at) if chunk else datetime.utcnow()

            if key not in batch:
                batch[key] = {
                    "value": entity.entity_value[:500],
                    "normalized": normalized[:500],
                    "first_seen": forensic_ts,
                    "last_seen": forensic_ts,
                    "count": 1,
                }
            else:
                entry = batch[key]
                entry["count"] += 1
                if forensic_ts and (not entry["last_seen"] or forensic_ts > entry["last_seen"]):
                    entry["last_seen"] = forensic_ts
                if forensic_ts and (not entry["first_seen"] or forensic_ts < entry["first_seen"]):
                    entry["first_seen"] = forensic_ts

        # Upsert in smaller sub-batches with retry to avoid deadlocks
        items = list(batch.items())
        SUB_BATCH = 50
        total_new = 0

        for i in range(0, len(items), SUB_BATCH):
            sub = items[i : i + SUB_BATCH]
            new_count = self._upsert_batch_with_retry(
                investigation_id, session_id, sub
            )
            total_new += new_count

        logger.info(f"IOC extraction: {total_new} new IOC(s) for session {session_id}")
        return total_new

    def _upsert_batch_with_retry(self, investigation_id, session_id, items):
        """Upsert a sub-batch of IOC items with deadlock retry."""
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                return self._upsert_batch(investigation_id, session_id, items)
            except SQLAlchemyError as exc:
                db.session.rollback()
                db.session.remove()
                if "deadlock" in str(exc).lower() and attempt < MAX_RETRIES:
                    delay = RETRY_BASE_DELAY * (2 ** (attempt - 1))
                    logger.warning(
                        f"IOC upsert deadlock (attempt {attempt}/{MAX_RETRIES}), "
                        f"retrying in {delay:.1f}s..."
                    )
                    time.sleep(delay)
                else:
                    raise

    def _upsert_batch(self, investigation_id, session_id, items):
        """Insert or update a batch of IOC entries using PostgreSQL ON CONFLICT."""
        new_count = 0
        now = datetime.utcnow()

        for (ioc_type, normalized), info in items:
            stmt = text("""
                INSERT INTO ioc_entries
                    (investigation_id, ioc_type, value, normalized_value,
                     session_ids, first_seen, last_seen, occurrence_count,
                     created_at, updated_at)
                VALUES
                    (:inv_id, :ioc_type, :value, :normalized,
                     :session_ids, :first_seen, :last_seen, :occ_count,
                     :now, :now)
                ON CONFLICT ON CONSTRAINT uq_ioc_entry DO UPDATE SET
                    session_ids = CASE
                        WHEN ioc_entries.session_ids::jsonb @> to_jsonb(CAST(:sid AS int))
                        THEN ioc_entries.session_ids
                        ELSE (ioc_entries.session_ids::jsonb || to_jsonb(CAST(:sid AS int)))::text
                    END,
                    occurrence_count = ioc_entries.occurrence_count + :occ_count,
                    first_seen = LEAST(ioc_entries.first_seen, EXCLUDED.first_seen),
                    last_seen  = GREATEST(ioc_entries.last_seen, EXCLUDED.last_seen),
                    updated_at = :now
                RETURNING (xmax = 0) AS inserted
            """)
            result = db.session.execute(stmt, {
                "inv_id": investigation_id,
                "ioc_type": ioc_type,
                "value": info["value"],
                "normalized": info["normalized"],
                "session_ids": json.dumps([session_id]),
                "first_seen": info["first_seen"],
                "last_seen": info["last_seen"],
                "occ_count": info["count"],
                "sid": session_id,
                "now": now,
            })
            row = result.fetchone()
            if row and row[0]:
                new_count += 1

        db.session.commit()
        return new_count

    def correlate_investigation(self, investigation_id: int) -> dict:
        """
        Correlate IOCs across all sessions in an investigation.
        Returns summary with cross-session IOCs highlighted.
        """
        iocs = IOCEntry.query.filter_by(investigation_id=investigation_id).all()

        cross_session = []
        single_session = []

        for ioc in iocs:
            session_ids = json.loads(ioc.session_ids) if ioc.session_ids else []
            entry = {
                "id": ioc.id,
                "type": ioc.ioc_type,
                "value": ioc.value,
                "sessions": session_ids,
                "session_count": len(session_ids),
                "occurrence_count": ioc.occurrence_count,
                "first_seen": ioc.first_seen.isoformat() if ioc.first_seen else None,
                "last_seen": ioc.last_seen.isoformat() if ioc.last_seen else None,
                "geo_country": ioc.geo_country,
                "geo_city": ioc.geo_city,
                "geo_asn": ioc.geo_asn,
            }
            if len(session_ids) > 1:
                cross_session.append(entry)
            else:
                single_session.append(entry)

        return {
            "investigation_id": investigation_id,
            "total_iocs": len(iocs),
            "cross_session_iocs": sorted(cross_session, key=lambda x: x["session_count"], reverse=True),
            "single_session_iocs": single_session,
            "type_breakdown": self._type_breakdown(iocs),
        }

    def get_ioc_summary(self, investigation_id: int) -> dict:
        """Get high-level IOC stats for an investigation."""
        iocs = IOCEntry.query.filter_by(investigation_id=investigation_id).all()

        by_type: dict[str, int] = {}
        cross_session_count = 0

        for ioc in iocs:
            by_type[ioc.ioc_type] = by_type.get(ioc.ioc_type, 0) + 1
            session_ids = json.loads(ioc.session_ids) if ioc.session_ids else []
            if len(session_ids) > 1:
                cross_session_count += 1

        return {
            "total": len(iocs),
            "by_type": by_type,
            "cross_session_count": cross_session_count,
        }

    def search_ioc(self, investigation_id: int, query: str, ioc_type: Optional[str] = None) -> list[dict]:
        """Search for an IOC value within an investigation."""
        filters = [
            IOCEntry.investigation_id == investigation_id,
            IOCEntry.normalized_value.contains(query.lower()),
        ]
        if ioc_type:
            filters.append(IOCEntry.ioc_type == ioc_type)

        results = IOCEntry.query.filter(*filters).limit(100).all()
        return [
            {
                "id": r.id,
                "type": r.ioc_type,
                "value": r.value,
                "sessions": json.loads(r.session_ids) if r.session_ids else [],
                "occurrence_count": r.occurrence_count,
                "geo_country": r.geo_country,
            }
            for r in results
        ]

    def _type_breakdown(self, iocs: list[IOCEntry]) -> dict[str, int]:
        breakdown: dict[str, int] = {}
        for ioc in iocs:
            breakdown[ioc.ioc_type] = breakdown.get(ioc.ioc_type, 0) + 1
        return breakdown
