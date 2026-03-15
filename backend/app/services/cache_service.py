"""
Redis cache service for UAC AI Parser.

Provides a thin caching layer on top of Redis for:
- Query result caching (avoid repeated LLM calls)
- Session metadata caching (fast lookups)
- Rate limiting helpers
"""
from __future__ import annotations

import json
import logging
from typing import Any

from flask import current_app

logger = logging.getLogger(__name__)

DEFAULT_TTL = 3600  # 1 hour


def _redis():
    """Return the app-level Redis client, or None if unavailable."""
    return getattr(current_app, "redis", None)


# ---------------------------------------------------------------------------
# Generic get / set
# ---------------------------------------------------------------------------

def cache_get(key: str) -> Any | None:
    """Fetch a JSON-serialised value from Redis. Returns None on miss or error."""
    r = _redis()
    if r is None:
        return None
    try:
        raw = r.get(key)
        if raw is None:
            return None
        return json.loads(raw)
    except Exception as e:
        logger.debug("cache_get(%s) failed: %s", key, e)
        return None


def cache_set(key: str, value: Any, ttl: int = DEFAULT_TTL) -> bool:
    """Store a JSON-serialisable value in Redis with TTL. Returns True on success."""
    r = _redis()
    if r is None:
        return False
    try:
        r.setex(key, ttl, json.dumps(value, default=str))
        return True
    except Exception as e:
        logger.debug("cache_set(%s) failed: %s", key, e)
        return False


def cache_delete(key: str) -> bool:
    """Delete a key from Redis."""
    r = _redis()
    if r is None:
        return False
    try:
        r.delete(key)
        return True
    except Exception as e:
        logger.debug("cache_delete(%s) failed: %s", key, e)
        return False


def cache_delete_pattern(pattern: str) -> int:
    """Delete all keys matching a glob pattern. Returns count deleted."""
    r = _redis()
    if r is None:
        return 0
    try:
        keys = list(r.scan_iter(match=pattern, count=500))
        if keys:
            return r.delete(*keys)
        return 0
    except Exception as e:
        logger.debug("cache_delete_pattern(%s) failed: %s", pattern, e)
        return 0


# ---------------------------------------------------------------------------
# Domain-specific helpers
# ---------------------------------------------------------------------------

def cache_query_result(session_id: str, query_hash: str, result: dict, ttl: int = DEFAULT_TTL) -> bool:
    """Cache an LLM query result keyed by session + query hash."""
    key = f"uac:query:{session_id}:{query_hash}"
    return cache_set(key, result, ttl)


def get_cached_query(session_id: str, query_hash: str) -> dict | None:
    """Retrieve a cached query result."""
    key = f"uac:query:{session_id}:{query_hash}"
    return cache_get(key)


def invalidate_session_cache(session_id: str) -> int:
    """Clear all cached data for a session (e.g. after re-parsing)."""
    return cache_delete_pattern(f"uac:*:{session_id}:*")


def cache_session_meta(session_id: str, meta: dict, ttl: int = 600) -> bool:
    """Cache session metadata for fast lookups."""
    key = f"uac:session:{session_id}:meta"
    return cache_set(key, meta, ttl)


def get_cached_session_meta(session_id: str) -> dict | None:
    """Retrieve cached session metadata."""
    key = f"uac:session:{session_id}:meta"
    return cache_get(key)
