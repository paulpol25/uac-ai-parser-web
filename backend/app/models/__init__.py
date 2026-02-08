"""
SQLAlchemy models for UAC AI Parser.

Database schema following RAG_DESIGN.md tiered storage principles:
- Tier 0 (Cold): Raw UAC archives in filesystem
- Tier 1 (Warm): Chunked text in SQLite with rich metadata
- Tier 2 (Vector): Embeddings in ChromaDB (no text duplication)
- Tier 3 (Hot): In-memory LRU cache for frequent chunks
"""
from datetime import datetime
from typing import Optional
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class User(db.Model):
    """User accounts for multi-user support."""
    __tablename__ = "users"
    
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime, nullable=True)
    
    # Relationships
    investigations = db.relationship("Investigation", back_populates="user", lazy="dynamic")
    
    def __repr__(self):
        return f"<User {self.username}>"


class Investigation(db.Model):
    """
    Top-level container for forensic investigations.
    An investigation can have multiple parsing sessions (different UAC uploads).
    """
    __tablename__ = "investigations"
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    case_number = db.Column(db.String(100), nullable=True, index=True)
    
    # Foreign keys
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Status
    status = db.Column(db.String(20), default="active")  # active, archived, deleted
    
    # Relationships
    user = db.relationship("User", back_populates="investigations")
    sessions = db.relationship("Session", back_populates="investigation", lazy="dynamic")
    queries = db.relationship("QueryLog", back_populates="investigation", lazy="dynamic")
    
    def __repr__(self):
        return f"<Investigation {self.name}>"


class Session(db.Model):
    """
    A parsing session - represents one uploaded UAC archive.
    Contains metadata about the parsed artifacts.
    """
    __tablename__ = "sessions"
    
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.String(36), unique=True, nullable=False, index=True)  # UUID
    
    # Foreign keys
    investigation_id = db.Column(db.Integer, db.ForeignKey("investigations.id"), nullable=False, index=True)
    
    # File info
    original_filename = db.Column(db.String(255), nullable=False)
    file_hash = db.Column(db.String(64), nullable=True)  # SHA256
    file_size = db.Column(db.BigInteger, nullable=True)
    
    # Parsing results
    total_artifacts = db.Column(db.Integer, default=0)
    total_chunks = db.Column(db.Integer, default=0)
    parsed_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Storage paths (Tier 0 - cold storage)
    archive_path = db.Column(db.String(500), nullable=True)
    extract_path = db.Column(db.String(500), nullable=True)
    
    # Status: processing -> searchable (chunks done) -> ready (embeddings done), or failed
    status = db.Column(db.String(20), default="processing")  # processing, searchable, ready, failed
    error_message = db.Column(db.Text, nullable=True)
    
    # System info extracted from UAC
    hostname = db.Column(db.String(255), nullable=True)
    os_type = db.Column(db.String(50), nullable=True)
    collection_date = db.Column(db.DateTime, nullable=True)
    
    # Relationships
    investigation = db.relationship("Investigation", back_populates="sessions")
    chunks = db.relationship("Chunk", back_populates="session", lazy="dynamic")
    
    def __repr__(self):
        return f"<Session {self.session_id}>"


class Chunk(db.Model):
    """
    Tier 1 (Warm) storage - chunked text with rich metadata.
    
    Following RAG_DESIGN.md:
    - Stores cleaned, chunked text
    - Rich metadata for pre-filtering
    - Optimized for fetch, not search
    - Vector embeddings stored separately in ChromaDB (Tier 2)
    """
    __tablename__ = "chunks"
    
    id = db.Column(db.Integer, primary_key=True)
    chunk_id = db.Column(db.String(64), unique=True, nullable=False, index=True)  # Hash-based ID
    
    # Foreign keys
    session_id = db.Column(db.Integer, db.ForeignKey("sessions.id"), nullable=False, index=True)
    
    # Content
    content = db.Column(db.Text, nullable=False)
    content_hash = db.Column(db.String(64), nullable=False)  # For deduplication
    token_count = db.Column(db.Integer, nullable=False)
    
    # Source metadata (for pre-filtering per RAG_DESIGN.md)
    source_file = db.Column(db.String(500), nullable=False, index=True)
    source_type = db.Column(db.String(50), nullable=False, index=True)  # log, config, user, network, etc.
    section = db.Column(db.String(100), nullable=True)
    
    # Forensic metadata
    artifact_category = db.Column(db.String(50), index=True)  # users, persistence, network, logs, etc.
    file_modified = db.Column(db.DateTime, nullable=True)
    importance_score = db.Column(db.Float, default=0.0)  # Heuristic importance
    
    # Access tracking (for hot cache promotion)
    access_count = db.Column(db.Integer, default=0)
    last_accessed = db.Column(db.DateTime, nullable=True)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    session = db.relationship("Session", back_populates="chunks")
    
    # Indexes for pre-filtering
    __table_args__ = (
        db.Index("idx_chunk_source_type_category", "source_type", "artifact_category"),
        db.Index("idx_chunk_session_category", "session_id", "artifact_category"),
    )
    
    def __repr__(self):
        return f"<Chunk {self.chunk_id[:8]}... from {self.source_file}>"


