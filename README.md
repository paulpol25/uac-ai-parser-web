# UAC AI — AI-Powered Forensic Analysis Platform

<div align="center">

**Transform digital forensic investigations with AI-powered analysis of UAC artifacts**

[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-green.svg)](https://python.org)
[![React 18](https://img.shields.io/badge/React-18-61DAFB.svg)](https://react.dev)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg)](https://docs.docker.com/compose/)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-purple.svg)](https://modelcontextprotocol.io)

[Features](#features) · [Quick Start](#quick-start) · [Environment Setup](#environment-setup) · [Deployment](#deployment) · [Agent Deployment](#agent-deployment) · [MCP Integration](#mcp-integration) · [API Reference](#api-reference) · [Architecture](#architecture)

</div>

---

## Overview

UAC AI is a full-stack platform for analyzing [UAC (Unix-like Artifacts Collector)](https://github.com/tclahr/uac) outputs using AI. Upload a `.tar.gz` archive, and the system parses, chunks, embeds, and indexes every artifact — then lets you query the data with natural language, explore interactive timelines, map MITRE ATT&CK techniques, extract IOCs, and compare sessions side by side.

The platform also supports deploying lightweight Go agents to remote Linux endpoints for live artifact collection, command execution, YARA scanning, network capture, and full UAC triage — all managed from the web UI.

Everything runs locally. Your forensic data never leaves your infrastructure.

---

## Features

| Category | Capabilities |
|---|---|
| **Investigation Management** | Multi-investigation, multi-session workflow · role-based access (Admin / Operator / Viewer) · local or Supabase auth |
| **Smart Parsing** | Drag-and-drop UAC archive upload · background processing · automatic artifact categorization · chunked storage for RAG |
| **Remote Agents** | Go-based agents for Linux endpoints · 13 command types · WebSocket + REST transport · encrypted payloads |
| **AI Chat** | Natural language queries · agent mode (multi-step reasoning) · fast mode · suggested questions · context preview |
| **MITRE ATT&CK** | Automated technique scanning · tactic heatmap · per-session summary |
| **IOC Extraction** | IP, domain, hash, URL, email extraction · cross-session correlation · IOC search |
| **Entity Graph** | Extracted entities (IP, user, process, file) · relationship exploration · kill chain analysis |
| **Timeline** | Interactive event timeline · density chart · filter by category/severity/date · full-text search |
| **Session Compare** | Side-by-side diff of two sessions · highlight unique artifacts |
| **Search** | Full-text search across all chunks · category and file-type filtering |
| **Export** | JSONL (Timesketch) · JSON · Markdown · CSV |
| **Playbooks** | Built-in & custom multi-command automation workflows |
| **YARA Rules** | Upload, manage, and deploy YARA rules to agents |
| **MCP Server** | 60+ tools for AI assistants (VS Code Copilot, Claude Desktop, Gemini CLI) via Model Context Protocol |

---

## Quick Start

### Prerequisites

- **Docker** & **Docker Compose** (v2)
- **[Ollama](https://ollama.ai/)** running locally with at least one model pulled

```bash
# Install Ollama, then pull a model
ollama pull llama3.1
```

### One-Command Deploy

```bash
git clone https://github.com/paulpol25/uac-ai.git
cd uac-ai
chmod +x start.sh
./start.sh
```

`start.sh` will:
1. Create `.env` from `.env.example` if missing
2. Auto-generate secrets (`SECRET_KEY`, `POSTGRES_PASSWORD`, `MCP_AUTH_TOKEN`)
3. Build agent binaries (if Go is installed)
4. Build and start all 5 containers
5. Run database migrations
6. Seed the default admin user

Once running:

| Service | URL |
|---|---|
| **Frontend** | http://localhost:3000 |
| **Backend API** | http://localhost:5001/api/v1 |
| **MCP Server (SSE)** | http://localhost:8811/sse |

Default credentials: `admin@uac-ai.local` / check `ADMIN_PASSWORD` in `.env`

---

## Environment Setup

### Creating the `.env` File

The `start.sh` script copies `.env.example` → `.env` automatically on first run. To set it up manually:

```bash
cp .env.example .env
```

Then edit `.env` with your preferred settings. The file is divided into sections:

### Required Settings

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | `dev-secret-key-change-in-production` | Flask session signing key. `start.sh` auto-generates a secure value. |
| `MCP_AUTH_TOKEN` | (empty) | Bearer token for MCP SSE endpoint. `start.sh` auto-generates this. |

### LLM Configuration

At least one LLM provider must be configured for AI features to work.

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `llama3.1` | Default Ollama model |
| `OPENAI_API_KEY` | (none) | OpenAI API key |
| `ANTHROPIC_API_KEY` | (none) | Anthropic Claude API key |
| `GOOGLE_API_KEY` | (none) | Google Gemini API key |

> **Tip:** You can configure LLM providers in the web UI under **Settings** without editing `.env`.

### PostgreSQL (Docker)

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` | `uacai` | Database username |
| `POSTGRES_PASSWORD` | `changeme` | Database password. `start.sh` auto-generates on first run. |
| `POSTGRES_DB` | `uacai` | Database name |

> **Important:** PostgreSQL only reads `POSTGRES_PASSWORD` on first data directory initialization. If you change the password after the database volume already exists, you must either drop the volume (`docker compose down -v`) and recreate, or change the password inside PostgreSQL manually.

### Authentication

| Variable | Default | Description |
|---|---|---|
| `AUTH_PROVIDER` | `local` | `local` (DB-backed) or `supabase` |
| `ADMIN_EMAIL` | `admin@uac-ai.local` | Seed admin email (created on startup) |
| `ADMIN_PASSWORD` | `changeme` | Seed admin password |
| `ADMIN_USERNAME` | `admin` | Seed admin display name |

### Storage Paths (Local Dev Only)

These are overridden by Docker volumes when running via Docker Compose:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_PATH` | `~/.uac-ai/uac-ai.db` | SQLite path (used when `DATABASE_URL` is not set) |
| `UPLOAD_FOLDER` | `~/.uac-ai/uploads` | Temp upload directory |
| `CHROMA_PERSIST_DIR` | `~/.uac-ai/chroma` | ChromaDB vector store |

### Application Settings

| Variable | Default | Description |
|---|---|---|
| `FLASK_ENV` | `development` | `development`, `testing`, or `production` |
| `FLASK_DEBUG` | `true` | Enable debug mode (set `false` in production) |
| `CORS_ORIGINS` | `http://localhost:3000,...` | Comma-separated allowed origins |
| `REDIS_URL` | (none) | Redis connection string (app degrades gracefully without it) |

See [.env.example](.env.example) for the complete list.

### Recommended LLM Models

| Model | Size | Best For |
|---|---|---|
| `llama3.1` | 8B | General analysis, good balance |
| `deepseek-r1:7b` | 7B | Complex reasoning, anomaly detection |
| `mistral` | 7B | Fast responses, quick Q&A |
| `codellama` | 13B | Script and code review |

---

## Deployment

### Docker Compose (Recommended)

The stack consists of 5 services:

| Container | Port | Purpose |
|---|---|---|
| `uac-ai-database` | `127.0.0.1:5432` | PostgreSQL 16 + pgvector |
| `uac-ai-redis` | `127.0.0.1:6379` | Redis 7 Alpine (caching) |
| `uac-ai-backend` | `0.0.0.0:5001` | Flask API (Gunicorn + gevent) |
| `uac-ai-frontend` | `0.0.0.0:3000` | React SPA (Nginx) |
| `uac-ai-mcp` | `0.0.0.0:8811` | MCP server (FastMCP SSE) |

All services have health checks and automatic restart policies. The backend waits for healthy database and Redis before starting.

```bash
# Start everything
./start.sh

# View logs
docker compose logs -f

# View specific service logs
docker compose logs -f backend

# Stop
docker compose down

# Stop and remove all data (databases, uploads, etc.)
docker compose down -v
```

### Volumes

| Volume | Purpose |
|---|---|
| `postgres_data` | PostgreSQL database files |
| `redis_data` | Redis append-only file |
| `uac-ai-data` | Uploaded archives, parsed data, ChromaDB vectors |

### Local Development (No Docker)

#### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Uses SQLite by default when DATABASE_URL is not set
python run.py               # Runs on port 5001
```

#### Frontend

```bash
cd frontend
npm install
npm run dev                 # Runs on port 3000, proxies /api → backend:5001
```

#### MCP Server

```bash
cd mcp-server
pip install -e .
uac-ai-mcp                 # Starts stdio transport by default
```

---

## Agent Deployment

UAC AI includes a lightweight Go agent that runs on Linux endpoints for remote artifact collection.

### Agent Binaries

Pre-built binaries are in `agent/bin/`:
- `uac-agent-linux-amd64` — x86_64
- `uac-agent-linux-arm64` — ARM64

To rebuild from source (requires Go 1.21+):

```bash
cd agent && make build-all
```

Or use the `--rebuild-agent` flag with `start.sh`:

```bash
./start.sh --rebuild-agent
```

### Deploying an Agent

1. **Register the agent** in the web UI → **Agents** page → **Register Agent**
2. **Copy the bootstrap script** shown after registration
3. **Run the bootstrap script** on the target endpoint — it downloads the agent binary and creates the config
4. The agent connects via WebSocket (preferred) or REST polling

### Agent Configuration

The agent reads from `/opt/uac-ai-agent/agent.conf` (JSON):

```json
{
  "agent_id": "generated-uuid",
  "api_key": "generated-key",
  "backend_url": "http://your-server:5001",
  "ws_endpoint": "/ws/agent",
  "heartbeat_interval": 30,
  "uac_profile": "ir_triage",
  "work_dir": "/opt/uac-ai-agent/work",
  "max_concurrency": 5,
  "tls_skip_verify": false
}
```

| Field | Default | Description |
|---|---|---|
| `agent_id` | (required) | Unique agent identifier |
| `api_key` | (required) | Authentication key |
| `backend_url` | (required) | UAC AI backend URL |
| `ws_endpoint` | `/ws/agent` | WebSocket path |
| `heartbeat_interval` | `30` | Heartbeat interval (seconds) |
| `uac_profile` | `ir_triage` | Default UAC collection profile |
| `work_dir` | `/opt/uac-ai-agent/work` | Working directory for artifacts |
| `max_concurrency` | `5` | Max concurrent command goroutines |
| `encryption_key` | (none) | Base64 AES-256 key for payload encryption |
| `tls_skip_verify` | `false` | Skip TLS verification (dev only) |
| `allowed_collect_paths` | (all) | Restrict file collection to these paths |

---

## MCP Integration

The MCP (Model Context Protocol) server exposes **60+ tools** that let AI assistants interact with UAC AI directly — querying sessions, dispatching commands to agents, extracting IOCs, running MITRE scans, and more.

### Transport Modes

| Transport | Use Case | How It Works |
|---|---|---|
| **SSE** | Docker deployment / remote | Runs on port 8811; clients connect over HTTP |
| **stdio** | Local / standalone | Client launches the process directly |

Docker Compose starts the MCP server in SSE mode automatically. For stdio, install the package locally:

```bash
cd mcp-server
pip install -e .
```

### VS Code (GitHub Copilot)

Create `.vscode/mcp.json` in your workspace:

**SSE transport (Docker):**

```json
{
  "servers": {
    "uac-ai": {
      "type": "sse",
      "url": "http://localhost:8811/sse",
      "headers": {
        "Authorization": "Bearer ${input:mcp_auth_token}"
      }
    }
  },
  "inputs": [
    {
      "id": "mcp_auth_token",
      "type": "promptString",
      "description": "MCP Auth Token (from .env MCP_AUTH_TOKEN)",
      "password": true
    }
  ]
}
```

**stdio transport (local dev):**

```json
{
  "servers": {
    "uac-ai": {
      "command": "uac-ai-mcp",
      "env": {
        "UAC_AI_API_URL": "http://localhost:5001/api/v1",
        "UAC_AI_USERNAME": "admin@uac-ai.local",
        "UAC_AI_PASSWORD": "your-password"
      }
    }
  }
}
```

### Claude Desktop

Add to your `claude_desktop_config.json`:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

**Option A — Docker (recommended, zero extra setup):**

```json
{
  "mcpServers": {
    "uac-ai": {
      "command": "docker",
      "args": ["exec", "-i", "uac-ai-mcp", "uac-ai-proxy"]
    }
  }
}
```

> The proxy bridges stdio↔SSE inside the container. Auth is handled automatically.

**Option B — Remote server (`pip install uac-ai-mcp`):**

```bash
pip install uac-ai-mcp
```

```json
{
  "mcpServers": {
    "uac-ai": {
      "command": "uac-ai-proxy",
      "args": ["http://your-server:8811/sse"],
      "env": {
        "MCP_AUTH_TOKEN": "YOUR_MCP_AUTH_TOKEN"
      }
    }
  }
}
```

**Option C — npx (alternative, requires Node.js):**

```json
{
  "mcpServers": {
    "uac-ai": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-proxy", "http://your-server:8811/sse"],
      "env": {
        "MCP_HEADERS": "{\"Authorization\": \"Bearer YOUR_MCP_AUTH_TOKEN\"}"
      }
    }
  }
}
```

### Gemini CLI

Add to `~/.gemini/settings.json`:

**Option A — Docker (recommended, zero extra setup):**

```json
{
  "mcpServers": {
    "uac-ai": {
      "command": "docker",
      "args": ["exec", "-i", "uac-ai-mcp", "uac-ai-proxy"]
    }
  }
}
```

**Option B — Remote server (`pip install uac-ai-mcp`):**

```bash
pip install uac-ai-mcp
```

```json
{
  "mcpServers": {
    "uac-ai": {
      "command": "uac-ai-proxy",
      "args": ["http://your-server:8811/sse"],
      "env": {
        "MCP_AUTH_TOKEN": "YOUR_MCP_AUTH_TOKEN"
      }
    }
  }
}
```

**Option C — npx (alternative, requires Node.js):**

```json
{
  "mcpServers": {
    "uac-ai": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-proxy", "http://your-server:8811/sse"],
      "env": {
        "MCP_HEADERS": "{\"Authorization\": \"Bearer YOUR_MCP_AUTH_TOKEN\"}"
      }
    }
  }
}
```

### MCP Environment Variables

| Variable | Default | Description |
|---|---|---|
| `UAC_AI_API_URL` | `http://backend:5000/api/v1` | Backend API URL |
| `UAC_AI_API_TOKEN` | (none) | Pre-existing JWT for auth |
| `UAC_AI_USERNAME` | (none) | Username for auto-login |
| `UAC_AI_PASSWORD` | (none) | Password for auto-login |
| `MCP_TRANSPORT` | `stdio` | Transport: `stdio` or `sse` |
| `SSE_PORT` | `8811` | Port for SSE transport |
| `MCP_AUTH_TOKEN` | (none) | Bearer token for SSE endpoint security |
| `REDIS_URL` | (none) | Redis URL for session caching |
| `LOG_LEVEL` | `INFO` | Logging level |

> **Note:** `MCP_AUTH_TOKEN` protects the MCP SSE endpoint itself. This is separate from `UAC_AI_USERNAME`/`UAC_AI_PASSWORD` which authenticate with the backend API. Set `MCP_AUTH_TOKEN` in your `.env` and pass the same value in the client's `Authorization` header or `MCP_AUTH_TOKEN` env var.

### MCP Authentication

The MCP server authenticates with the backend in one of two ways:
1. **Token-based:** Set `UAC_AI_API_TOKEN` to a valid JWT — the server uses it directly
2. **Credential-based:** Set `UAC_AI_USERNAME` and `UAC_AI_PASSWORD` — the server calls the login endpoint automatically

### Quick Reference

| Client | Config File | Recommended Transport |
|---|---|---|
| VS Code (Copilot) | `.vscode/mcp.json` | SSE (direct) |
| Claude Desktop | `claude_desktop_config.json` | `uac-ai-proxy` (stdio↔SSE) |
| Gemini CLI | `~/.gemini/settings.json` | `uac-ai-proxy` (stdio↔SSE) |

### Tool Categories

The MCP server provides **60+ tools** across 14 modules:

| Module | Tools | Description |
|---|---|---|
| **auth** | 3 | Login, current user, logout |
| **investigations** | 5 | CRUD + list investigations |
| **sessions** | 5 | Session lifecycle management |
| **parse** | 1 | Upload and parse UAC archives |
| **analyze** | 7 | AI queries, summaries, anomaly detection |
| **timeline** | 3 | Event timeline and correlation |
| **search** | 3 | Full-text chunk search |
| **entities** | 6 | Entity graph, neighbors, kill chain |
| **iocs** | 7 | IOC extraction, correlation, hash search |
| **mitre** | 4 | MITRE ATT&CK scanning and mapping |
| **export** | 2 | Session data export |
| **config** | 9+ | Provider, model, and processing settings |
| **chats** | 7 | Chat management and messaging |
| **agents** | 10+ | Agent management, command dispatch, playbooks |

See [docs/mcp-server.md](docs/mcp-server.md) for the complete tool reference.

---

## API Reference

All endpoints are prefixed with `/api/v1`.

### Authentication
| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | Login, returns JWT |
| POST | `/auth/register` | Create account |
| GET | `/auth/me` | Current user profile |
| POST | `/auth/logout` | Invalidate token |

### Investigations
| Method | Path | Description |
|---|---|---|
| GET | `/investigations` | List all |
| POST | `/investigations` | Create new |
| GET | `/investigations/:id` | Get details (with sessions) |
| PUT | `/investigations/:id` | Update |
| DELETE | `/investigations/:id` | Delete |

### Parse / Upload
| Method | Path | Description |
|---|---|---|
| POST | `/parse` | Upload UAC archive (multipart) |
| GET | `/parse/:session_id/status` | Parsing progress |
| GET | `/parse/:session_id/artifacts` | List parsed files |

### Analysis
| Method | Path | Description |
|---|---|---|
| POST | `/analyze/query` | Natural language query |
| POST | `/analyze/query/agent` | Agent (multi-step) query |
| GET | `/analyze/summary` | Generate incident summary |
| GET | `/analyze/anomalies` | Detect anomalies |
| GET | `/analyze/suggestions` | Suggested questions |
| POST | `/analyze/context-preview` | Preview RAG context |
| GET | `/analyze/session-stats` | Session statistics |

### MITRE ATT&CK
| Method | Path | Description |
|---|---|---|
| POST | `/analyze/mitre/scan` | Scan session for techniques |
| GET | `/analyze/mitre/mappings` | Get technique mappings |
| GET | `/analyze/mitre/summary` | Tactic summary |

### IOCs
| Method | Path | Description |
|---|---|---|
| POST | `/analyze/iocs/extract` | Extract IOCs |
| GET | `/analyze/iocs/correlate` | Cross-session correlation |
| GET | `/analyze/iocs/summary` | IOC summary |
| POST | `/analyze/iocs/search` | Search IOCs |

### Hashes
| Method | Path | Description |
|---|---|---|
| GET | `/analyze/hashes` | File hashes |
| POST | `/analyze/hashes/compare` | Compare hash sets |
| POST | `/analyze/hashes/search` | Search hashes |

### Entity Graph
| Method | Path | Description |
|---|---|---|
| GET | `/analyze/entities` | List entities |
| POST | `/analyze/entities/search` | Search entities |
| POST | `/analyze/graph/neighbors` | Get neighbors |
| POST | `/analyze/graph/path` | Find path |
| GET | `/analyze/graph/stats` | Graph statistics |
| GET | `/analyze/graph/kill-chain` | Kill chain analysis |

### Session Compare
| Method | Path | Description |
|---|---|---|
| POST | `/analyze/compare` | Compare two sessions |

### Timeline
| Method | Path | Description |
|---|---|---|
| GET | `/timeline` | Get events |
| GET | `/timeline/stats` | Event density stats |
| GET | `/timeline/correlate` | Correlate events |

### Search
| Method | Path | Description |
|---|---|---|
| GET | `/search` | Full-text chunk search |
| GET | `/search/filters` | Available filters |
| GET | `/search/chunk/:id` | Get single chunk |

### Export
| Method | Path | Description |
|---|---|---|
| GET | `/export` | Export session data |
| GET | `/export/formats` | Available formats |

### Chats
| Method | Path | Description |
|---|---|---|
| GET | `/chats` | List chats |
| POST | `/chats` | Create chat |
| GET | `/chats/:id` | Get chat + messages |
| PATCH | `/chats/:id` | Update chat |
| DELETE | `/chats/:id` | Delete chat |
| POST | `/chats/:id/messages` | Send message |
| GET | `/chats/:id/messages` | Get messages |

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│  Browser — React 18 SPA (Vite + TypeScript + Tailwind)               │
│  Dashboard · Query · Timeline · Search · Analysis · Export · Settings │
└──────────────────────────┬────────────────────────────────────────────┘
                           │  REST API + WebSocket
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Flask API (:5001)   Gunicorn + gevent                                │
│  Auth · Parsing · RAG · Analysis · Timeline · Search · Agents        │
├──────────────────────────────────────────────────────────────────────┤
│  Service Layer                                                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────────────┐  │
│  │ UAC Parser  │ │ RAG Engine  │ │ LLM Agent   │ │ Entity/MITRE │  │
│  │ (tar.gz→DB) │ │ (Tiered)    │ │ (Multi-step)│ │ Extractors   │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └──────────────┘  │
└────────┬──────────────┬──────────────┬──────────────┬────────────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
  │ PostgreSQL │ │  ChromaDB  │ │   Ollama   │ │   Redis    │
  │  + pgvector│ │  (Vectors) │ │   (LLM)    │ │  (Cache)   │
  └────────────┘ └────────────┘ └────────────┘ └────────────┘
         ▲                                            │
         │                                     ┌──────┴──────┐
  ┌──────┴──────┐                              │  MCP Server  │
  │  Go Agents  │←── WebSocket/REST ──────────→│  (:8811 SSE) │
  │  (Endpoints)│                              └──────────────┘
  └─────────────┘
```

### Project Structure

```
uac-ai/
├── backend/                 # Flask API server
│   ├── app/
│   │   ├── models/          # SQLAlchemy models
│   │   ├── routes/          # API endpoints (14 blueprints)
│   │   ├── services/        # Business logic
│   │   │   ├── llm_providers/  # Ollama, OpenAI, Claude, Gemini
│   │   │   └── auth_providers/ # Local, Supabase
│   │   └── __init__.py      # App factory
│   ├── config.py            # Configuration
│   ├── gunicorn.conf.py     # Gunicorn worker config
│   ├── requirements.txt
│   └── run.py               # Entry point
├── frontend/                # React SPA
│   ├── src/
│   │   ├── components/      # UI + feature components
│   │   ├── pages/           # Route pages
│   │   ├── services/api.ts  # Centralized API client
│   │   ├── stores/          # Zustand state stores
│   │   └── types/           # TypeScript types
│   ├── vite.config.ts
│   └── package.json
├── agent/                   # Go agent for remote endpoints
│   ├── cmd/agent/main.go    # Agent entry point
│   ├── internal/            # Config, transport, worker
│   ├── bin/                 # Pre-built binaries (amd64 + arm64)
│   └── Makefile
├── mcp-server/              # MCP tool server
│   ├── uac_ai_mcp/
│   │   ├── tools/           # 14 tool modules (60+ tools)
│   │   ├── server.py        # FastMCP server setup
│   │   ├── client.py        # Backend HTTP client
│   │   └── config.py        # MCP config
│   ├── pyproject.toml
│   └── Dockerfile
├── database/                # PostgreSQL init scripts
│   ├── Dockerfile
│   └── init/                # Schema, extensions, seed data, RBAC
├── docs/                    # Documentation
│   ├── how-to-use.md
│   ├── mcp-server.md
│   └── intrusion-simulation.md
├── docker-compose.yml       # Full stack orchestration
├── Dockerfile.backend
├── Dockerfile.frontend
├── start.sh                 # One-command deploy script
└── .env.example             # Environment template
```

---

## Usage Guide

See [docs/how-to-use.md](docs/how-to-use.md) for a detailed walkthrough. Quick summary:

### 1. Create an Investigation

Navigate to **Investigations** → **New Investigation**. Enter a name and optional case number.

### 2. Upload UAC Archive

From the **Dashboard**, select your investigation and drag-and-drop a UAC `.tar.gz` file. Processing runs in the background with real-time progress.

### 3. Query with AI

Go to **Query** → select your session → ask questions in natural language:
- *"What persistence mechanisms are present?"*
- *"Show all suspicious network connections"*
- *"Summarize the timeline of events from midnight to 6 AM"*

Use **Agent Mode** for complex multi-step investigations.

### 4. Analyze

Open **Analysis** to access four tabs:
- **MITRE ATT&CK** — Scan for techniques, view tactic heatmap
- **IOCs** — Extract and correlate indicators across sessions
- **Entities** — Explore extracted entities and their relationships
- **Compare** — Side-by-side session diff

### 5. Export

Go to **Export** to download results in JSONL (Timesketch), JSON, Markdown, or CSV format.

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## Acknowledgments

- [UAC](https://github.com/tclahr/uac) — Unix-like Artifacts Collector
- [Ollama](https://ollama.ai/) — Local LLM runtime
- [ChromaDB](https://www.trychroma.com/) — Vector database
- [MCP](https://modelcontextprotocol.io/) — Model Context Protocol

---

<div align="center">

Made with ❤️ for the DFIR community

</div>
