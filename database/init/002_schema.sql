-- UAC AI Parser - Database Schema
-- This script creates all tables if they don't already exist.
-- Flask-Migrate (Alembic) handles subsequent migrations.

-- Users
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(80) UNIQUE NOT NULL,
    email VARCHAR(120) UNIQUE NOT NULL,
    password_hash VARCHAR(256) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    last_login TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

-- Auth tokens
CREATE TABLE IF NOT EXISTS auth_tokens (
    id SERIAL PRIMARY KEY,
    token VARCHAR(64) UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_token ON auth_tokens (token);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens (user_id);

-- Investigations
CREATE TABLE IF NOT EXISTS investigations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    case_number VARCHAR(100),
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_investigations_case ON investigations (case_number);
CREATE INDEX IF NOT EXISTS idx_investigations_user ON investigations (user_id);

-- Sessions (parsing sessions / UAC uploads)
CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(36) UNIQUE NOT NULL,
    investigation_id INTEGER NOT NULL REFERENCES investigations(id),
    original_filename VARCHAR(255) NOT NULL,
    file_hash VARCHAR(64),
    file_size BIGINT,
    total_artifacts INTEGER DEFAULT 0,
    total_chunks INTEGER DEFAULT 0,
    parsed_at TIMESTAMP DEFAULT NOW(),
    archive_path VARCHAR(500),
    extract_path VARCHAR(500),
    status VARCHAR(20) DEFAULT 'processing',
    error_message TEXT,
    hostname VARCHAR(255),
    os_type VARCHAR(50),
    collection_date TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions (session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_investigation ON sessions (investigation_id);

-- Chunks (Tier 1 warm storage)
CREATE TABLE IF NOT EXISTS chunks (
    id SERIAL PRIMARY KEY,
    chunk_id VARCHAR(64) UNIQUE NOT NULL,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    content TEXT NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    token_count INTEGER NOT NULL,
    source_file VARCHAR(500) NOT NULL,
    source_type VARCHAR(50) NOT NULL,
    section VARCHAR(100),
    artifact_category VARCHAR(50),
    file_modified TIMESTAMP,
    importance_score FLOAT DEFAULT 0.0,
    access_count INTEGER DEFAULT 0,
    last_accessed TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chunks_chunk_id ON chunks (chunk_id);
CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks (session_id);
CREATE INDEX IF NOT EXISTS idx_chunks_source_file ON chunks (source_file);
CREATE INDEX IF NOT EXISTS idx_chunks_source_type ON chunks (source_type);
CREATE INDEX IF NOT EXISTS idx_chunks_artifact_category ON chunks (artifact_category);
CREATE INDEX IF NOT EXISTS idx_chunk_source_type_category ON chunks (source_type, artifact_category);
CREATE INDEX IF NOT EXISTS idx_chunk_session_category ON chunks (session_id, artifact_category);

-- Entities
CREATE TABLE IF NOT EXISTS entities (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    chunk_id VARCHAR(64) NOT NULL REFERENCES chunks(chunk_id),
    entity_type VARCHAR(30) NOT NULL,
    entity_value VARCHAR(500) NOT NULL,
    normalized_value VARCHAR(500),
    context_snippet VARCHAR(200),
    occurrence_count INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_entities_session ON entities (session_id);
CREATE INDEX IF NOT EXISTS idx_entities_chunk ON entities (chunk_id);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities (entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_value ON entities (entity_value);
CREATE INDEX IF NOT EXISTS idx_entities_norm ON entities (normalized_value);
CREATE INDEX IF NOT EXISTS idx_entity_session_type ON entities (session_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_entity_value_type ON entities (normalized_value, entity_type);
CREATE INDEX IF NOT EXISTS idx_entity_session_value ON entities (session_id, normalized_value);

-- Entity relationships (Graph RAG)
CREATE TABLE IF NOT EXISTS entity_relationships (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    source_entity_id INTEGER NOT NULL REFERENCES entities(id),
    target_entity_id INTEGER NOT NULL REFERENCES entities(id),
    relationship_type VARCHAR(50) NOT NULL,
    confidence FLOAT DEFAULT 1.0,
    evidence_chunk_id VARCHAR(64) NOT NULL REFERENCES chunks(chunk_id),
    evidence_snippet VARCHAR(300),
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_entity_relationship UNIQUE (source_entity_id, target_entity_id, relationship_type, evidence_chunk_id)
);
CREATE INDEX IF NOT EXISTS idx_rel_session_source ON entity_relationships (session_id, source_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_session_target ON entity_relationships (session_id, target_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_type_source ON entity_relationships (relationship_type, source_entity_id);

-- Query logs (with cached responses)
CREATE TABLE IF NOT EXISTS query_logs (
    id SERIAL PRIMARY KEY,
    investigation_id INTEGER NOT NULL REFERENCES investigations(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    query_text TEXT NOT NULL,
    query_hash VARCHAR(64) NOT NULL,
    query_type VARCHAR(20) DEFAULT 'chat',
    response_text TEXT,
    response_cached BOOLEAN DEFAULT FALSE,
    chunks_retrieved INTEGER DEFAULT 0,
    chunk_ids TEXT,
    retrieval_time_ms INTEGER,
    generation_time_ms INTEGER,
    model_used VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_query_logs_investigation ON query_logs (investigation_id);
CREATE INDEX IF NOT EXISTS idx_query_logs_user ON query_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_query_logs_hash ON query_logs (query_hash);

-- Chunk relevance feedback
CREATE TABLE IF NOT EXISTS chunk_relevance (
    id SERIAL PRIMARY KEY,
    chunk_id VARCHAR(64) NOT NULL REFERENCES chunks(chunk_id),
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    citation_count INTEGER DEFAULT 0,
    usage_count INTEGER DEFAULT 0,
    retrieval_count INTEGER DEFAULT 0,
    relevance_score FLOAT DEFAULT 0.0,
    useful_for_topics TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_chunk_relevance_chunk UNIQUE (chunk_id)
);
CREATE INDEX IF NOT EXISTS idx_chunk_relevance_session_score ON chunk_relevance (session_id, relevance_score);

-- Chats
CREATE TABLE IF NOT EXISTS chats (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    title VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chats_session ON chats (session_id);
CREATE INDEX IF NOT EXISTS idx_chats_user ON chats (user_id);

-- Chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    sources TEXT,
    reasoning_steps TEXT,
    model_used VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages (chat_id);

-- MITRE ATT&CK mappings
CREATE TABLE IF NOT EXISTS mitre_mappings (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    technique_id VARCHAR(20) NOT NULL,
    technique_name VARCHAR(200) NOT NULL,
    tactic VARCHAR(50) NOT NULL,
    confidence FLOAT DEFAULT 0.5,
    evidence_chunk_id VARCHAR(64) REFERENCES chunks(chunk_id),
    evidence_snippet TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mitre_session ON mitre_mappings (session_id);
CREATE INDEX IF NOT EXISTS idx_mitre_technique ON mitre_mappings (technique_id);
CREATE INDEX IF NOT EXISTS idx_mitre_tactic ON mitre_mappings (tactic);
CREATE INDEX IF NOT EXISTS idx_mitre_session_tactic ON mitre_mappings (session_id, tactic);

-- IOC entries (cross-session)
CREATE TABLE IF NOT EXISTS ioc_entries (
    id SERIAL PRIMARY KEY,
    investigation_id INTEGER NOT NULL REFERENCES investigations(id),
    ioc_type VARCHAR(30) NOT NULL,
    value VARCHAR(500) NOT NULL,
    normalized_value VARCHAR(500) NOT NULL,
    geo_country VARCHAR(100),
    geo_city VARCHAR(100),
    geo_asn VARCHAR(200),
    session_ids TEXT,
    first_seen TIMESTAMP,
    last_seen TIMESTAMP,
    occurrence_count INTEGER DEFAULT 1,
    mitre_technique_ids TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_ioc_entry UNIQUE (investigation_id, ioc_type, normalized_value)
);
CREATE INDEX IF NOT EXISTS idx_ioc_investigation ON ioc_entries (investigation_id);
CREATE INDEX IF NOT EXISTS idx_ioc_type ON ioc_entries (ioc_type);
CREATE INDEX IF NOT EXISTS idx_ioc_value ON ioc_entries (value);
CREATE INDEX IF NOT EXISTS idx_ioc_norm ON ioc_entries (normalized_value);
CREATE INDEX IF NOT EXISTS idx_ioc_investigation_type ON ioc_entries (investigation_id, ioc_type);

-- File hashes
CREATE TABLE IF NOT EXISTS file_hashes (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    file_path VARCHAR(500) NOT NULL,
    hash_md5 VARCHAR(32),
    hash_sha1 VARCHAR(40),
    hash_sha256 VARCHAR(64),
    file_size BIGINT,
    is_known_good BOOLEAN,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_filehash_session ON file_hashes (session_id);
CREATE INDEX IF NOT EXISTS idx_filehash_md5 ON file_hashes (hash_md5);
CREATE INDEX IF NOT EXISTS idx_filehash_sha1 ON file_hashes (hash_sha1);
CREATE INDEX IF NOT EXISTS idx_filehash_sha256 ON file_hashes (hash_sha256);

-- Cleanup policies
CREATE TABLE IF NOT EXISTS cleanup_policies (
    id SERIAL PRIMARY KEY,
    investigation_id INTEGER UNIQUE REFERENCES investigations(id),
    retention_days INTEGER DEFAULT 90,
    delete_extracted_after_parse BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
