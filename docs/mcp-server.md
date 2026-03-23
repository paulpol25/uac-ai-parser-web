# UAC AI MCP Server

Model Context Protocol (MCP) server that exposes the full UAC AI platform as tools for AI assistants.

## Overview

The MCP server wraps every UAC AI backend endpoint as a callable tool, allowing AI assistants (Claude Desktop, VS Code Copilot, custom agents) to directly perform forensic analysis: upload archives, query data, extract IOCs, map MITRE techniques, explore entity graphs, and more.

## Installation

### Via Docker (recommended)

The MCP server is included in `docker-compose.yml` and starts automatically with `./start.sh`. It exposes SSE transport on port 8811.

### Standalone

```bash
cd mcp-server
pip install -e .
```

## Transports

| Transport | Use Case | Command / URL |
|---|---|---|
| **stdio** | Claude Desktop, local AI tools | `uac-ai-mcp` |
| **SSE** | Remote clients, Docker deployment | `http://localhost:8811/sse` |

Set `MCP_TRANSPORT=sse` and `SSE_PORT=8811` for SSE mode (Docker does this automatically).

## Configuration

Environment variables:

| Variable | Default | Description |
|---|---|---|
| `UAC_AI_API_URL` | `http://localhost:5001/api/v1` | Backend API base URL |
| `UAC_AI_USERNAME` | (none) | Auto-login username |
| `UAC_AI_PASSWORD` | (none) | Auto-login password |
| `UAC_AI_API_TOKEN` | (none) | Pre-authenticated JWT token |
| `MCP_TRANSPORT` | `stdio` | Transport: `stdio` or `sse` |
| `SSE_PORT` | `8811` | Port for SSE transport |
| `REDIS_URL` | (none) | Redis for session caching |
| `MCP_AUTH_TOKEN` | (none) | Token to secure the MCP SSE endpoint |
| `LOG_LEVEL` | `INFO` | Logging level |

## Client Configuration

### VS Code (GitHub Copilot)

Create `.vscode/mcp.json` in your workspace:

**Option A — SSE transport (Docker deployment):**

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

**Option B — stdio transport (standalone / local dev):**

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

> **Note:** The `MCP_AUTH_TOKEN` value is in your `.env` file. If running via Docker, the MCP server uses SSE on port 8811 by default.

### Claude Desktop

Add to your `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

**Option A — stdio transport (recommended):**

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

> Requires the MCP server installed locally: `cd mcp-server && pip install -e .`

**Option B — SSE transport (remote Docker server):**

```json
{
  "mcpServers": {
    "uac-ai": {
      "type": "sse",
      "url": "http://your-server:8811/sse",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_AUTH_TOKEN"
      }
    }
  }
}
```

### Gemini CLI

Add the MCP server to your Gemini CLI settings file (`~/.gemini/settings.json`):

**Option A — stdio transport:**

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

> Requires the MCP server installed locally: `cd mcp-server && pip install -e .`

**Option B — SSE transport (remote Docker server):**

```json
{
  "mcpServers": {
    "uac-ai": {
      "type": "sse",
      "url": "http://your-server:8811/sse",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_AUTH_TOKEN"
      }
    }
  }
}
```

### Quick Reference

| Client | Config File | Recommended Transport |
|---|---|---|
| VS Code | `.vscode/mcp.json` | SSE (Docker) or stdio (local) |
| Claude Desktop | `claude_desktop_config.json` | stdio (local) or SSE (remote) |
| Gemini CLI | `~/.gemini/settings.json` | stdio (local) or SSE (remote) |

> **Tip:** For all stdio configurations, you need the MCP server package installed locally (`pip install -e .` from the `mcp-server/` directory). For SSE configurations, the server must be running (Docker handles this automatically).
```

## Tool Reference

### auth (3 tools)

| Tool | Description |
|---|---|
| `uac_login` | Authenticate with username/password |
| `uac_get_current_user` | Get current user profile |
| `uac_logout` | End session |

### investigations (5 tools)

| Tool | Description |
|---|---|
| `uac_list_investigations` | List all investigations |
| `uac_get_investigation` | Get investigation details with sessions |
| `uac_create_investigation` | Create new investigation |
| `uac_update_investigation` | Update name/description |
| `uac_delete_investigation` | Delete investigation and all data |

### sessions (5 tools)

| Tool | Description |
|---|---|
| `uac_get_session` | Get session details |
| `uac_get_session_status` | Check parse status (processing/ready/failed) |
| `uac_get_session_artifacts` | List parsed artifact files |
| `uac_get_session_stats` | Chunk counts, entity counts |
| `uac_delete_session` | Delete session |

### parse (1 tool)

| Tool | Description |
|---|---|
| `uac_upload_archive` | Upload and parse a UAC .tar.gz archive |

### analyze (7 tools)

