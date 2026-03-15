#!/bin/bash
# Clean rebuild script for UAC AI Parser Docker containers
# Usage: ./rebuild.sh [--keep-data] [--no-cache]
set -e

KEEP_DATA=false
NO_CACHE=""

for arg in "$@"; do
  case $arg in
    --keep-data) KEEP_DATA=true ;;
    --no-cache)  NO_CACHE="--no-cache" ;;
  esac
done

echo "========================================"
echo "UAC AI Parser - Clean Rebuild"
echo "========================================"
echo ""

# Kill stale processes on ports 5001 and 3000
for PORT in 5001 3000; do
  PIDS=$(lsof -ti:$PORT 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "Killing processes on port $PORT..."
    kill -9 $PIDS 2>/dev/null || true
  fi
done

# Stop and remove containers
echo "Stopping containers..."
docker compose down 2>/dev/null || true

# Remove old images
echo "Removing old images..."
docker compose rm -f 2>/dev/null || true
docker rmi uac-ai-with-ui-backend 2>/dev/null || true
docker rmi uac-ai-with-ui-frontend 2>/dev/null || true

# Volume handling
if [ "$KEEP_DATA" = false ]; then
  read -p "Remove persistent data volumes? (y/N): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Removing volumes..."
    docker compose down -v
  else
    echo "Keeping volumes (data preserved)"
  fi
fi

# Clean build cache
echo "Cleaning build cache..."
docker builder prune -f 2>/dev/null || true

echo ""
echo "Building fresh images ${NO_CACHE:+(no cache)}..."
docker compose build $NO_CACHE

echo ""
echo "========================================"
echo "Build completed!"
echo "========================================"
echo ""

read -p "Start containers now? (Y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
  echo "Starting containers..."
  docker compose up -d

  echo ""
  echo "Waiting for health checks..."
  sleep 5

  # Check backend health
  if docker compose ps --format json 2>/dev/null | grep -q '"Health":"healthy"'; then
    echo "Backend: healthy"
  else
    echo "Backend: starting (check logs with: docker compose logs -f backend)"
  fi

  echo ""
  echo "========================================"
  echo "Application is running!"
  echo "========================================"
  echo ""
  echo "  Frontend: http://localhost:3000"
  echo "  Backend:  http://localhost:5001/api/v1"

  # Try to detect server IP
  SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  if [ -n "$SERVER_IP" ] && [ "$SERVER_IP" != "127.0.0.1" ]; then
    echo ""
    echo "  Remote:   http://$SERVER_IP:3000"
  fi

  echo ""
  echo "  Logs:  docker compose logs -f"
  echo "  Stop:  docker compose down"
fi
