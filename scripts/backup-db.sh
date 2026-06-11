#!/usr/bin/env bash
#
# Voxora database backup.
#
# Dumps the MySQL database, compresses it, keeps a local rolling window, and
# (optionally) uploads to S3. Designed to run from cron on the host that runs
# docker-compose.
#
# Usage:
#   ./scripts/backup-db.sh
#
# Required env (read from the project .env if present, or the environment):
#   MYSQL_ROOT_PASSWORD   - MySQL root password
# Optional env:
#   DB_DATABASE           - database name (default: voice_saas)
#   DB_CONTAINER          - docker container name of MySQL (default: voice_db)
#   BACKUP_DIR            - local backup directory (default: ./backups)
#   BACKUP_KEEP_DAYS      - prune local dumps older than N days (default: 14)
#   BACKUP_S3_BUCKET      - if set, upload to s3://$BACKUP_S3_BUCKET/db/
#
# Cron example (daily at 03:15):
#   15 3 * * * cd /opt/voice-saas && ./scripts/backup-db.sh >> /var/log/voxora-backup.log 2>&1

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# Load .env if present (without overriding already-exported vars)
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env || true)
  set +a
fi

DB_DATABASE="${DB_DATABASE:-voice_saas}"
DB_CONTAINER="${DB_CONTAINER:-voice_db}"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

if [[ -z "${MYSQL_ROOT_PASSWORD:-}" ]]; then
  echo "ERROR: MYSQL_ROOT_PASSWORD is not set." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/${DB_DATABASE}_${TS}.sql.gz"

echo "[$(date -Is)] Dumping $DB_DATABASE from container $DB_CONTAINER → $OUT"
docker exec -i "$DB_CONTAINER" \
  mysqldump --single-transaction --quick --routines --triggers \
  -u root -p"$MYSQL_ROOT_PASSWORD" "$DB_DATABASE" \
  | gzip -9 > "$OUT"

# Sanity check: a valid gzip dump is more than a few hundred bytes
if [[ "$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT")" -lt 500 ]]; then
  echo "ERROR: backup looks empty/too small — aborting." >&2
  rm -f "$OUT"
  exit 1
fi
echo "[$(date -Is)] Backup OK ($(du -h "$OUT" | cut -f1))"

# Optional S3 upload
if [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
  echo "[$(date -Is)] Uploading to s3://$BACKUP_S3_BUCKET/db/"
  aws s3 cp "$OUT" "s3://$BACKUP_S3_BUCKET/db/$(basename "$OUT")"
fi

# Prune old local backups
find "$BACKUP_DIR" -name "${DB_DATABASE}_*.sql.gz" -type f -mtime "+$BACKUP_KEEP_DAYS" -delete
echo "[$(date -Is)] Done. Local retention: ${BACKUP_KEEP_DAYS}d"
