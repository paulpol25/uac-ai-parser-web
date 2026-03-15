# UAC AI — Backend

Flask REST API powering the UAC AI forensic analysis platform.

## Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Python 3.11+, Flask 3 |
| **Database** | PostgreSQL 16 (production) / SQLite (local dev fallback) |
| **Vector Store** | ChromaDB — embeddings for semantic search |
| **Cache** | Redis 7 (optional, degrades gracefully) |
| **Migrations** | Flask-Migrate / Alembic |
| **LLM Providers** | Ollama (local), OpenAI, Claude, Gemini |

## Quick Start (Local Dev)

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
python run.py               # Runs on port 5001
```

Without `DATABASE_URL` set, the backend falls back to SQLite at `~/.uac-ai/uac-ai.db`.

### With PostgreSQL

```bash
export DATABASE_URL="postgresql://user:pass@localhost:5432/uac_ai"
export REDIS_URL="redis://localhost:6379/0"
python run.py
```

## API Routes

All endpoints are served under `/api/v1`. There are **75+ endpoints** across 12 blueprints:

### Health & Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check + dependency status |
| POST | `/auth/register` | Create account |
| POST | `/auth/login` | Get auth token |
| POST | `/auth/logout` | Revoke token |
| GET | `/auth/me` | Current user profile |
| GET | `/auth/provider` | Auth provider type (local/supabase) |

### Investigations & Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/investigations` | List investigations |
| POST | `/investigations` | Create investigation |
| GET | `/investigations/:id` | Get investigation detail |
| PUT | `/investigations/:id` | Update investigation |
| DELETE | `/investigations/:id` | Delete investigation |
| GET | `/investigations/:id/sessions/:sid` | Get session within investigation |
| DELETE | `/investigations/:id/sessions/:sid` | Remove session from investigation |

### Parsing

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/parse` | Upload + parse UAC archive |
| POST | `/parse/stream` | Upload with SSE progress |
| GET | `/parse/:session_id/status` | Parsing status |
| GET | `/parse/:session_id/artifacts` | List parsed artifacts |

### Analysis (RAG, MITRE, IOCs, Entities, Graph)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/analyze/query` | RAG query |
| POST | `/analyze/query/agent` | Agentic RAG with tool use |
| GET | `/analyze/summary` | Session summary |
| GET | `/analyze/anomalies` | Detected anomalies |
| GET | `/analyze/suggestions` | Suggested questions |
| POST | `/analyze/context-preview` | Preview RAG context |
| GET | `/analyze/session-stats` | Session statistics |
| POST | `/analyze/mitre/scan` | Run MITRE ATT&CK scan |
| GET | `/analyze/mitre/mappings` | Get MITRE mappings |
| GET | `/analyze/mitre/summary` | MITRE summary |
| POST | `/analyze/iocs/extract` | Extract IOCs |
| GET | `/analyze/iocs/summary` | IOC summary |
| GET | `/analyze/iocs/correlate` | IOC correlation |
| POST | `/analyze/iocs/search` | Search IOCs |
| GET | `/analyze/entities` | List entities |
| POST | `/analyze/entities/search` | Search entities |
| POST | `/analyze/graph/neighbors` | Entity neighbors |
| POST | `/analyze/graph/path` | Path between entities |
| GET | `/analyze/graph/stats` | Graph statistics |
| GET | `/analyze/graph/kill-chain` | Kill chain analysis |
| GET | `/analyze/extract-iocs` | Legacy IOC extraction |
| GET | `/analyze/hashes` | File hashes |
| POST | `/analyze/hashes/compare` | Compare hashes |
| POST | `/analyze/hashes/search` | Search hashes |
| POST | `/analyze/hashes/mark-known-good` | Mark hash as known-good |
| POST | `/analyze/compare` | Compare sessions |
| GET | `/analyze/relevance/stats` | Relevance feedback stats |

### Timeline, Search, Export

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/timeline` | Timeline events |
| GET | `/timeline/stats` | Timeline statistics |
| GET | `/timeline/correlate` | Event correlation |
| POST | `/timeline/plaso` | Plaso timeline import |
| GET | `/timeline/plaso/status` | Plaso import status |
| GET | `/search` | Full-text chunk search |
| GET | `/search/filters` | Available search filters |
| GET | `/search/chunk/:id` | Get specific chunk |
| GET | `/export` | Export session data |
| GET | `/export/formats` | Available export formats |

### Chats

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/chats` | List chat threads |
| POST | `/chats` | Create chat thread |
| GET | `/chats/:id` | Get chat |
| PATCH | `/chats/:id` | Update chat |
| DELETE | `/chats/:id` | Delete chat |
| GET | `/chats/:id/messages` | Get messages |
| POST | `/chats/:id/messages` | Send message |

