# MCP Server Dockerfile — UAC AI Parser tool bridge
# Multi-stage build for smaller image

# --- Builder stage ---
FROM python:3.12-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends gcc && \
    rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY uac_ai_mcp/ ./uac_ai_mcp/

RUN pip install --no-cache-dir build && \
    python -m build --wheel --outdir /build/dist && \
    pip wheel --no-cache-dir --wheel-dir /build/wheels /build/dist/*.whl

# --- Runtime stage ---
FROM python:3.12-slim

WORKDIR /app

# Create non-root user
RUN useradd -m -u 1000 mcp

COPY --from=builder /build/wheels /tmp/wheels
RUN pip install --no-cache-dir /tmp/wheels/*.whl && \
    rm -rf /tmp/wheels

USER mcp

EXPOSE 8811

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD python -c "import uac_ai_mcp; print('ok')" || exit 1

ENTRYPOINT ["uac-ai-mcp"]
