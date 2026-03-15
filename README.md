# UAC AI — AI-Powered Forensic Analysis Platform

<div align="center">

**Transform digital forensic investigations with AI-powered analysis of UAC artifacts**

[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-green.svg)](https://python.org)
[![React 18](https://img.shields.io/badge/React-18-61DAFB.svg)](https://react.dev)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg)](https://docs.docker.com/compose/)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-purple.svg)](https://modelcontextprotocol.io)

[Features](#features) · [Quick Start](#quick-start) · [Deployment](#deployment) · [MCP Server](#mcp-server) · [API Reference](#api-reference) · [Architecture](#architecture)

</div>

---

## Overview

UAC AI is a full-stack platform for analyzing [UAC (Unix-like Artifacts Collector)](https://github.com/tclahr/uac) outputs using AI. Upload a `.tar.gz` archive, and the system parses, chunks, embeds, and indexes every artifact — then lets you query the data with natural language, explore interactive timelines, map MITRE ATT&CK techniques, extract IOCs, and compare sessions side by side.

Everything runs locally. Your forensic data never leaves your infrastructure.

---

## Features

| Category | Capabilities |
|---|---|
| **Investigation Management** | Multi-investigation, multi-session workflow · role-based access · local or Supabase auth |
| **Smart Parsing** | Drag-and-drop UAC archive upload · background processing · automatic artifact categorization · chunked storage for RAG |
| **AI Chat** | Natural language queries · agent mode (multi-step reasoning) · fast mode · suggested questions · context preview |
| **MITRE ATT&CK** | Automated technique scanning · tactic heatmap · per-session summary |
| **IOC Extraction** | IP, domain, hash, URL, email extraction · cross-session correlation · IOC search |
| **Entity Graph** | Extracted entities (IP, user, process, file) · relationship exploration · kill chain analysis |
| **Timeline** | Interactive event timeline · density chart · filter by category/severity/date · full-text search |
| **Session Compare** | Side-by-side diff of two sessions · highlight unique artifacts |
| **Search** | Full-text search across all chunks · category and file-type filtering |
| **Export** | JSONL (Timesketch) · JSON · Markdown · CSV |
| **MCP Server** | 60+ tools for AI assistants (Claude, Copilot, custom agents) via Model Context Protocol |

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
3. Build and start all 5 containers
4. Run database migrations
5. Seed the default admin user

Once running:

| Service | URL |
|---|---|
| **Frontend** | http://localhost:3000 |
| **Backend API** | http://localhost:5001/api/v1 |
| **MCP Server (SSE)** | http://localhost:8811/sse |

Default credentials: `admin@uac-ai.local` / check `ADMIN_PASSWORD` in `.env`

---

## Deployment

### Docker Compose (recommended)

The stack consists of 5 services:

| Container | Image | Purpose |
|---|---|---|
| `database` | PostgreSQL 16 + pgvector | Primary data store |
| `redis` | Redis 7 Alpine | Caching layer |
| `backend` | Python 3.11 / Flask | REST API, parsing, RAG, analysis |
| `frontend` | Node 18 → Nginx | React SPA |
| `mcp-server` | Python 3.12 / FastMCP | MCP tool bridge for AI assistants |

```bash
# Start everything
./start.sh

# View logs
docker compose logs -f

# Stop
docker compose down

# Stop and remove data
docker compose down -v
```

### Local Development (no Docker)

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

### Environment Variables

Copy `.env.example` to `.env` and customize. Key settings:

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | auto-generated | Flask session signing key |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `llama3.1` | Default LLM model |
| `AUTH_PROVIDER` | `local` | `local` (DB) or `supabase` |
| `DATABASE_URL` | (none → SQLite) | PostgreSQL connection string |
| `REDIS_URL` | (none) | Redis connection string |
| `ADMIN_EMAIL` | `admin@uac-ai.local` | Initial admin account |
| `ADMIN_PASSWORD` | `changeme` | Initial admin password |
| `OPENAI_API_KEY` | (none) | Optional: OpenAI provider |
| `ANTHROPIC_API_KEY` | (none) | Optional: Claude provider |
| `GOOGLE_API_KEY` | (none) | Optional: Gemini provider |

See [.env.example](.env.example) for the full list including RAG tuning, embedding model, and cleanup settings.

### Recommended LLM Models

| Model | Size | Best For |
|---|---|---|
| `llama3.1` | 8B | General analysis, good balance |
| `deepseek-r1:7b` | 7B | Complex reasoning, anomaly detection |
| `mistral` | 7B | Fast responses, quick Q&A |
| `codellama` | 13B | Script and code review |

---

## MCP Server

The MCP (Model Context Protocol) server exposes UAC AI's full capabilities as tools that AI assistants can call. Compatible with Claude Desktop, VS Code Copilot, and any MCP client.

### Connecting

**VS Code (`.vscode/mcp.json`)**:
```json
{
  "servers": {
    "uac-ai": {
      "type": "sse",
      "url": "http://localhost:8811/sse"
    }
  }
}
```

**Claude Desktop (`claude_desktop_config.json`)**:
```json
{
  "mcpServers": {
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

### Tool Reference

The MCP server provides **60+ tools** across 14 modules:

| Module | Tools | Description |
|---|---|---|
| **auth** | `uac_login`, `uac_get_current_user`, `uac_logout` | Authentication |
| **investigations** | `uac_list_investigations`, `uac_get_investigation`, `uac_create_investigation`, `uac_update_investigation`, `uac_delete_investigation` | Case management |
| **sessions** | `uac_get_session`, `uac_get_session_status`, `uac_get_session_artifacts`, `uac_get_session_stats`, `uac_delete_session` | Session lifecycle |
| **parse** | `uac_upload_archive` | Upload and parse UAC archives |
| **analyze** | `uac_query`, `uac_agent_query`, `uac_get_summary`, `uac_detect_anomalies`, `uac_get_suggestions`, `uac_context_preview`, `uac_extract_iocs_legacy` | AI analysis and querying |
| **timeline** | `uac_get_timeline`, `uac_get_timeline_stats`, `uac_correlate_events` | Event timeline |
| **search** | `uac_search_chunks`, `uac_get_search_filters`, `uac_get_chunk` | Full-text search |
| **entities** | `uac_list_entities`, `uac_search_entity`, `uac_graph_neighbors`, `uac_graph_path`, `uac_graph_stats`, `uac_kill_chain_analysis` | Entity graph |
| **iocs** | `uac_extract_iocs`, `uac_correlate_iocs`, `uac_ioc_summary`, `uac_search_iocs`, `uac_get_file_hashes`, `uac_compare_hashes`, `uac_search_hash` | IOC management |
| **mitre** | `uac_mitre_scan`, `uac_get_mitre_mappings`, `uac_get_mitre_summary`, `uac_compare_sessions` | MITRE ATT&CK mapping |
| **export** | `uac_export_session`, `uac_get_export_formats` | Data export |
| **config** | `uac_get_processing_settings`, `uac_update_processing_settings`, `uac_get_providers`, `uac_test_provider`, `uac_get_models`, `uac_set_model`, + more | Platform configuration |
| **chats** | `uac_list_chats`, `uac_create_chat`, `uac_get_chat`, `uac_update_chat`, `uac_delete_chat`, `uac_send_message`, `uac_get_chat_messages` | Chat management |
| **resources** | 4 MCP resources + 2 prompt templates | Reference data & prompts |

### MCP Resources

| Resource URI | Description |
|---|---|
| `uac://reference/mitre-tactics` | MITRE ATT&CK tactic list |
| `uac://reference/artifact-types` | UAC artifact type taxonomy |
| `uac://reference/entity-types` | Supported entity types |
| `uac://reference/ioc-types` | IOC categories |

### MCP Prompts

| Prompt | Description |
|---|---|
| `forensic_triage` | Structured triage of a parsed session |
| `ioc_investigation` | Deep-dive IOC investigation workflow |

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
                           │  REST API + SSE
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Flask API (:5001)                                                    │
│  Auth · Parsing · RAG · Analysis · Timeline · Search · Export        │
├──────────────────────────────────────────────────────────────────────┤
│  Service Layer                                                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────────────┐  │
│  │ UAC Parser  │ │ RAG Engine  │ │ LLM Agent   │ │ Entity/MITRE │  │
│  │ (tar.gz→DB) │ │ (Tiered)    │ │ (Multi-step)│ │ Extractors   │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └──────────────┘  │
└────────┬──────────────┬──────────────┬──────────────┬────────────────┘
         ▼              ▼              ▼              ▼
  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
  │ PostgreSQL │ │  ChromaDB  │ │   Ollama   │ │   Redis    │
  │  + pgvector│ │  (Vectors) │ │   (LLM)    │ │  (Cache)   │
  └────────────┘ └────────────┘ └────────────┘ └────────────┘
                                                      │
                                               ┌──────┴──────┐
                                               │  MCP Server  │
                                               │  (:8811 SSE) │
                                               └──────────────┘
```

### Project Structure

```
uac-ai/
├── backend/                 # Flask API server
│   ├── app/
│   │   ├── models/          # SQLAlchemy models
│   │   ├── routes/          # API endpoints (11 blueprints)
│   │   ├── services/        # Business logic
│   │   │   └── llm_providers/  # Ollama, OpenAI, Claude, Gemini
│   │   └── __init__.py      # App factory
│   ├── config.py            # Configuration
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
├── mcp-server/              # MCP tool server
│   ├── uac_ai_mcp/
│   │   ├── tools/           # 14 tool modules
│   │   ├── server.py        # FastMCP server setup
│   │   ├── client.py        # Backend HTTP client
│   │   └── config.py        # MCP config
│   ├── pyproject.toml
│   └── Dockerfile
├── database/                # PostgreSQL init scripts
│   ├── Dockerfile
│   └── init/
├── docker-compose.yml       # Full stack orchestration
├── Dockerfile.backend
├── Dockerfile.frontend
├── start.sh                 # One-command deploy script
├── .env.example             # Environment template
└── docs/                    # Documentation
```

---

## Usage Guide

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

</div>