| Tool | Description |
|---|---|
| `uac_query` | Natural language query (RAG) |
| `uac_agent_query` | Multi-step agent query |
| `uac_get_summary` | AI-generated incident summary |
| `uac_detect_anomalies` | Anomaly detection with scoring |
| `uac_get_suggestions` | AI-suggested investigation questions |
| `uac_context_preview` | Preview RAG context for a query |
| `uac_extract_iocs_legacy` | Extract IOCs (legacy endpoint) |

### timeline (3 tools)

| Tool | Description |
|---|---|
| `uac_get_timeline` | Get events with time/type filters |
| `uac_get_timeline_stats` | Event frequency distribution |
| `uac_correlate_events` | Group events by time windows |

### search (3 tools)

| Tool | Description |
|---|---|
| `uac_search_chunks` | Full-text search across chunks |
| `uac_get_search_filters` | Available filter categories |
| `uac_get_chunk` | Get a specific chunk by ID |

### entities (6 tools)

| Tool | Description |
|---|---|
| `uac_list_entities` | List extracted entities |
| `uac_search_entity` | Find chunks containing an entity |
| `uac_graph_neighbors` | Get related entities (1-N hops) |
| `uac_graph_path` | Find path between two entities |
| `uac_graph_stats` | Entity graph statistics |
| `uac_kill_chain_analysis` | Map entities to attack stages |

### iocs (7 tools)

| Tool | Description |
|---|---|
| `uac_extract_iocs` | Extract IOCs from session |
| `uac_correlate_iocs` | Cross-session IOC correlation |
| `uac_ioc_summary` | IOC summary by type |
| `uac_search_iocs` | Search IOCs by value/type |
| `uac_get_file_hashes` | Get file hash inventory |
| `uac_compare_hashes` | Compare hashes between sessions |
| `uac_search_hash` | Search for specific hashes |

### mitre (4 tools)

| Tool | Description |
|---|---|
| `uac_mitre_scan` | Scan session for ATT&CK techniques |
| `uac_get_mitre_mappings` | Get detected technique mappings |
| `uac_get_mitre_summary` | Tactic-level summary |
| `uac_compare_sessions` | Compare two sessions |

### export (2 tools)

| Tool | Description |
|---|---|
| `uac_export_session` | Export session in chosen format |
| `uac_get_export_formats` | List available export formats |

### config (9 tools)

| Tool | Description |
|---|---|
| `uac_get_processing_settings` | Get RAG & parsing settings |
| `uac_update_processing_settings` | Update settings |
| `uac_reset_processing_settings` | Reset to defaults |
| `uac_get_providers` | List LLM providers and status |
| `uac_set_provider_key` | Set API key for a provider |
| `uac_test_provider` | Test provider connectivity |
| `uac_get_models` | List available models |
| `uac_set_model` | Set active model |
| `uac_get_embedding_config` | Get embedding model config |

### chats (7 tools)

| Tool | Description |
|---|---|
| `uac_list_chats` | List chats for a session |
| `uac_create_chat` | Create new chat thread |
| `uac_get_chat` | Get chat with messages |
| `uac_update_chat` | Update chat title/pinned |
| `uac_delete_chat` | Delete chat |
| `uac_send_message` | Send message and get AI response |
| `uac_get_chat_messages` | Get chat history |

## Resources

| URI | Description |
|---|---|
| `uac://reference/mitre-tactics` | MITRE ATT&CK tactic reference |
| `uac://reference/artifact-types` | UAC artifact type taxonomy |
| `uac://reference/entity-types` | Supported entity types |
| `uac://reference/ioc-types` | IOC categories |

## Prompts

| Name | Description |
|---|---|
| `forensic_triage` | Structured triage workflow for a session |
| `ioc_investigation` | IOC deep-dive investigation prompt |

## Example Workflow (Claude Desktop)

```
User: Upload the file /tmp/server01.tar.gz to my "Ransomware 2024" investigation

Claude: [calls uac_list_investigations → finds id=3]
        [calls uac_upload_archive(file_path="/tmp/server01.tar.gz", investigation_id=3)]
        Done! Session d7a8... created and parsing started.

User: What persistence mechanisms were found?

Claude: [calls uac_get_session_status → ready]
        [calls uac_query(session_id="d7a8...", query="What persistence mechanisms were found?")]
        Found 3 persistence mechanisms:
        1. Crontab entry for /tmp/.hidden/beacon...
        2. Systemd service 'update-helper'...
        3. .bashrc modification adding reverse shell...

User: Run a MITRE ATT&CK scan

Claude: [calls uac_mitre_scan(session_id="d7a8...")]
        Mapped 12 techniques across 6 tactics:
        - T1053.003 (Cron) - Scheduled Task
        - T1543.002 (Systemd Service) - Create/Modify System Process
        ...
```
