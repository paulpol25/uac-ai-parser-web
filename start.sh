#!/bin/bash
set -e

echo "==================================="
echo "UAC AI Parser — Forensic Analysis"
echo "==================================="

# ---------------------------------------------------------------
# Ensure persistent data directories exist
# ---------------------------------------------------------------
mkdir -p data/postgres data/redis

# ---------------------------------------------------------------
# Create .env from template if missing
# ---------------------------------------------------------------
if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "WARNING: Please update .env with secure values before production use!"
fi

# ---------------------------------------------------------------
# Auto-generate secrets if still set to defaults
# ---------------------------------------------------------------
source .env

if [ -z "$SECRET_KEY" ] || [ "$SECRET_KEY" = "dev-secret-key-change-in-production" ]; then
    echo "Generating SECRET_KEY..."
    NEW_SECRET=$(openssl rand -hex 32)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/SECRET_KEY=.*/SECRET_KEY=$NEW_SECRET/" .env
    else
        sed -i "s/SECRET_KEY=.*/SECRET_KEY=$NEW_SECRET/" .env
    fi
fi

if [ -z "$MCP_AUTH_TOKEN" ] || [ "$MCP_AUTH_TOKEN" = "changeme_generate_token" ]; then
    echo "Generating MCP_AUTH_TOKEN..."
    NEW_MCP_TOKEN=$(openssl rand -base64 32 | tr -d '=+/' | head -c 43)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|MCP_AUTH_TOKEN=.*|MCP_AUTH_TOKEN=$NEW_MCP_TOKEN|" .env
    else
        sed -i "s|MCP_AUTH_TOKEN=.*|MCP_AUTH_TOKEN=$NEW_MCP_TOKEN|" .env
    fi
fi

if [ -z "$POSTGRES_PASSWORD" ] || [ "$POSTGRES_PASSWORD" = "changeme" ]; then
    echo "Generating POSTGRES_PASSWORD..."
    NEW_PG_PASS=$(openssl rand -hex 16)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$NEW_PG_PASS/" .env
    else
        sed -i "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$NEW_PG_PASS/" .env
    fi
fi

echo ""
echo "Building containers..."
docker compose build

echo ""
echo "Starting services..."
docker compose up -d

echo ""
echo "Waiting for database to be ready..."
sleep 5

echo ""
echo "Running database migrations..."
docker compose exec -T backend flask db upgrade 2>/dev/null || echo "Migrations may have already run (or using init SQL)"

echo ""
echo "Seeding admin user..."
docker compose exec -T backend python -c "
from app import create_app
from app.models import db, User
from werkzeug.security import generate_password_hash
import os

app = create_app('production')
with app.app_context():
    email = os.environ.get('ADMIN_EMAIL', 'admin@uac-ai.local')
    password = os.environ.get('ADMIN_PASSWORD', 'changeme')
    if not User.query.filter_by(email=email).first():
        user = User(username='admin', email=email, password_hash=generate_password_hash(password))
        db.session.add(user)
        db.session.commit()
        print(f'Admin user created: {email}')
    else:
        print('Admin user already exists')
" 2>/dev/null || echo "Admin seeding may have already run"

echo ""
echo "==================================="
echo "UAC AI Parser is running!"
echo "==================================="
echo ""
echo "Frontend:     http://localhost:3000"
echo "Backend API:  http://localhost:5001/api/v1"
echo "MCP Server:   http://localhost:8811/sse"
echo ""
echo "Default admin credentials:"
echo "  Email:    admin@uac-ai.local"
echo "  Password: (check ADMIN_PASSWORD in .env)"
echo ""
echo "To view logs:  docker compose logs -f"
echo "To stop:       docker compose down"
echo ""
