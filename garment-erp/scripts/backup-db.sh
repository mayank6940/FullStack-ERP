#!/usr/bin/env bash
set -euo pipefail

# Local PostgreSQL backup script
# Usage:
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres DB_NAME=garment_erp S3_BUCKET=s3://my-backups ./scripts/backup-db.sh

TS=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR=${BACKUP_DIR:-./backups}
DB_NAME=${DB_NAME:-garment_erp}
KEEP_DAYS=${KEEP_DAYS:-30}

mkdir -p "$BACKUP_DIR"
OUT_FILE="$BACKUP_DIR/${DB_NAME}_${TS}.sql.gz"

pg_dump -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" "$DB_NAME" | gzip > "$OUT_FILE"

echo "Backup created: $OUT_FILE"

if [[ -n "${S3_BUCKET:-}" ]]; then
  aws s3 cp "$OUT_FILE" "$S3_BUCKET/"
  echo "Uploaded to: $S3_BUCKET"
fi

find "$BACKUP_DIR" -type f -name "${DB_NAME}_*.sql.gz" -mtime +"$KEEP_DAYS" -delete

echo "Old backups pruned (>${KEEP_DAYS} days)."
