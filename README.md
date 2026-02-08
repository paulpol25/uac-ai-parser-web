# UAC AI - AI-Powered Forensic Analysis Platform

<div align="center">

**Transform your digital forensic investigations with AI-powered analysis**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10+-green.svg)](https://python.org)
[![React 18](https://img.shields.io/badge/React-18-61DAFB.svg)](https://reactjs.org)
[![Ollama](https://img.shields.io/badge/LLM-Ollama-orange.svg)](https://ollama.ai)

[Features](#features) • [Installation](#installation) • [Quick Start](#quick-start) • [Documentation](#documentation)

</div>

---

## Overview

UAC AI is a modern web-based platform for analyzing [UAC (Unix-like Artifacts Collector)](https://github.com/tclahr/uac) outputs using AI-powered semantic analysis. It combines traditional forensic techniques with local LLM capabilities to accelerate incident response and threat hunting.

### Why UAC AI?

- **🚀 Fast Analysis**: Upload UAC archives and get instant AI-powered insights
- **🔒 Privacy First**: All processing happens locally - your data never leaves your machine
- **🤖 Smart AI**: Uses local LLMs via Ollama for deep forensic reasoning
- **📊 Visual Timeline**: Interactive timeline with filtering and search
- **🎯 Anomaly Detection**: AI-driven detection of suspicious artifacts
- **💬 Natural Language**: Query your forensic data in plain English

---

## Features

### 🗂️ Investigation Management
- Create and manage multiple investigations
- Organize sessions by case number
- Track investigation status and progress
- Multi-user support with authentication

### 📤 Smart Upload & Parsing
- Drag-and-drop UAC archive upload (tar.gz, zip)
- Background processing with progress tracking
- Automatic artifact categorization
- Chunked storage for efficient RAG retrieval

### 🤖 AI-Powered Analysis
- **Interactive Chat**: Ask questions about your forensic data
- **Agent Mode**: Multi-step investigation with reasoning steps
- **Fast Mode**: Quick single-query responses
- **Suggested Questions**: AI-generated relevant queries
- **Context Preview**: See what data the AI will use

### ⏱️ Timeline Viewer
- Interactive event timeline
- Filter by category, severity, and date range
- Full-text search across all events
- Jump to event details
- "Ask AI" integration for any event

### 🔍 Log Search
- Full-text search across all artifacts
- Category and file-type filtering
- Keyword-based queries
- Export search results

### 📊 Analysis Actions
- **Generate Summary**: Get an executive overview of the forensic data
- **Detect Anomalies**: AI-powered anomaly detection with scoring
- **Extract IOCs**: Pull indicators of compromise (IPs, domains, hashes)

### 📤 Export Options
- JSONL for Timesketch
- JSON for programmatic access
- Markdown reports
- CSV exports

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Browser                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    React SPA (Vite + TypeScript)                   │  │
│  │    Dashboard │ AI Chat │ Timeline │ Search │ Investigations       │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ REST API + SSE Streaming
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Flask API Server (:8080)                         │
│      Parsing │ Analysis │ Timeline │ Investigations │ Auth              │
├─────────────────────────────────────────────────────────────────────────┤
│                          Service Layer                                   │
│   ┌───────────────┐  ┌───────────────┐  ┌───────────────────────────┐  │
│   │  UAC Parser   │  │  RAG Engine   │  │   Analyzer (LLM Agent)    │  │
│   └───────────────┘  └───────────────┘  └───────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────────────┘
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
       ┌──────────┐     ┌──────────┐     ┌──────────┐
       │ SQLite   │     │ ChromaDB │     │  Ollama  │
       │ (Meta)   │     │ (Vectors)│     │  (LLM)   │
       └──────────┘     └──────────┘     └──────────┘
```

---

## Installation

### Prerequisites

- **Python 3.10+**
- **Node.js 18+** (for frontend development)
- **[Ollama](https://ollama.ai/)** (for local LLM)

### 1. Clone the Repository

```bash
git clone https://github.com/paulpol25/uac-ai-parser-web.git
cd uac-ai-parser-web
```

### 2. Install Ollama & Pull a Model

```bash
# Install Ollama from https://ollama.ai/

# Pull recommended models
ollama pull llama3.1        # Good balance of speed and quality
ollama pull deepseek-r1:7b  # Best for complex reasoning (recommended)
```

### 3. Set Up the Backend

```bash
cd backend

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the backend
python run.py
```

The API will be available at `http://localhost:8080`

### 4. Set Up the Frontend

```bash
cd frontend

# Install dependencies
npm install

# Run development server
npm run dev
```

The UI will be available at `http://localhost:3000`

---

## Quick Start

### 1. Create an Account

Navigate to `http://localhost:3000` and create a new account or log in.

### 2. Create an Investigation

1. Go to **Investigations** in the sidebar
2. Click **New Investigation**
3. Enter a name and optional case number
4. Click **Create**

### 3. Upload UAC Archive

1. From the **Dashboard**, select your investigation
2. Drag and drop your UAC `.tar.gz` or `.zip` file
3. Wait for parsing to complete (progress shown in real-time)

### 4. Analyze with AI

1. Go to **AI Analysis** in the sidebar
2. Select your investigation and session
3. Ask questions like:
   - "What are the indicators of compromise?"
   - "Show suspicious network connections"
   - "What persistence mechanisms are present?"

### 5. Explore the Timeline

1. Go to **Timeline** to see all events chronologically
2. Filter by category, severity, or date range
3. Click any event to see details
4. Use "Ask AI" to investigate specific events

---

## Configuration

### Environment Variables

Create a `.env` file in the backend directory:

```env
# LLM Configuration
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1

# Database
DATABASE_PATH=~/.uac-ai/uac-ai.db

# ChromaDB
CHROMA_PERSIST_DIR=~/.uac-ai/chroma

# Upload limits
MAX_UPLOAD_SIZE=500MB
```

### Recommended LLM Models

| Model | Size | Best For | Notes |
|-------|------|----------|-------|
| `llama3.1` | 8B | General analysis | Good balance of speed/quality |
| `deepseek-r1:7b` | 7B | Complex reasoning | Best for anomaly detection |
| `codellama` | 13B | Code analysis | Good for script review |
| `mistral` | 7B | Fast responses | Quick Q&A sessions |

---

## Documentation

- [How to Use](docs/how-to-use.md) - Detailed usage guide
- [Architecture Overview](docs/architecture.md) - System design and components
- [Design System](docs/design-system.md) - UI/UX guidelines
- [Requirements](docs/requirements.md) - Feature specifications

---

## Development

### Backend (Flask)

```bash
cd backend
python run.py  # Runs on port 8080
```

### Frontend (React + Vite)

```bash
cd frontend
npm run dev    # Runs on port 3000
npm run build  # Production build
```

### Project Structure

```
uac-ai/
├── backend/
│   ├── app/
│   │   ├── models/         # SQLAlchemy models
│   │   ├── routes/         # API endpoints
│   │   └── services/       # Business logic
│   ├── config.py           # Configuration
│   └── run.py              # Entry point
├── frontend/
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── pages/          # Page components
│   │   ├── services/       # API client
│   │   └── stores/         # Zustand stores
│   └── vite.config.ts
├── docs/                   # Documentation
└── README.md
```

---

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- [UAC](https://github.com/tclahr/uac) - Unix-like Artifacts Collector
- [Ollama](https://ollama.ai/) - Local LLM runtime
- [ChromaDB](https://www.trychroma.com/) - Vector database
- [LangChain](https://langchain.com/) - LLM framework

---

<div align="center">

Made with ❤️ for the DFIR community

</div>
