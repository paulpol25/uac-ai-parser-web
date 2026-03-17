-- UAC AI Parser - Agent Infrastructure Schema
-- Adds tables for remote agent management, command dispatch, and Sheetstorm integration.

-- Add Sheetstorm incident ID to investigations
ALTER TABLE investigations ADD COLUMN IF NOT EXISTS sheetstorm_incident_id VARCHAR(100);

-- Agents (deployed forensic collection agents)
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigation_id INTEGER NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    hostname VARCHAR(255),
    os_info VARCHAR(255),
    ip_address VARCHAR(45),
    status VARCHAR(20) NOT NULL DEFAULT 'registered',
    agent_version VARCHAR(20),
    api_key VARCHAR(128) UNIQUE NOT NULL,
    last_heartbeat TIMESTAMPTZ,
    registered_at TIMESTAMPTZ DEFAULT NOW(),
    config JSONB DEFAULT '{}',
    CONSTRAINT chk_agent_status CHECK (status IN (
        'registered', 'collecting', 'uploading', 'idle', 'offline', 'error'
    ))
);
CREATE INDEX IF NOT EXISTS idx_agents_investigation ON agents (investigation_id);
CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents (api_key);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents (status);

-- Agent commands (dispatched from backend to agent)
CREATE TABLE IF NOT EXISTS agent_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    command_type VARCHAR(30) NOT NULL,
    payload JSONB DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    result JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CONSTRAINT chk_command_type CHECK (command_type IN (
        'run_uac', 'exec_command', 'collect_file', 'run_check', 'shutdown'
    )),
    CONSTRAINT chk_command_status CHECK (status IN (
        'pending', 'running', 'completed', 'failed', 'cancelled'
    ))
);
CREATE INDEX IF NOT EXISTS idx_agent_commands_agent ON agent_commands (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_commands_status ON agent_commands (agent_id, status);

-- Agent events (audit log of agent activity)
CREATE TABLE IF NOT EXISTS agent_events (
    id SERIAL PRIMARY KEY,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_events_agent ON agent_events (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_type ON agent_events (agent_id, event_type);
CREATE INDEX IF NOT EXISTS idx_agent_events_created ON agent_events (created_at);
