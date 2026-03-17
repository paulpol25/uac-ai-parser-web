"""
Graph RAG Service for UAC AI Parser.

Builds and traverses entity relationship graphs for forensic investigation.
Enables queries like:
- "What did user john do?" → Follow all relationships from john
- "What was the kill chain?" → Trace attack path
- "How is this IP connected to that file?" → Find path between entities

Relationships are inferred from entity co-occurrence patterns:
- Same chunk = likely related
- Specific patterns = stronger relationship type inference

Designed to complement Agentic RAG - the agent can use graph tools
to explore relationships it discovers.
"""
from typing import Generator, Optional, Dict, List, Set, Tuple, Any
from collections import defaultdict
from datetime import datetime
import logging

from app.models import db, Entity, EntityRelationship, Chunk, Session

logger = logging.getLogger(__name__)


# Relationship inference rules based on entity type pairs
# (source_type, target_type) -> relationship_type
RELATIONSHIP_RULES = {
    # User relationships
    ("username", "command"): "executed",
    ("username", "ipv4"): "connected_from",
    ("username", "ipv6"): "connected_from",
    ("username", "filepath"): "accessed",
    ("username", "service"): "managed",
    ("username", "email"): "associated_with",
    
    # IP relationships
    ("ipv4", "domain"): "resolved_to",
    ("ipv6", "domain"): "resolved_to",
    ("ipv4", "port"): "connected_on",
    ("ipv6", "port"): "connected_on",
    ("ipv4", "username"): "authenticated_as",
    ("ipv6", "username"): "authenticated_as",
    ("ipv4", "mac_address"): "has_mac",
    ("ipv6", "mac_address"): "has_mac",
    ("ipv4", "url"): "accessed_url",
    ("ipv6", "url"): "accessed_url",
    
    # URL relationships
    ("url", "domain"): "hosted_on",
    ("url", "ipv4"): "resolved_to",
    ("url", "filepath"): "downloaded_to",
    ("url", "command"): "fetched_by",
    
    # Email relationships
    ("email", "domain"): "domain_of",
    ("email", "username"): "belongs_to",
    ("email", "ipv4"): "sent_from",
    
    # Command relationships
    ("command", "filepath"): "accessed",
    ("command", "ipv4"): "contacted",
    ("command", "ipv6"): "contacted",
    ("command", "domain"): "contacted",
    ("command", "port"): "used_port",
    ("command", "url"): "fetched_url",
    ("command", "service"): "managed_service",
    ("command", "pid"): "has_pid",
    ("command", "base64"): "contains_encoded",
    
    # File relationships (for persistence, etc.)
    ("filepath", "filepath"): "linked_to",
    ("filepath", "command"): "executed",
    ("filepath", "username"): "owned_by",
    ("filepath", "cron"): "scheduled_by",
    ("filepath", "base64"): "contains_encoded",
    
    # Service relationships
    ("service", "filepath"): "config_at",
    ("service", "port"): "listens_on",
    ("service", "username"): "runs_as",
    ("service", "pid"): "has_pid",
    
    # Process relationships  
    ("pid", "username"): "run_by",
    ("pid", "command"): "executing",
    ("pid", "filepath"): "opened",
    
    # Cron relationships (persistence)
    ("cron", "command"): "executes",
    ("cron", "filepath"): "defined_in",
    ("cron", "username"): "owned_by",
    
    # SSH fingerprint relationships
    ("ssh_fingerprint", "username"): "authenticates",
    ("ssh_fingerprint", "ipv4"): "used_from",
    ("ssh_fingerprint", "ipv6"): "used_from",
    
    # MAC address relationships
    ("mac_address", "ipv4"): "assigned_to",
    ("mac_address", "ipv6"): "assigned_to",
    
    # Hash relationships
    ("hash", "filepath"): "hash_of",
    ("hash", "command"): "hash_of_output",
    ("hash", "url"): "hash_of_download",
    
    # Environment variable relationships
    ("env_var", "filepath"): "points_to",
    ("env_var", "command"): "used_in",
}

