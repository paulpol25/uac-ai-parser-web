-- Seed default admin user
-- Password: changeme (bcrypt hash)
-- The start.sh script will update the password from ADMIN_PASSWORD env var
INSERT INTO users (username, email, password_hash, created_at)
VALUES (
    'admin',
    'admin@uac-ai.local',
    -- This is a placeholder; the backend's auth provider hashes passwords at runtime
    'pbkdf2:sha256:600000$placeholder$0000000000000000000000000000000000000000000000000000000000000000',
    NOW()
) ON CONFLICT (username) DO NOTHING;
