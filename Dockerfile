# UAC AI Parser - Multi-stage Docker Build
# 
# This Dockerfile builds both frontend and backend into a single container.
# For production use, consider separating into multiple containers.
#
# Build:
#   docker build -t uac-ai-parser .
#
# Run:
#   docker run -p 5000:5000 -v ~/.uac-ai:/app/data uac-ai-parser
#
# Run with Ollama (on host):
#   docker run -p 5000:5000 -v ~/.uac-ai:/app/data -e OLLAMA_BASE_URL=http://host.docker.internal:11434 uac-ai-parser

# =============================================================================
# Stage 1: Build Frontend
# =============================================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Install dependencies first (better caching)
COPY frontend/package*.json ./
RUN npm ci

# Copy source and build
COPY frontend/ ./
RUN npm run build

# =============================================================================
# Stage 2: Runtime Environment
# =============================================================================
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN useradd -m -u 1000 appuser

# Create data directories
RUN mkdir -p /app/data/uploads /app/data/chroma && \
    chown -R appuser:appuser /app/data

# Install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir gunicorn

# Copy backend source
COPY backend/ ./backend/

# Copy built frontend from Stage 1
COPY --from=frontend-builder /app/frontend/dist ./static

# Set environment defaults
ENV FLASK_ENV=production \
    FLASK_DEBUG=false \
    SECRET_KEY=change-me-in-production \
    DATABASE_PATH=/app/data/uac-ai.db \
    UPLOAD_FOLDER=/app/data/uploads \
    CHROMA_PERSIST_DIR=/app/data/chroma \
    OLLAMA_BASE_URL=http://host.docker.internal:11434 \
    OLLAMA_MODEL=llama3.1 \
    CORS_ORIGINS=http://localhost:3000,http://localhost:5000

# Expose port
EXPOSE 5000

# Volume for persistent data
VOLUME /app/data

# Switch to non-root user
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/api/v1/health')" || exit 1

# Start command - use gunicorn for production
# The --preload flag helps with ChromaDB initialization
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "4", "--timeout", "300", "--preload", "backend.run:app"]