class Entity(db.Model):
    """
    Extracted entities from forensic artifacts (Phase 3 RAG improvement).
    
    Enables entity-aware queries like:
    - "Show all activity involving 192.168.1.100"
    - "What did user 'john' do?"
    - "Files modified in /tmp"
    
    Extracted at ingestion time via regex (fast, local, privacy-preserving).
    No LLM calls - pure pattern matching.
    """
    __tablename__ = "entities"
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Foreign keys - link to session AND specific chunk
    session_id = db.Column(db.Integer, db.ForeignKey("sessions.id"), nullable=False, index=True)
    chunk_id = db.Column(db.String(64), db.ForeignKey("chunks.chunk_id"), nullable=False, index=True)
    
    # Entity info
    entity_type = db.Column(db.String(30), nullable=False, index=True)  # ip, domain, username, filepath, command, timestamp
    entity_value = db.Column(db.String(500), nullable=False, index=True)  # The actual entity value
    normalized_value = db.Column(db.String(500), nullable=True, index=True)  # Lowercased/cleaned for matching
    
    # Context (where in the chunk this entity appears)
    context_snippet = db.Column(db.String(200), nullable=True)  # Surrounding text for preview
    
    # Frequency within chunk
    occurrence_count = db.Column(db.Integer, default=1)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Indexes for fast entity lookups
    __table_args__ = (
        db.Index("idx_entity_session_type", "session_id", "entity_type"),
        db.Index("idx_entity_value_type", "normalized_value", "entity_type"),
        db.Index("idx_entity_session_value", "session_id", "normalized_value"),
    )
    
    def __repr__(self):
        return f"<Entity {self.entity_type}:{self.entity_value[:30]}>"


class EntityRelationship(db.Model):
    """
    Graph RAG: Relationships between entities (Phase 5).
    
    Enables graph traversal queries like:
    - "What did user 'john' do?" → Follow all relationships from john
    - "What was the kill chain?" → Trace path from initial access to persistence
    - "How did the attacker reach this file?" → Find path between entities
    
    Relationships are inferred from entity co-occurrence in chunks:
    - User + Command in same chunk = "executed" relationship
    - IP + User in auth log = "authenticated_as" relationship
    - Command + Filepath = "accessed" or "created" relationship
    """
    __tablename__ = "entity_relationships"
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Foreign keys - link to session
    session_id = db.Column(db.Integer, db.ForeignKey("sessions.id"), nullable=False, index=True)
    
    # Source and target entities
    source_entity_id = db.Column(db.Integer, db.ForeignKey("entities.id"), nullable=False, index=True)
    target_entity_id = db.Column(db.Integer, db.ForeignKey("entities.id"), nullable=False, index=True)
    
    # Relationship metadata
    relationship_type = db.Column(db.String(50), nullable=False, index=True)  # executed, accessed, connected_from, created, modified, downloaded_to
    confidence = db.Column(db.Float, default=1.0)  # How confident we are in this relationship
    
    # Evidence
    evidence_chunk_id = db.Column(db.String(64), db.ForeignKey("chunks.chunk_id"), nullable=False)
    evidence_snippet = db.Column(db.String(300), nullable=True)  # Context showing the relationship
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships (ORM)
    source_entity = db.relationship("Entity", foreign_keys=[source_entity_id], backref="outgoing_relationships")
    target_entity = db.relationship("Entity", foreign_keys=[target_entity_id], backref="incoming_relationships")
    
    # Indexes for graph traversal
    __table_args__ = (
        db.Index("idx_rel_session_source", "session_id", "source_entity_id"),
        db.Index("idx_rel_session_target", "session_id", "target_entity_id"),
        db.Index("idx_rel_type_source", "relationship_type", "source_entity_id"),
        db.UniqueConstraint("source_entity_id", "target_entity_id", "relationship_type", "evidence_chunk_id", 
                          name="uq_entity_relationship"),
    )
    
    def __repr__(self):
        return f"<EntityRelationship {self.source_entity_id} --{self.relationship_type}--> {self.target_entity_id}>"


