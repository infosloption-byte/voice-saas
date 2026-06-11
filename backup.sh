#!/usr/bin/env bash
# Database backup — run daily via cron: 0 2 * * * /home/user/voice-saas/backup.sh
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-/home/user/voice-saas/backups}"
DB_CONTAINER="${DB_CONTAINER:-shared_mysql}"
# Load .env for credentials
source /home/user/voice-saas/.env 2>/dev/null || true
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"
docker exec "$DB_CONTAINER" mysqldump -u"${DB_USERNAME}" -p"${DB_PASSWORD}" "${DB_DATABASE}" \
  | gzip > "$BACKUP_DIR/voice_saas_${DATE}.sql.gz"
# Keep last 14 days
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +14 -delete
echo "Backup complete: voice_saas_${DATE}.sql.gz"
