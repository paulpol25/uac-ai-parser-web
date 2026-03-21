-- RBAC: add role column to users table
-- Roles: admin, operator, viewer
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'operator';

-- Operator permissions — JSON column stores granted permissions per operator.
-- Admins have all permissions implicitly; viewers have none.
-- Example: {"dispatch_commands": true, "manage_agents": true, "delete_investigations": false}
ALTER TABLE users ADD COLUMN IF NOT EXISTS operator_permissions JSONB DEFAULT '{}';

-- Custom playbooks
CREATE TABLE IF NOT EXISTS playbooks (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    commands JSONB NOT NULL DEFAULT '[]',
    is_builtin BOOLEAN DEFAULT FALSE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_playbooks_name ON playbooks (name);

-- General settings key-value store (persisted in DB instead of JSON file)
CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW()
);