# Reverse relationships for bidirectional graph traversal
REVERSE_RELATIONSHIPS = {
    "executed": "executed_by",
    "connected_from": "connected_to",
    "accessed": "accessed_by",
    "resolved_to": "resolved_from",
    "connected_on": "accepting_connection",
    "authenticated_as": "authenticated",
    "contacted": "contacted_by",
    "used_port": "used_by",
    "linked_to": "linked_to",
    "owned_by": "owns",
    "hash_of": "has_hash",
    "hash_of_output": "produced_hash",
    # New relationship reverses
    "managed": "managed_by",
    "associated_with": "associated_with",
    "has_mac": "mac_of",
    "accessed_url": "accessed_from",
    "hosted_on": "hosts",
    "downloaded_to": "downloaded_from",
    "fetched_by": "fetched",
    "domain_of": "has_email",
    "belongs_to": "has_email",
    "sent_from": "sent_email",
    "fetched_url": "fetched_by",
    "managed_service": "managed_by",
    "has_pid": "pid_of",
    "contains_encoded": "encoded_in",
    "scheduled_by": "schedules",
    "config_at": "configures",
    "listens_on": "listened_by",
    "runs_as": "runs_service",
    "run_by": "owns_process",
    "executing": "executed_as",
    "opened": "opened_by",
    "executes": "executed_by",
    "defined_in": "defines",
    "authenticates": "authenticated_by",
    "used_from": "used_ssh_from",
    "assigned_to": "has_mac",
    "hash_of_download": "downloaded_with_hash",
    "points_to": "pointed_by",
    "used_in": "uses_env",
}


