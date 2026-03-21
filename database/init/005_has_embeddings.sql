-- Add has_embeddings flag to sessions
-- Existing "ready" sessions are assumed to have embeddings (old behavior)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS has_embeddings BOOLEAN DEFAULT FALSE;
UPDATE sessions SET has_embeddings = TRUE WHERE status = 'ready';
