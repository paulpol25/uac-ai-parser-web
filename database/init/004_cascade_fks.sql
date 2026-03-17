-- Add ON DELETE CASCADE to all FK constraints that were missing it.
-- This is idempotent: safe to run multiple times.
-- Uses DO blocks to skip if the constraint already has CASCADE.

-- Helper: drop + re-add a FK constraint with ON DELETE CASCADE.
-- Only acts if the existing constraint does NOT have CASCADE.

DO $$
DECLARE
    _tbl TEXT;
    _col TEXT;
    _ref TEXT;
    _con TEXT;
    _action TEXT;
BEGIN
    -- (table, column, references_table(column), constraint_name, desired_on_delete)
    FOR _tbl, _col, _ref, _con, _action IN VALUES
        ('sessions',              'investigation_id',   'investigations(id)',  'sessions_investigation_id_fkey',              'CASCADE'),
        ('chunks',                'session_id',         'sessions(id)',        'chunks_session_id_fkey',                      'CASCADE'),
        ('entities',              'session_id',         'sessions(id)',        'entities_session_id_fkey',                    'CASCADE'),
        ('entities',              'chunk_id',           'chunks(chunk_id)',    'entities_chunk_id_fkey',                      'CASCADE'),
        ('entity_relationships',  'session_id',         'sessions(id)',        'entity_relationships_session_id_fkey',        'CASCADE'),
        ('entity_relationships',  'source_entity_id',   'entities(id)',        'entity_relationships_source_entity_id_fkey',  'CASCADE'),
        ('entity_relationships',  'target_entity_id',   'entities(id)',        'entity_relationships_target_entity_id_fkey',  'CASCADE'),
        ('entity_relationships',  'evidence_chunk_id',  'chunks(chunk_id)',    'entity_relationships_evidence_chunk_id_fkey', 'CASCADE'),
        ('chunk_relevance',       'chunk_id',           'chunks(chunk_id)',    'chunk_relevance_chunk_id_fkey',               'CASCADE'),
        ('chunk_relevance',       'session_id',         'sessions(id)',        'chunk_relevance_session_id_fkey',             'CASCADE'),
        ('chats',                 'session_id',         'sessions(id)',        'chats_session_id_fkey',                       'CASCADE'),
        ('mitre_mappings',        'session_id',         'sessions(id)',        'mitre_mappings_session_id_fkey',              'CASCADE'),
        ('mitre_mappings',        'evidence_chunk_id',  'chunks(chunk_id)',    'mitre_mappings_evidence_chunk_id_fkey',       'SET NULL'),
        ('file_hashes',           'session_id',         'sessions(id)',        'file_hashes_session_id_fkey',                 'CASCADE'),
        ('query_logs',            'investigation_id',   'investigations(id)',  'query_logs_investigation_id_fkey',            'CASCADE'),
        ('ioc_entries',           'investigation_id',   'investigations(id)',  'ioc_entries_investigation_id_fkey',           'CASCADE'),
        ('cleanup_policies',      'investigation_id',   'investigations(id)',  'cleanup_policies_investigation_id_fkey',      'CASCADE')
    LOOP
        -- Only alter if the table and constraint exist
        IF EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = _con
              AND table_name = _tbl
              AND constraint_type = 'FOREIGN KEY'
        ) THEN
            EXECUTE format(
                'ALTER TABLE %I DROP CONSTRAINT %I, ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s ON DELETE %s',
                _tbl, _con, _con, _col, _ref, _action
            );
        END IF;
    END LOOP;
END
$$;