### Config & Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/config/providers` | List LLM providers |
| PUT | `/config/providers/active` | Set active provider |
| PUT | `/config/providers/:type` | Update provider config |
| POST | `/config/providers/:type/test` | Test provider |
| GET | `/config/models` | List models |
| GET | `/config/settings/processing` | Processing settings |
| PUT | `/config/settings/processing` | Update processing settings |
| GET | `/config/embeddings/providers` | Embedding providers |
| GET | `/admin/storage` | Storage report |
| POST | `/admin/cleanup/run` | Run cleanup |
| POST | `/admin/cleanup/sessions` | Cleanup sessions |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | `dev-secret-key...` | Session/token signing key |
| `DATABASE_URL` | _(none → SQLite)_ | PostgreSQL connection string |
| `REDIS_URL` | _(none)_ | Redis URL for caching |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama LLM endpoint |
| `OLLAMA_MODEL` | `llama3.1` | Default Ollama model |
| `AUTH_PROVIDER` | `local` | `local` or `supabase` |
| `PORT` | `5001` | Backend listen port |
| `APP_ENV` | `development` | `development`, `testing`, or `production` |
| `DATA_RETENTION_DAYS` | `90` | Auto-delete old sessions (0 = off) |
| `MAX_STORAGE_GB` | `50` | Storage warning threshold |
| `OPENAI_API_KEY` | _(none)_ | For OpenAI GPT models |
| `ANTHROPIC_API_KEY` | _(none)_ | For Anthropic Claude models |
| `GOOGLE_API_KEY` | _(none)_ | For Google Gemini models |

## Project Layout

```
backend/
├── config.py                    # Config classes (dev/test/prod)
├── run.py                       # Entry point
├── requirements.txt
├── app/
│   ├── __init__.py              # App factory (create_app)
│   ├── models/
│   │   └── __init__.py          # SQLAlchemy models (User, Investigation, Session, Chunk, Entity, ...)
│   ├── routes/
│   │   ├── admin.py             # Storage + cleanup
│   │   ├── analyze.py           # RAG queries, MITRE, IOCs, entities, graph, hashes, compare
│   │   ├── auth.py              # Authentication
│   │   ├── chats.py             # Chat threads + messages
│   │   ├── config.py            # LLM provider + processing config
│   │   ├── export.py            # Session data export
│   │   ├── health.py            # Health check
│   │   ├── investigations.py    # Investigation CRUD
│   │   ├── parse.py             # UAC archive upload + parsing
│   │   ├── search.py            # Full-text search
│   │   └── timeline.py          # Timeline events + Plaso
│   └── services/
│       ├── agentic_rag_service.py    # Multi-tool agent RAG
│       ├── analyzer_service.py       # Query analysis + LLM orchestration
│       ├── cleanup_service.py        # Disk cleanup + retention
│       ├── embedding_service.py      # ChromaDB vector embeddings
│       ├── entity_extractor.py       # NER from parsed content
│       ├── export_service.py         # Export formatting
│       ├── graph_rag_service.py      # Entity graph queries
│       ├── ioc_service.py            # IOC extraction + correlation
│       ├── mitre_service.py          # MITRE ATT&CK mapping
│       ├── parser_service.py         # UAC archive extraction + chunking
│       ├── rag_service.py            # Core RAG retrieval
│       ├── relevance_feedback_service.py
│       ├── session_manager.py        # Session lifecycle
│       ├── tiered_rag_service.py     # Multi-tier RAG
│       ├── timeline_service.py       # Timeline construction
│       ├── auth_providers/           # Local + Supabase auth
│       └── llm_providers/            # Ollama, OpenAI, Claude, Gemini
└── uploads/                          # Temporary upload storage
```

## Database

### Local Development (SQLite)

Tables are auto-created on first run. Data is stored at `~/.uac-ai/uac-ai.db`.

### Production (PostgreSQL)

Set `DATABASE_URL` to a PostgreSQL connection string. Tables are created by the `database/init/002_schema.sql` init script when using Docker, or via Flask-Migrate:

```bash
flask db upgrade
```

Key models: `User`, `AuthToken`, `Investigation`, `Session`, `Chunk`, `ChunkEmbedding`, `Entity`, `EntityRelationship`, `QueryLog`, `ChatThread`, `ChatMessage`, `IOCEntry`, `MITRETechnique`.
