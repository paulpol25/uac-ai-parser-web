"""
IOC Correlation Service.

Cross-references extracted entities as Indicators of Compromise (IOCs)
across sessions within an investigation. Provides deduplication,
enrichment, and correlation capabilities.

IOC types tracked: ip, domain, url, hash, email, user_agent
"""
import json
import logging
from datetime import datetime
from typing import Optional

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


class IOCService:
    """Service for IOC extraction, deduplication, and cross-session correlation."""

    def extract_iocs_for_session(self, session_id: int) -> int:
        """
        Extract IOCs from entity table for a given session and upsert into IOCEntry.
        Returns the number of new/updated IOC entries.
        """
        session = Session.query.get(session_id)
        if not session:
            return 0

        investigation_id = session.investigation_id

        entities = Entity.query.filter(
            Entity.session_id == session_id,
            Entity.entity_type.in_(IOC_TYPE_MAP.keys()),
        ).all()

        count = 0
        for entity in entities:
            ioc_type = IOC_TYPE_MAP[entity.entity_type]
            normalized = entity.normalized_value or entity.entity_value.lower()

            # Use forensic timestamp from source chunk when available
            chunk = Chunk.query.filter_by(chunk_id=entity.chunk_id).first()
            forensic_ts = (chunk.file_modified or chunk.created_at) if chunk else datetime.utcnow()

            existing = IOCEntry.query.filter_by(
                investigation_id=investigation_id,
                ioc_type=ioc_type,
                normalized_value=normalized,
            ).first()

            if existing:
                # Update existing IOC: add session_id, bump count
                session_ids = json.loads(existing.session_ids) if existing.session_ids else []
                if session_id not in session_ids:
                    session_ids.append(session_id)
                    existing.session_ids = json.dumps(session_ids)
                existing.occurrence_count += 1
                if forensic_ts and (not existing.last_seen or forensic_ts > existing.last_seen):
                    existing.last_seen = forensic_ts
                if forensic_ts and (not existing.first_seen or forensic_ts < existing.first_seen):
                    existing.first_seen = forensic_ts
            else:
                ioc = IOCEntry(
                    investigation_id=investigation_id,
                    ioc_type=ioc_type,
                    value=entity.entity_value[:500],
                    normalized_value=normalized[:500],
                    session_ids=json.dumps([session_id]),
                    first_seen=forensic_ts,
                    last_seen=forensic_ts,
                    occurrence_count=1,
                )
                db.session.add(ioc)
                count += 1

        db.session.commit()
        logger.info(f"IOC extraction: {count} new IOC(s) for session {session_id}")
        return count

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
