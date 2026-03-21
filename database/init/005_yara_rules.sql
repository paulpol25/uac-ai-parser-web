-- YARA rules management
CREATE TABLE IF NOT EXISTS yara_rules (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    filename VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    source VARCHAR(50) NOT NULL DEFAULT 'upload',  -- upload, elastic_github
    content TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_yara_rules_source ON yara_rules (source);
CREATE INDEX IF NOT EXISTS idx_yara_rules_enabled ON yara_rules (enabled);