class GraphRAGService:
    """
    Service for building and querying entity relationship graphs.
    
    Features:
    - Automatic relationship extraction from entity co-occurrence
    - BFS/DFS graph traversal
    - Path finding between entities
    - Kill chain reconstruction
    - Subgraph extraction around entities of interest
    """
    
    def __init__(self):
        """Initialize the graph service."""
        # In-memory graph cache per session
        self._graph_cache: Dict[str, Dict] = {}
        self._cache_timestamps: Dict[str, datetime] = {}
        self._cache_ttl_seconds = 300  # 5 minute cache
    
    def build_relationships_for_session(self, session_id: str) -> Dict[str, int]:
        """
        Build entity relationships for an entire session.
        
        Analyzes entity co-occurrence in chunks to infer relationships.
        Call this after entity extraction during ingestion.
        
        Args:
            session_id: Session identifier
            
        Returns:
            Statistics about relationships created
        """
        logger.info(f"Building entity relationships for session {session_id}")
        
        # Get session
        session = Session.query.filter_by(session_id=session_id).first()
        if not session:
            logger.error(f"Session not found: {session_id}")
            return {"error": "Session not found", "relationships_created": 0}
        
        stats = {
            "chunks_processed": 0,
            "relationships_created": 0,
            "relationships_by_type": defaultdict(int)
        }
        
        # Get all chunks for this session that have entities
        chunks_with_entities = db.session.query(Chunk.chunk_id).filter(
            Chunk.session_id == session.id
        ).join(
            Entity, Entity.chunk_id == Chunk.chunk_id
        ).distinct().all()
        
        chunk_ids = [c[0] for c in chunks_with_entities]
        
        for chunk_id in chunk_ids:
            relationships = self._extract_relationships_from_chunk(
                session.id, chunk_id
            )
            stats["chunks_processed"] += 1
            stats["relationships_created"] += len(relationships)
            
            for rel in relationships:
                stats["relationships_by_type"][rel.relationship_type] += 1
        
        # Commit all relationships
        try:
            db.session.commit()
            logger.info(f"Created {stats['relationships_created']} relationships for session {session_id}")
        except Exception as e:
            db.session.rollback()
            logger.error(f"Failed to commit relationships: {e}")
            return {"error": str(e), "relationships_created": 0}
        
        # Invalidate cache
        self._invalidate_cache(session_id)
        
        return {
            "chunks_processed": stats["chunks_processed"],
            "relationships_created": stats["relationships_created"],
            "relationships_by_type": dict(stats["relationships_by_type"])
        }
    
    def _extract_relationships_from_chunk(
        self, session_db_id: int, chunk_id: str
    ) -> List[EntityRelationship]:
        """
        Extract relationships from entity co-occurrence in a chunk.
        
        Args:
            session_db_id: Database ID of the session
            chunk_id: Chunk identifier
            
        Returns:
            List of EntityRelationship objects (not yet committed)
        """
        # Get all entities in this chunk
        entities = Entity.query.filter_by(chunk_id=chunk_id).all()
        
        if len(entities) < 2:
            return []
        
        # Get chunk content for context extraction
        chunk = Chunk.query.filter_by(chunk_id=chunk_id).first()
        chunk_content = chunk.content if chunk else ""
        
        relationships = []
        seen_pairs = set()  # Avoid duplicate relationships
        
        # Compare all entity pairs
        for i, source_entity in enumerate(entities):
            for target_entity in entities[i+1:]:
                # Skip self-relationships
                if source_entity.id == target_entity.id:
                    continue
                
                # Skip if we've seen this pair
                pair_key = (min(source_entity.id, target_entity.id), 
                           max(source_entity.id, target_entity.id))
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)
                
                # Infer relationship type
                rel_type = self._infer_relationship_type(
                    source_entity.entity_type,
                    target_entity.entity_type
                )
                
                if rel_type:
                    # Extract evidence snippet
                    evidence = self._extract_evidence_snippet(
                        chunk_content,
                        source_entity.entity_value,
                        target_entity.entity_value
                    )
                    
                    # Create relationship
                    relationship = EntityRelationship(
                        session_id=session_db_id,
                        source_entity_id=source_entity.id,
                        target_entity_id=target_entity.id,
                        relationship_type=rel_type,
                        confidence=self._calculate_confidence(
                            source_entity, target_entity, chunk_content
                        ),
                        evidence_chunk_id=chunk_id,
                        evidence_snippet=evidence
                    )
                    
                    # Check for duplicates before adding
                    existing = EntityRelationship.query.filter_by(
                        source_entity_id=source_entity.id,
                        target_entity_id=target_entity.id,
                        relationship_type=rel_type,
                        evidence_chunk_id=chunk_id
                    ).first()
                    
                    if not existing:
                        db.session.add(relationship)
                        relationships.append(relationship)
        
        return relationships
    
    def _infer_relationship_type(
        self, source_type: str, target_type: str
    ) -> Optional[str]:
        """
        Infer relationship type from entity type pair.
        
        Args:
            source_type: Type of source entity (ipv4, username, etc.)
            target_type: Type of target entity
            
        Returns:
            Relationship type string or None if no rule matches
        """
        # Normalize IP types
        source_normalized = "ipv4" if source_type in ("ipv4", "ipv6") else source_type
        target_normalized = "ipv4" if target_type in ("ipv4", "ipv6") else target_type
        
        # Direct lookup
        key = (source_normalized, target_normalized)
        if key in RELATIONSHIP_RULES:
            return RELATIONSHIP_RULES[key]
        
        # Try reverse
        reverse_key = (target_normalized, source_normalized)
        if reverse_key in RELATIONSHIP_RULES:
            rel_type = RELATIONSHIP_RULES[reverse_key]
            return REVERSE_RELATIONSHIPS.get(rel_type, f"related_to")
        
        # Generic fallback for co-occurrence
        return "co_occurs_with"
    
    def _calculate_confidence(
        self, source: Entity, target: Entity, content: str
    ) -> float:
        """
        Calculate confidence score for a relationship.
        
        Higher confidence when:
        - Entities are close together in content
        - Pattern-specific keywords are present
        - Source type is more specific (username vs generic)
        """
        confidence = 0.5  # Base confidence
        
        # Boost if entities are close together (within 100 chars)
        source_pos = content.lower().find(source.entity_value.lower())
        target_pos = content.lower().find(target.entity_value.lower())
        
        if source_pos >= 0 and target_pos >= 0:
            distance = abs(source_pos - target_pos)
            if distance < 50:
                confidence += 0.3
            elif distance < 100:
                confidence += 0.2
            elif distance < 200:
                confidence += 0.1
        
        # Boost for relationship-indicating keywords
        content_lower = content.lower()
        keywords = {
            "executed": ["ran", "exec", "command", "sudo", "run"],
            "connected_from": ["login", "ssh", "auth", "from", "connected"],
            "accessed": ["read", "write", "open", "access", "chmod"],
            "downloaded": ["wget", "curl", "download", "fetch"],
        }
        
        for rel_type, words in keywords.items():
            if any(word in content_lower for word in words):
                confidence += 0.1
                break
        
        return min(confidence, 1.0)
    
    def _extract_evidence_snippet(
        self, content: str, source_value: str, target_value: str, 
        max_length: int = 200
    ) -> str:
        """
        Extract a snippet showing both entities in context.
        
        Args:
            content: Full chunk content
            source_value: Source entity value
            target_value: Target entity value
            max_length: Maximum snippet length
            
        Returns:
            Snippet string
        """
        content_lower = content.lower()
        source_pos = content_lower.find(source_value.lower())
        target_pos = content_lower.find(target_value.lower())
        
        if source_pos < 0 or target_pos < 0:
            # Fallback to first part of content
            return content[:max_length] + "..." if len(content) > max_length else content
        
        # Get range encompassing both entities
        start = min(source_pos, target_pos)
        end = max(source_pos + len(source_value), target_pos + len(target_value))
        
        # Expand to include some context
        context_padding = 40
        start = max(0, start - context_padding)
        end = min(len(content), end + context_padding)
        
        # Find newline boundaries
        while start > 0 and content[start-1] not in '\n\r':
            start -= 1
            if start <= max(0, min(source_pos, target_pos) - 60):
                break
        
        while end < len(content) and content[end] not in '\n\r':
            end += 1
            if end >= min(len(content), max(source_pos, target_pos) + max_length - 60):
                break
        
        snippet = content[start:end].strip()
        
        # Truncate if too long
        if len(snippet) > max_length:
            snippet = snippet[:max_length] + "..."
        
        return snippet
    
    def _invalidate_cache(self, session_id: str):
        """Invalidate cached graph for a session."""
        if session_id in self._graph_cache:
            del self._graph_cache[session_id]
        if session_id in self._cache_timestamps:
            del self._cache_timestamps[session_id]
    
    def _get_or_build_graph(self, session_id: str) -> Dict:
        """
        Get cached graph or build it from database.
        
        Returns dict with:
        - nodes: Dict[entity_id -> entity_info]
        - edges: Dict[entity_id -> List[{target_id, relationship_type, evidence}]]
        """
        # Check cache
        now = datetime.utcnow()
        if session_id in self._graph_cache:
            cached_time = self._cache_timestamps.get(session_id, now)
            if (now - cached_time).total_seconds() < self._cache_ttl_seconds:
                return self._graph_cache[session_id]
        
        # Build graph
        session = Session.query.filter_by(session_id=session_id).first()
        if not session:
            return {"nodes": {}, "edges": defaultdict(list), "reverse_edges": defaultdict(list)}
        
        # Load entities (cap at 2000 to prevent memory/time issues)
        entities = Entity.query.filter_by(session_id=session.id).limit(2000).all()
        nodes = {
            e.id: {
                "id": e.id,
                "type": e.entity_type,
                "value": e.entity_value,
                "normalized": e.normalized_value,
                "chunk_id": e.chunk_id
            }
            for e in entities
        }
        
        node_ids = set(nodes.keys())
        
        # Load relationships (cap at 5000 to prevent memory/time issues)
        relationships = EntityRelationship.query.filter_by(session_id=session.id).limit(5000).all()
        edges = defaultdict(list)
        reverse_edges = defaultdict(list)
        
        for rel in relationships:
            if rel.source_entity_id not in node_ids or rel.target_entity_id not in node_ids:
                continue
            edge_info = {
                "target_id": rel.target_entity_id,
                "relationship_type": rel.relationship_type,
                "confidence": rel.confidence,
                "evidence": rel.evidence_snippet,
                "chunk_id": rel.evidence_chunk_id
            }
            edges[rel.source_entity_id].append(edge_info)
            
            # Reverse edge for bidirectional traversal
            reverse_edge = {
                "target_id": rel.source_entity_id,
                "relationship_type": REVERSE_RELATIONSHIPS.get(
                    rel.relationship_type, f"reverse_{rel.relationship_type}"
                ),
                "confidence": rel.confidence,
                "evidence": rel.evidence_snippet,
                "chunk_id": rel.evidence_chunk_id
            }
            reverse_edges[rel.target_entity_id].append(reverse_edge)
        
        graph = {
            "nodes": nodes,
            "edges": dict(edges),
            "reverse_edges": dict(reverse_edges)
        }
        
        # Cache
        self._graph_cache[session_id] = graph
        self._cache_timestamps[session_id] = now
        
        return graph
    
    def get_entity_neighbors(
        self, session_id: str, entity_value: str, 
        max_depth: int = 1, entity_type: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get all entities connected to the given entity.
        
        Args:
            session_id: Session identifier
            entity_value: Entity value to start from
            max_depth: How many hops to traverse (1 = direct neighbors only)
            entity_type: Optional filter for entity type
            
        Returns:
            Dict with neighbors grouped by relationship type
        """
        graph = self._get_or_build_graph(session_id)
        
        # Find starting entity
        start_entity_id = None
        for entity_id, info in graph["nodes"].items():
            if info["normalized"] == entity_value.lower() or info["value"] == entity_value:
                if entity_type is None or info["type"] == entity_type:
                    start_entity_id = entity_id
                    break
        
        if start_entity_id is None:
            return {"error": "Entity not found", "neighbors": []}
        
        # BFS traversal
        visited = {start_entity_id}
        current_level = {start_entity_id}
        all_neighbors = []
        
        for depth in range(max_depth):
            next_level = set()
            for entity_id in current_level:
                # Forward edges
                for edge in graph.get("edges", {}).get(entity_id, []):
                    target_id = edge["target_id"]
                    if target_id not in visited:
                        visited.add(target_id)
                        next_level.add(target_id)
                        target_info = graph["nodes"].get(target_id, {})
                        all_neighbors.append({
                            "entity_id": target_id,
                            "entity_type": target_info.get("type"),
                            "entity_value": target_info.get("value"),
                            "relationship": edge["relationship_type"],
                            "confidence": edge["confidence"],
                            "evidence": edge["evidence"],
                            "depth": depth + 1,
                            "direction": "outgoing"
                        })
                
                # Reverse edges
                for edge in graph.get("reverse_edges", {}).get(entity_id, []):
                    target_id = edge["target_id"]
                    if target_id not in visited:
                        visited.add(target_id)
                        next_level.add(target_id)
                        target_info = graph["nodes"].get(target_id, {})
                        all_neighbors.append({
                            "entity_id": target_id,
                            "entity_type": target_info.get("type"),
                            "entity_value": target_info.get("value"),
                            "relationship": edge["relationship_type"],
                            "confidence": edge["confidence"],
                            "evidence": edge["evidence"],
                            "depth": depth + 1,
                            "direction": "incoming"
                        })
            
            current_level = next_level
            if not current_level:
                break
        
        # Group by relationship type
        by_relationship = defaultdict(list)
        for neighbor in all_neighbors:
            by_relationship[neighbor["relationship"]].append(neighbor)
        
        return {
            "start_entity": {
                "value": entity_value,
                "type": graph["nodes"].get(start_entity_id, {}).get("type")
            },
            "total_neighbors": len(all_neighbors),
            "by_relationship": dict(by_relationship),
            "neighbors": all_neighbors
        }
    
    def find_path(
        self, session_id: str, 
        source_value: str, target_value: str,
        max_depth: int = 5
    ) -> Dict[str, Any]:
        """
        Find path between two entities in the graph.
        
        Args:
            session_id: Session identifier
            source_value: Starting entity value
            target_value: Target entity value
            max_depth: Maximum path length
            
        Returns:
            Dict with path information or error if no path found
        """
        graph = self._get_or_build_graph(session_id)
        
        # Find source and target entity IDs
        source_id = None
        target_id = None
        
        for entity_id, info in graph["nodes"].items():
            normalized = info.get("normalized", "").lower()
            value = info.get("value", "").lower()
            
            if normalized == source_value.lower() or value == source_value.lower():
                source_id = entity_id
            if normalized == target_value.lower() or value == target_value.lower():
                target_id = entity_id
            
            if source_id and target_id:
                break
        
        if source_id is None:
            return {"error": f"Source entity not found: {source_value}", "path": []}
        if target_id is None:
            return {"error": f"Target entity not found: {target_value}", "path": []}
        if source_id == target_id:
            return {"error": "Source and target are the same entity", "path": []}
        
        # BFS to find shortest path
        from collections import deque
        
        queue = deque([(source_id, [source_id], [])])  # (current_id, path, relationships)
        visited = {source_id}
        
        while queue:
            current_id, path, relationships = queue.popleft()
            
            if len(path) > max_depth:
                continue
            
            # Check forward edges
            for edge in graph.get("edges", {}).get(current_id, []):
                next_id = edge["target_id"]
                
                if next_id == target_id:
                    # Found path!
                    final_path = path + [next_id]
                    final_rels = relationships + [{
                        "from": current_id,
                        "to": next_id,
                        "type": edge["relationship_type"],
                        "evidence": edge["evidence"]
                    }]
                    return self._format_path(graph, final_path, final_rels)
                
                if next_id not in visited:
                    visited.add(next_id)
                    new_rels = relationships + [{
                        "from": current_id,
                        "to": next_id,
                        "type": edge["relationship_type"],
                        "evidence": edge["evidence"]
                    }]
                    queue.append((next_id, path + [next_id], new_rels))
            
            # Check reverse edges
            for edge in graph.get("reverse_edges", {}).get(current_id, []):
                next_id = edge["target_id"]
                
                if next_id == target_id:
                    # Found path!
                    final_path = path + [next_id]
                    final_rels = relationships + [{
                        "from": current_id,
                        "to": next_id,
                        "type": edge["relationship_type"],
                        "evidence": edge["evidence"]
                    }]
                    return self._format_path(graph, final_path, final_rels)
                
                if next_id not in visited:
                    visited.add(next_id)
                    new_rels = relationships + [{
                        "from": current_id,
                        "to": next_id,
                        "type": edge["relationship_type"],
                        "evidence": edge["evidence"]
                    }]
                    queue.append((next_id, path + [next_id], new_rels))
        
        return {"error": "No path found between entities", "path": []}
    
    def _format_path(
        self, graph: Dict, path: List[int], relationships: List[Dict]
    ) -> Dict[str, Any]:
        """Format path for API response."""
        path_entities = []
        for entity_id in path:
            info = graph["nodes"].get(entity_id, {})
            path_entities.append({
                "entity_id": entity_id,
                "entity_type": info.get("type"),
                "entity_value": info.get("value")
            })
        
        # Build human-readable path
        readable_path = []
        for i, rel in enumerate(relationships):
            from_info = graph["nodes"].get(rel["from"], {})
            to_info = graph["nodes"].get(rel["to"], {})
            readable_path.append(
                f"{from_info.get('value', '?')} --{rel['type']}--> {to_info.get('value', '?')}"
            )
        
        return {
            "found": True,
            "path_length": len(path),
            "path": path_entities,
            "relationships": relationships,
            "readable_path": " → ".join([p.split(" --")[0] for p in readable_path]) + 
                            f" → {path_entities[-1]['entity_value']}" if readable_path else "",
            "narrative": self._generate_path_narrative(graph, path, relationships)
        }
    
    def _generate_path_narrative(
        self, graph: Dict, path: List[int], relationships: List[Dict]
    ) -> str:
        """Generate human-readable narrative of the path."""
        if not relationships:
            return ""
        
        narrative_parts = []
        for rel in relationships:
            from_info = graph["nodes"].get(rel["from"], {})
            to_info = graph["nodes"].get(rel["to"], {})
            
            from_val = from_info.get("value", "unknown")
            to_val = to_info.get("value", "unknown")
            rel_type = rel["type"]
            
            # Generate natural language
            if rel_type == "executed":
                narrative_parts.append(f"{from_val} executed {to_val}")
            elif rel_type == "connected_from":
                narrative_parts.append(f"{from_val} connected from {to_val}")
            elif rel_type == "authenticated_as":
                narrative_parts.append(f"{from_val} authenticated as {to_val}")
            elif rel_type == "accessed":
                narrative_parts.append(f"{from_val} accessed {to_val}")
            elif rel_type == "contacted":
                narrative_parts.append(f"{from_val} contacted {to_val}")
            elif rel_type == "downloaded_to":
                narrative_parts.append(f"{from_val} was downloaded to {to_val}")
            else:
                narrative_parts.append(f"{from_val} {rel_type} {to_val}")
        
        return "; ".join(narrative_parts)
    
    def get_graph_stats(self, session_id: str) -> Dict[str, Any]:
        """
        Get statistics about the entity graph for a session.
        
        Returns:
            Dict with node/edge counts, top entities, relationship types
        """
        graph = self._get_or_build_graph(session_id)
        
        # Count edges
        total_edges = sum(len(edges) for edges in graph.get("edges", {}).values())
        
        # Count relationship types
        rel_types = defaultdict(int)
        for edges in graph.get("edges", {}).values():
            for edge in edges:
                rel_types[edge["relationship_type"]] += 1
        
        # Find most connected entities
        connection_counts = defaultdict(int)
        for entity_id in graph.get("nodes", {}).keys():
            connection_counts[entity_id] = len(graph.get("edges", {}).get(entity_id, []))
            connection_counts[entity_id] += len(graph.get("reverse_edges", {}).get(entity_id, []))
        
        top_entities = sorted(
            connection_counts.items(), 
            key=lambda x: x[1], 
            reverse=True
        )[:10]
        
        top_entities_formatted = [
            {
                "entity_value": graph["nodes"].get(eid, {}).get("value"),
                "entity_type": graph["nodes"].get(eid, {}).get("type"),
                "connection_count": count
            }
            for eid, count in top_entities
        ]
        
        return {
            "total_nodes": len(graph.get("nodes", {})),
            "total_edges": total_edges,
            "relationship_types": dict(rel_types),
            "top_connected_entities": top_entities_formatted
        }
    
    def get_kill_chain(
        self, session_id: str, 
        start_indicators: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Attempt to reconstruct attack kill chain from entity relationships.
        
        Uses heuristics to identify attack stages:
        1. Initial Access (external IPs, failed logins)
        2. Execution (commands, scripts)
        3. Persistence (cron, systemd, startup files)
        4. Data Access (sensitive files)
        5. Exfiltration (outbound connections)
        
        Args:
            session_id: Session identifier
            start_indicators: Optional list of known-bad indicators to start from
            
        Returns:
            Dict with potential kill chain stages
        """
        graph = self._get_or_build_graph(session_id)
        
        kill_chain = {
            "initial_access": [],
            "execution": [],
            "persistence": [],
            "privilege_escalation": [],
            "data_access": [],
            "exfiltration": [],
            "unknown": []
        }
        
        # Classify entities based on type and relationships
        for entity_id, info in graph["nodes"].items():
            entity_type = info.get("type", "")
            entity_value = info.get("value", "")
            relationships = graph.get("edges", {}).get(entity_id, [])
            
            # Check for initial access indicators
            if entity_type in ("ipv4", "ipv6"):
                # External IPs with auth activity
                if any(r["relationship_type"] == "authenticated_as" for r in relationships):
                    kill_chain["initial_access"].append({
                        "entity": info,
                        "evidence": "IP authenticated to system"
                    })
            
            # Check for execution
            if entity_type == "command":
                cmd_lower = entity_value.lower()
                if any(x in cmd_lower for x in ["wget", "curl", "nc", "bash", "sh", "python"]):
                    kill_chain["execution"].append({
                        "entity": info,
                        "evidence": f"Suspicious command: {entity_value[:50]}"
                    })
                
                # Persistence commands
                if any(x in cmd_lower for x in ["crontab", "systemctl", "chmod +x", "useradd"]):
                    kill_chain["persistence"].append({
                        "entity": info,
                        "evidence": f"Persistence command: {entity_value[:50]}"
                    })
                
                # Privilege escalation
                if any(x in cmd_lower for x in ["sudo", "su ", "passwd", "visudo"]):
                    kill_chain["privilege_escalation"].append({
                        "entity": info,
                        "evidence": f"Privilege command: {entity_value[:50]}"
                    })
            
            # Check for sensitive file access
            if entity_type == "filepath":
                path_lower = entity_value.lower()
                if any(x in path_lower for x in ["/etc/passwd", "/etc/shadow", ".ssh", ".bash_history"]):
                    kill_chain["data_access"].append({
                        "entity": info,
                        "evidence": f"Sensitive file access: {entity_value}"
                    })
                
                # Temp files often used in attacks
                if "/tmp/" in path_lower or "/var/tmp/" in path_lower:
                    kill_chain["execution"].append({
                        "entity": info,
                        "evidence": f"Temp file usage: {entity_value}"
                    })
        
        # Remove empty stages
        kill_chain = {k: v for k, v in kill_chain.items() if v}
        
        return {
            "stages_detected": len(kill_chain),
            "kill_chain": kill_chain,
            "summary": self._generate_kill_chain_summary(kill_chain)
        }
    
    def _generate_kill_chain_summary(self, kill_chain: Dict) -> str:
        """Generate summary of detected kill chain stages."""
        if not kill_chain:
            return "No clear attack indicators found in entity relationships."
        
        parts = []
        stage_order = ["initial_access", "execution", "persistence", 
                       "privilege_escalation", "data_access", "exfiltration"]
        
        for stage in stage_order:
            if stage in kill_chain:
                count = len(kill_chain[stage])
                stage_name = stage.replace("_", " ").title()
                parts.append(f"{stage_name}: {count} indicator(s)")
        
        return " → ".join(parts)


# Singleton instance
_graph_rag_service = None


def get_graph_rag_service() -> GraphRAGService:
    """Get or create singleton GraphRAGService instance."""
    global _graph_rag_service
    if _graph_rag_service is None:
        _graph_rag_service = GraphRAGService()
    return _graph_rag_service
