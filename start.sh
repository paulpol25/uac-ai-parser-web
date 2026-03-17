#!/bin/bash
set -e

echo "==================================="
echo "UAC AI Parser — Forensic Analysis"
echo "==================================="

# ---------------------------------------------------------------
# Build agent binaries (Linux amd64 + arm64) if Go is available
# and binaries are missing or --rebuild-agent is passed
# ---------------------------------------------------------------
BUILD_AGENT=false
for arg in "$@"; do
  case $arg in
    --rebuild-agent) BUILD_AGENT=true ;;
  esac
done

if [ "$BUILD_AGENT" = true ] || [ ! -f agent/bin/uac-agent-linux-amd64 ] || [ ! -f agent/bin/uac-agent-linux-arm64 ]; then
  if command -v go >/dev/null 2>&1; then
    echo ""
    echo "Building agent binaries..."
    (cd agent && make build-all)
    echo "Agent binaries built: agent/bin/uac-agent-linux-{amd64,arm64}"
  else
    if [ ! -f agent/bin/uac-agent-linux-amd64 ] || [ ! -f agent/bin/uac-agent-linux-arm64 ]; then
      echo ""
      echo "WARNING: Go not found and agent binaries are missing."
      echo "         Agent deployment will not work until binaries are built."
      echo "         Install Go and run:  cd agent && make build-all"
    else
      echo ""
      echo "Note: Go not found — using existing agent binaries."
    fi
  fi
fi

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

# Strip Windows-style CRLF line endings from .env (common when edited on Windows)
sed -i 's/\r//' .env 2>/dev/null || sed -i '' 's/\r//' .env 2>/dev/null || true

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
    user = User.query.filter_by(email=email).first()
    if not user:
        user = User(username='admin', email=email, password_hash=generate_password_hash(password))
        db.session.add(user)
        db.session.commit()
        print(f'Admin user created: {email}')
    else:
        user.password_hash = generate_password_hash(password)
        db.session.commit()
        print(f'Admin user password updated: {email}')
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

# Try to detect server IP for remote access links
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
if [ -n "$SERVER_IP" ] && [ "$SERVER_IP" != "127.0.0.1" ]; then
  echo "Remote access:"
  echo "  Frontend:   http://$SERVER_IP:3000"
  echo "  Backend API: http://$SERVER_IP:5001/api/v1"
  echo ""
fi

echo "Default admin credentials:"
echo "  Email:    admin@uac-ai.local"
echo "  Password: (check ADMIN_PASSWORD in .env)"
echo ""
echo "Agent binaries:  agent/bin/uac-agent-linux-{amd64,arm64}"
echo "  Deploy agents from the Agents page in the UI,"
echo "  or pass --rebuild-agent to rebuild binaries."
echo ""
echo "To view logs:  docker compose logs -f"
echo "To stop:       docker compose down"
echo ""