class QueryLog(db.Model):
    """
    Query history with cached responses.
    Enables answer caching per RAG_DESIGN.md performance strategy.
    """
    __tablename__ = "query_logs"
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Foreign keys
    investigation_id = db.Column(db.Integer, db.ForeignKey("investigations.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    
    # Query details
    query_text = db.Column(db.Text, nullable=False)
    query_hash = db.Column(db.String(64), nullable=False, index=True)  # For cache lookup
    query_type = db.Column(db.String(20), default="chat")  # chat, summary, anomalies
    
    # Response (cached)
    response_text = db.Column(db.Text, nullable=True)
    response_cached = db.Column(db.Boolean, default=False)
    
    # Retrieval metadata
    chunks_retrieved = db.Column(db.Integer, default=0)
    chunk_ids = db.Column(db.Text, nullable=True)  # JSON array of chunk IDs used
    retrieval_time_ms = db.Column(db.Integer, nullable=True)
    generation_time_ms = db.Column(db.Integer, nullable=True)
    
    # Model info
    model_used = db.Column(db.String(100), nullable=True)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    investigation = db.relationship("Investigation", back_populates="queries")
    
    def __repr__(self):
        return f"<QueryLog {self.query_text[:30]}...>"


class ChunkRelevance(db.Model):
    """
    Relevance Feedback: Track which chunks were actually useful in LLM responses.
    
    Phase 6 RAG improvement - learns which chunks are most valuable:
    - Tracks when chunks are cited/used in responses
    - Accumulates relevance score over time
    - Enables boosting high-value chunks in future queries
    
    Scores are updated when:
    1. LLM cites a chunk explicitly (highest boost)
    2. Chunk content appears in response (medium boost)
    3. User rates a response positively (all chunks get small boost)
    """
    __tablename__ = "chunk_relevance"
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Foreign keys
    chunk_id = db.Column(db.String(64), db.ForeignKey("chunks.chunk_id"), nullable=False, index=True)
    session_id = db.Column(db.Integer, db.ForeignKey("sessions.id"), nullable=False, index=True)
    
    # Relevance metrics
    citation_count = db.Column(db.Integer, default=0)  # Times explicitly cited
    usage_count = db.Column(db.Integer, default=0)  # Times content appeared in response
    retrieval_count = db.Column(db.Integer, default=0)  # Times retrieved (may not be used)
    
    # Computed relevance score (updated on each interaction)
    relevance_score = db.Column(db.Float, default=0.0, index=True)
    
    # Last query topics this chunk was useful for (helps learn preferences)
    useful_for_topics = db.Column(db.Text, nullable=True)  # JSON array of query keywords
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Indexes for efficient boosting
    __table_args__ = (
        db.Index("idx_chunk_relevance_session_score", "session_id", "relevance_score"),
        db.UniqueConstraint("chunk_id", name="uq_chunk_relevance_chunk"),
    )
    
    def update_score(self):
        """Recalculate relevance score from metrics."""
        # Citation is strongest signal, usage is medium, retrieval is weak
        self.relevance_score = (
            self.citation_count * 1.0 +
            self.usage_count * 0.5 +
            self.retrieval_count * 0.1
        )
        # Normalize to 0-1 range with sigmoid-like curve
        import math
        self.relevance_score = 1 - (1 / (1 + self.relevance_score))
    
    def __repr__(self):
        return f"<ChunkRelevance chunk={self.chunk_id[:8]} score={self.relevance_score:.2f}>"


class Chat(db.Model):
    """
    Chat conversation for a session.
    
    Enables multiple chat threads per session for different investigation topics.
    Each chat persists messages and can be resumed or deleted.
    """
    __tablename__ = "chats"
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Foreign keys
    session_id = db.Column(db.Integer, db.ForeignKey("sessions.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    
    # Chat metadata
    title = db.Column(db.String(255), nullable=True)  # Auto-generated from first message or user-set
    
    # Status
    is_active = db.Column(db.Boolean, default=True)  # False when deleted (soft delete)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    session = db.relationship("Session", backref=db.backref("chats", lazy="dynamic"))
    user = db.relationship("User", backref=db.backref("chats", lazy="dynamic"))
    messages = db.relationship("ChatMessage", back_populates="chat", lazy="dynamic", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<Chat {self.id} - {self.title or 'Untitled'}>"


class ChatMessage(db.Model):
    """
    Individual message in a chat conversation.
    
    Stores both user messages and AI responses with metadata.
    """
    __tablename__ = "chat_messages"
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Foreign keys
    chat_id = db.Column(db.Integer, db.ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Message content
    role = db.Column(db.String(20), nullable=False)  # 'user', 'assistant', 'system'
    content = db.Column(db.Text, nullable=False)
    
    # AI-specific metadata (for assistant messages)
    sources = db.Column(db.Text, nullable=True)  # JSON array of source references
    reasoning_steps = db.Column(db.Text, nullable=True)  # JSON array of agentic reasoning steps
    model_used = db.Column(db.String(100), nullable=True)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    chat = db.relationship("Chat", back_populates="messages")
    
    def __repr__(self):
        return f"<ChatMessage {self.role}: {self.content[:30]}...>"


# Export all models
__all__ = ["db", "User", "Investigation", "Session", "Chunk", "Entity", "EntityRelationship", "QueryLog", "ChunkRelevance", "Chat", "ChatMessage"]
