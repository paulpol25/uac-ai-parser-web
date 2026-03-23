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
    # Only generate a new password if the postgres volume doesn't exist yet.
    # PostgreSQL only reads POSTGRES_PASSWORD on first init; changing it later
    # causes a mismatch between .env and the data in the volume.
    PG_VOLUME_EXISTS=$(docker volume ls -q --filter name=uac-ai-with-ui_postgres_data 2>/dev/null || true)
    if [ -z "$PG_VOLUME_EXISTS" ]; then
        echo "Generating POSTGRES_PASSWORD..."
        NEW_PG_PASS=$(openssl rand -hex 16)
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$NEW_PG_PASS/" .env
        else
            sed -i "s/POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$NEW_PG_PASS/" .env
        fi
    else
        echo "WARNING: Postgres volume already exists — keeping current POSTGRES_PASSWORD."
        echo "         If authentication fails, run: docker compose down -v  (destroys data)"
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
# Note: _seed_admin() already runs inside create_app(), so we just trigger it.
# Using LocalAuthProvider.hash_password (not werkzeug) to match the login flow.
docker compose exec -T backend python -c "
from app import create_app
from app.models import db, User
from app.services.auth_providers.local_provider import LocalAuthProvider
import os

app = create_app('production')
with app.app_context():
    email = os.environ.get('ADMIN_EMAIL', 'admin@uac-ai.local')
    password = os.environ.get('ADMIN_PASSWORD', 'changeme')
    user = User.query.filter_by(email=email).first()
    if not user:
        user = User(username='admin', email=email, password_hash=LocalAuthProvider.hash_password(password), role='admin')
        db.session.add(user)
        db.session.commit()
        print(f'Admin user created: {email}')
    else:
        user.password_hash = LocalAuthProvider.hash_password(password)
        user.role = 'admin'
        db.session.commit()
        print(f'Admin user password updated: {email}')
" 2>/dev/null || echo "Admin seeding may have already run"

# ---------------------------------------------------------------
# Re-source .env to pick up any auto-generated values
# ---------------------------------------------------------------
source .env

# Detect server IP for remote access links
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
BASE_URL="http://localhost"
if [ -n "$SERVER_IP" ] && [ "$SERVER_IP" != "127.0.0.1" ]; then
  REMOTE_URL="http://$SERVER_IP"
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║              UAC AI Parser is running!                       ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "───────────────────────────────────────────────────────────────"
echo "  Services"
echo "───────────────────────────────────────────────────────────────"
echo "  Frontend:      ${BASE_URL}:3000"
echo "  Backend API:   ${BASE_URL}:5001/api/v1"
echo "  MCP Server:    ${BASE_URL}:8811/sse"
if [ -n "$REMOTE_URL" ]; then
  echo ""
  echo "  Remote access:"
  echo "    Frontend:    ${REMOTE_URL}:3000"
  echo "    Backend:     ${REMOTE_URL}:5001/api/v1"
  echo "    MCP Server:  ${REMOTE_URL}:8811/sse"
fi
echo ""
echo "───────────────────────────────────────────────────────────────"
echo "  Admin Credentials"
echo "───────────────────────────────────────────────────────────────"
echo "  Email:     ${ADMIN_EMAIL:-admin@uac-ai.local}"
echo "  Password:  ${ADMIN_PASSWORD}"
echo ""
echo "───────────────────────────────────────────────────────────────"
echo "  MCP Auth Token  (needed by AI clients)"
echo "───────────────────────────────────────────────────────────────"
echo "  ${MCP_AUTH_TOKEN}"
echo ""
echo "───────────────────────────────────────────────────────────────"
echo "  VS Code — .vscode/mcp.json"
echo "───────────────────────────────────────────────────────────────"
cat <<EOF
  {
    "servers": {
      "uac-ai": {
        "type": "sse",
        "url": "${BASE_URL}:8811/sse",
        "headers": {
          "Authorization": "Bearer ${MCP_AUTH_TOKEN}"
        }
      }
    }
  }
EOF
echo ""
echo "───────────────────────────────────────────────────────────────"
echo "  Claude Desktop — claude_desktop_config.json"
echo "───────────────────────────────────────────────────────────────"
echo ""
echo "  Option A — stdio transport (requires local install):"
cat <<EOF
  {
    "mcpServers": {
      "uac-ai": {
        "command": "uac-ai-mcp",
        "env": {
          "UAC_AI_URL": "${BASE_URL}:5001",
          "UAC_AI_TOKEN": "${MCP_AUTH_TOKEN}"
        }
      }
    }
  }
EOF
echo ""
echo "  Option B — SSE transport (remote / Docker):"
cat <<EOF
  {
    "mcpServers": {
      "uac-ai": {
        "type": "sse",
        "url": "${BASE_URL}:8811/sse",
        "headers": {
          "Authorization": "Bearer ${MCP_AUTH_TOKEN}"
        }
      }
    }
  }
EOF
echo ""
echo "───────────────────────────────────────────────────────────────"
echo "  Gemini CLI — ~/.gemini/settings.json"
echo "───────────────────────────────────────────────────────────────"
echo ""
echo "  Option A — stdio transport (requires local install):"
cat <<EOF
  {
    "mcpServers": {
      "uac-ai": {
        "command": "uac-ai-mcp",
        "env": {
          "UAC_AI_URL": "${BASE_URL}:5001",
          "UAC_AI_TOKEN": "${MCP_AUTH_TOKEN}"
        }
      }
    }
  }
EOF
echo ""
echo "  Option B — SSE transport (remote / Docker):"
cat <<EOF
  {
    "mcpServers": {
      "uac-ai": {
        "type": "sse",
        "url": "${BASE_URL}:8811/sse",
        "headers": {
          "Authorization": "Bearer ${MCP_AUTH_TOKEN}"
        }
      }
    }
  }
EOF
echo ""
echo "───────────────────────────────────────────────────────────────"
echo "  Agent Binaries"
echo "───────────────────────────────────────────────────────────────"
echo "  agent/bin/uac-agent-linux-{amd64,arm64}"
echo "  Deploy agents from the Agents page in the UI,"
echo "  or pass --rebuild-agent to rebuild binaries."
echo ""
echo "───────────────────────────────────────────────────────────────"
echo "  Quick Commands"
echo "───────────────────────────────────────────────────────────────"
echo "  View logs:   docker compose logs -f"
echo "  Stop:        docker compose down"
echo "  Restart:     docker compose restart"
echo "  Rebuild:     docker compose up -d --build"
echo ""
