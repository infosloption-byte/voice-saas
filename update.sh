#!/bin/bash
# update.sh — Rebuild and redeploy after code changes
# Usage: sudo bash update.sh [service]   (e.g. "frontend" or "backend" or leave blank for all)
set -euo pipefail

cd /var/www/voxora
SERVICE=${1:-""}

echo "[update] Pulling latest code..."
git pull

if [[ -n "$SERVICE" ]]; then
    echo "[update] Rebuilding $SERVICE..."
    docker compose -f docker-compose.prod.yml build "$SERVICE"
    docker compose -f docker-compose.prod.yml up -d "$SERVICE"
else
    echo "[update] Rebuilding all services..."
    docker compose -f docker-compose.prod.yml build
    docker compose -f docker-compose.prod.yml up -d
fi

# Re-run migrations in case schema changed
docker compose -f docker-compose.prod.yml exec -T backend php artisan migrate --force

echo "[update] Done. Running containers:"
docker compose -f docker-compose.prod.yml ps
