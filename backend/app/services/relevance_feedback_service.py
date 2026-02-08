"""
Relevance Feedback Service for UAC AI Parser.

Tracks which chunks are actually useful in LLM responses and uses that
information to improve future retrieval quality.

How it works:
1. After LLM generates a response, we analyze which chunks were cited/used
2. Chunks that appear in the response get a relevance boost
3. Future queries use these scores to rank retrieved chunks higher
4. Over time, the system learns which chunks are most valuable

Signals tracked:
- Citation: LLM explicitly referenced the chunk (e.g., "According to auth.log...")
- Usage: Chunk content appeared in the response (detected by overlap)
- Retrieval: Chunk was retrieved but may not have been used

This is a form of implicit relevance feedback - no explicit user ratings needed.
"""
import re
import json
from typing import List, Dict, Optional, Set, Tuple
from datetime import datetime
import logging

from app.models import db, Chunk, ChunkRelevance

logger = logging.getLogger(__name__)


class RelevanceFeedbackService:
    """
    Service for tracking and applying relevance feedback to chunk retrieval.
    
    Implements a learning loop:
    1. retrieve_with_boost() - Get chunks with relevance boost applied
    2. record_retrieval() - Mark chunks as retrieved
    3. record_usage() - After response, detect which chunks were used
    4. get_relevance_scores() - View current scores for debugging
    """
    
    # Boost factors for ranking
    CITATION_BOOST = 0.3  # Strong boost for explicitly cited chunks
    USAGE_BOOST = 0.15    # Medium boost for content that appeared in response
    RETRIEVAL_PENALTY = 0.05  # Slight penalty for retrieved-but-not-used
    
    # Minimum overlap ratio to consider content "used"
    USAGE_OVERLAP_THRESHOLD = 0.3
    
    def __init__(self):
        """Initialize the relevance feedback service."""
        self._keyword_cache: Dict[str, Set[str]] = {}  # Cache extracted keywords
    
    def record_retrieval(self, session_id: str, chunk_ids: List[str]) -> int:
        """
        Record that chunks were retrieved for a query.
        
        Args:
            session_id: Session identifier
            chunk_ids: List of retrieved chunk IDs
            
        Returns:
            Number of chunks recorded
        """
        from app.models import Session
        
        session = Session.query.filter_by(session_id=session_id).first()
        if not session:
            return 0
        
        recorded = 0
        for chunk_id in chunk_ids:
            relevance = ChunkRelevance.query.filter_by(chunk_id=chunk_id).first()
            
            if not relevance:
                relevance = ChunkRelevance(
                    chunk_id=chunk_id,
                    session_id=session.id,
                    retrieval_count=1
                )
                db.session.add(relevance)
            else:
                relevance.retrieval_count += 1
            
            relevance.update_score()
            recorded += 1
        
        try:
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            logger.error(f"Failed to record retrieval: {e}")
            return 0
        
        return recorded
    
    def record_usage(
        self, 
        session_id: str, 
        retrieved_chunks: List[Dict],
        response_text: str,
        query_text: str
    ) -> Dict[str, int]:
        """
        Analyze response to detect which chunks were actually used.
        
        Uses two detection methods:
        1. Citation detection: Looks for file references like "In auth.log..."
        2. Content overlap: Checks if chunk content appears in response
        
        Args:
            session_id: Session identifier
            retrieved_chunks: List of chunks that were retrieved (need chunk_id and content)
            response_text: The LLM's response text
            query_text: Original query (for topic extraction)
            
        Returns:
            Dict with counts: {cited: N, used: N, unused: N}
        """
        from app.models import Session
        
        session = Session.query.filter_by(session_id=session_id).first()
        if not session:
            return {"error": "Session not found"}
        
        stats = {"cited": 0, "used": 0, "unused": 0}
        response_lower = response_text.lower()
        query_keywords = self._extract_keywords(query_text)
        
        for chunk in retrieved_chunks:
            chunk_id = chunk.get("chunk_id")
            if not chunk_id:
                continue
            
            chunk_content = chunk.get("content", chunk.get("text", ""))
            source_file = chunk.get("source_file", "")
            
            # Get or create relevance record
            relevance = ChunkRelevance.query.filter_by(chunk_id=chunk_id).first()
            if not relevance:
                relevance = ChunkRelevance(
                    chunk_id=chunk_id,
                    session_id=session.id
                )
                db.session.add(relevance)
            
            # Check for citation (file name mentioned in response)
            is_cited = self._detect_citation(source_file, response_text)
            
            # Check for content usage (chunk content appears in response)
            is_used = self._detect_content_usage(chunk_content, response_text)
            
            if is_cited:
                relevance.citation_count += 1
                stats["cited"] += 1
            elif is_used:
                relevance.usage_count += 1
                stats["used"] += 1
            else:
                stats["unused"] += 1
            
            # Update topic associations if chunk was useful
            if is_cited or is_used:
                self._update_topics(relevance, query_keywords)
            
            relevance.update_score()
        
        try:
            db.session.commit()
            logger.info(f"Recorded usage: {stats}")
        except Exception as e:
            db.session.rollback()
            logger.error(f"Failed to record usage: {e}")
            return {"error": str(e)}
        
        return stats
    
    def _detect_citation(self, source_file: str, response_text: str) -> bool:
        """
        Detect if a source file was explicitly cited in the response.
        
        Looks for patterns like:
        - "In /var/log/auth.log..."
        - "According to the auth.log file..."
        - "The passwd file shows..."
        """
        if not source_file:
            return False
        
        response_lower = response_text.lower()
        
        # Get filename without path
        filename = source_file.split("/")[-1].lower()
        
        # Check for exact match
        if filename in response_lower:
            return True
        
        # Check for partial match (e.g., "auth.log" from "/var/log/auth.log")
        name_parts = filename.replace(".", " ").replace("-", " ").replace("_", " ").split()
        for part in name_parts:
            if len(part) > 3 and part in response_lower:
                # Look for citation patterns
                patterns = [
                    rf"in\s+.*?{re.escape(part)}",
                    rf"from\s+.*?{re.escape(part)}",
                    rf"according\s+to\s+.*?{re.escape(part)}",
                    rf"{re.escape(part)}\s+shows",
                    rf"{re.escape(part)}\s+contains",
                    rf"{re.escape(part)}\s+indicates",
                ]
                for pattern in patterns:
                    if re.search(pattern, response_lower):
                        return True
        
        return False
    
    def _detect_content_usage(self, chunk_content: str, response_text: str) -> bool:
        """
        Detect if chunk content was used in the response.
        
        Uses n-gram overlap to detect if significant phrases from the chunk
        appear in the response (indicating the LLM used that information).
        """
        if not chunk_content or not response_text:
            return False
        
        # Extract significant phrases from chunk (3-5 word sequences)
        chunk_phrases = self._extract_phrases(chunk_content)
        response_lower = response_text.lower()
        
        if not chunk_phrases:
            return False
        
        # Count how many phrases appear in response
        matches = sum(1 for phrase in chunk_phrases if phrase in response_lower)
        overlap_ratio = matches / len(chunk_phrases) if chunk_phrases else 0
        
        return overlap_ratio >= self.USAGE_OVERLAP_THRESHOLD
    
    def _extract_phrases(self, text: str, min_words: int = 3, max_words: int = 5) -> Set[str]:
        """Extract significant multi-word phrases from text."""
        words = re.findall(r'\b[a-zA-Z]{3,}\b', text.lower())
        phrases = set()
        
        # Skip if too few words
        if len(words) < min_words:
            return phrases
        
        # Extract n-grams
        for n in range(min_words, min(max_words + 1, len(words) + 1)):
            for i in range(len(words) - n + 1):
                phrase = " ".join(words[i:i + n])
                # Skip common phrases
                if not self._is_common_phrase(phrase):
                    phrases.add(phrase)
        
        # Limit to most unique phrases
        return set(list(phrases)[:20])
    
    def _is_common_phrase(self, phrase: str) -> bool:
        """Check if phrase is too common to be meaningful."""
        common_words = {
            "the", "and", "for", "this", "that", "with", "from", "have",
            "has", "was", "were", "are", "been", "being", "will", "would",
            "could", "should", "may", "might", "must", "shall"
        }
        words = phrase.split()
        common_count = sum(1 for w in words if w in common_words)
        return common_count > len(words) / 2
    
    def _extract_keywords(self, query: str) -> Set[str]:
        """Extract keywords from query for topic tracking."""
        if query in self._keyword_cache:
            return self._keyword_cache[query]
        
        # Remove common question words and extract meaningful terms
        stopwords = {
            "what", "where", "when", "who", "why", "how", "which",
            "is", "are", "was", "were", "the", "a", "an", "in", "on",
            "show", "me", "find", "get", "list", "tell", "about"
        }
        
        words = re.findall(r'\b[a-zA-Z]{3,}\b', query.lower())
        keywords = {w for w in words if w not in stopwords}
        
        self._keyword_cache[query] = keywords
        return keywords
    
    def _update_topics(self, relevance: ChunkRelevance, keywords: Set[str]):
        """Update the topics this chunk is useful for."""
        if not keywords:
            return
        
        existing_topics = set()
        if relevance.useful_for_topics:
            try:
                existing_topics = set(json.loads(relevance.useful_for_topics))
            except:
                pass
        
        # Add new topics (limit to 50 most recent)
        updated_topics = existing_topics | keywords
        if len(updated_topics) > 50:
            updated_topics = set(list(updated_topics)[-50:])
        
        relevance.useful_for_topics = json.dumps(list(updated_topics))
    
    def get_relevance_boost(self, session_id: str, chunk_ids: List[str]) -> Dict[str, float]:
        """
        Get relevance boost scores for a list of chunks.
        
        Args:
            session_id: Session identifier
            chunk_ids: List of chunk IDs to get scores for
            
        Returns:
            Dict mapping chunk_id to boost score (0.0 to 1.0)
        """
        if not chunk_ids:
            return {}
        
        relevances = ChunkRelevance.query.filter(
            ChunkRelevance.chunk_id.in_(chunk_ids)
        ).all()
        
        return {r.chunk_id: r.relevance_score for r in relevances}
    
    def apply_relevance_boost(
        self, 
        chunks: List[Dict], 
        session_id: str,
        boost_weight: float = 0.2
    ) -> List[Dict]:
        """
        Apply relevance boost to ranked chunks.
        
        Combines original retrieval score with learned relevance score.
        
        Args:
            chunks: List of chunks with 'chunk_id' and 'relevance_score' keys
            session_id: Session identifier
            boost_weight: How much to weight relevance (0.0-1.0)
            
        Returns:
            Re-ranked list of chunks with boosted scores
        """
        if not chunks:
            return chunks
        
        chunk_ids = [c.get("chunk_id") for c in chunks if c.get("chunk_id")]
        boosts = self.get_relevance_boost(session_id, chunk_ids)
        
        for chunk in chunks:
            chunk_id = chunk.get("chunk_id")
            if chunk_id and chunk_id in boosts:
                original_score = chunk.get("relevance_score", 0.5)
                boost = boosts[chunk_id]
                
                # Weighted combination
                chunk["relevance_score"] = (
                    original_score * (1 - boost_weight) +
                    (original_score + boost * self.CITATION_BOOST) * boost_weight
                )
                chunk["relevance_boosted"] = True
                chunk["boost_amount"] = boost
        
        # Re-sort by boosted score
        chunks.sort(key=lambda c: c.get("relevance_score", 0), reverse=True)
        
        return chunks
    
    def get_session_relevance_stats(self, session_id: str) -> Dict:
        """
        Get relevance statistics for a session.
        
        Returns:
            Dict with stats about chunk relevance
        """
        from app.models import Session
        
        session = Session.query.filter_by(session_id=session_id).first()
        if not session:
            return {"error": "Session not found"}
        
        relevances = ChunkRelevance.query.filter_by(session_id=session.id).all()
        
        if not relevances:
            return {
                "total_tracked": 0,
                "total_citations": 0,
                "total_usages": 0,
                "avg_relevance": 0.0,
                "top_chunks": []
            }
        
        total_citations = sum(r.citation_count for r in relevances)
        total_usages = sum(r.usage_count for r in relevances)
        avg_relevance = sum(r.relevance_score for r in relevances) / len(relevances)
        
        # Get top relevant chunks
        top_relevances = sorted(relevances, key=lambda r: r.relevance_score, reverse=True)[:10]
        top_chunks = []
        
        for r in top_relevances:
            chunk = Chunk.query.filter_by(chunk_id=r.chunk_id).first()
            if chunk:
                top_chunks.append({
                    "chunk_id": r.chunk_id,
                    "source_file": chunk.source_file,
                    "relevance_score": round(r.relevance_score, 3),
                    "citation_count": r.citation_count,
                    "usage_count": r.usage_count,
                    "topics": json.loads(r.useful_for_topics) if r.useful_for_topics else []
                })
        
        return {
            "total_tracked": len(relevances),
            "total_citations": total_citations,
            "total_usages": total_usages,
            "avg_relevance": round(avg_relevance, 3),
            "top_chunks": top_chunks
        }


# Singleton instance
_relevance_service = None


def get_relevance_feedback_service() -> RelevanceFeedbackService:
    """Get or create singleton RelevanceFeedbackService instance."""
    global _relevance_service
    if _relevance_service is None:
        _relevance_service = RelevanceFeedbackService()
    return _relevance_service
