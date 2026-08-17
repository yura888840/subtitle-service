#!/usr/bin/env bash
# deploy.sh — build & (re)deploy the service with one command
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Checking environment..."
command -v docker >/dev/null || { echo "Docker is not installed."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 not found."; exit 1; }

if [[ ! -f .env ]]; then
  echo "==> .env not found — creating from .env.example"
  cp .env.example .env
fi

echo "==> Building image (first build downloads PyTorch — be patient)..."
docker compose build

echo "==> Restarting service..."
docker compose up -d

echo "==> Waiting for readiness..."
for i in {1..15}; do
  if wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1 || curl -sf http://127.0.0.1:3000/health >/dev/null 2>&1; then
    echo "==> Service is up: http://127.0.0.1:3000"
    docker compose ps
    echo ""
    echo "NOTE: the first job with each model downloads that model"
    echo "(large-v3 ~= 3 GB) into the whisper-models volume. Later jobs reuse it."
    exit 0
  fi
  sleep 2
done

echo "!! Service did not answer /health within 30 seconds. Logs:"
docker compose logs --tail=50
exit 1
