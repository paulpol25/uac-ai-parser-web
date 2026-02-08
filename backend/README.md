# UAC AI Parser - Backend

Flask API backend for UAC AI Parser with UI.

## Requirements

- Python 3.10+
- Flask 3.x
- Ollama (for LLM inference)

## Setup

```bash
# Create virtual environment
python -m venv .venv

# Activate (Windows)
.venv\Scripts\activate

# Activate (Linux/Mac)
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

## Running

```bash
# Development
python run.py

# Or with Flask CLI
flask run --port 8080
```

## API Endpoints

- `GET /api/v1/health` - Health check
- `POST /api/v1/parse` - Upload and parse UAC archive
- `POST /api/v1/analyze/query` - AI query (SSE streaming)
- `GET /api/v1/analyze/summary` - Generate summary
- `GET /api/v1/analyze/anomalies` - Detect anomalies
- `GET /api/v1/timeline` - Get timeline data
- `GET /api/v1/export` - Export data
- `GET /api/v1/config/models` - List Ollama models

## Environment Variables

- `APP_ENV` - Configuration environment (development, testing, production)
- `SECRET_KEY` - Flask secret key (required in production)
- `OLLAMA_BASE_URL` - Ollama API URL (default: http://localhost:11434)
- `OLLAMA_MODEL` - Default model (default: llama3.1)
