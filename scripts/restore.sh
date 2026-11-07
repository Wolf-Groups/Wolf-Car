#!/usr/bin/env bash
# Replaces the production database (and optionally the photos) from a backup.
#   scripts/restore.sh /var/backups/wolfcar/db-20260927-0000.dump [uploads.tgz]
# The database is replaced in one transaction: a dump that cannot be read, or a
# statement that fails, leaves it exactly as it was. The images tagged latest
# start afterwards: to go back to the version before a deploy, tag :previous as
# :latest first, or the new API migrates the restored data again.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
DUMP="${1:?usage: scripts/restore.sh <db.dump> [uploads.tgz]}"
UPLOADS="${2:-}"
[[ -f "$DUMP" ]] || { echo "no such file: $DUMP" >&2; exit 1; }
[[ -z "$UPLOADS" || -f "$UPLOADS" ]] || { echo "no such file: $UPLOADS" >&2; exit 1; }

sql=$(mktemp)
trap 'rm -f "$sql"' EXIT

dc up -d db
# the dump as SQL first: a file that cannot be read stops here, before anything is stopped
dc exec -T db pg_restore --no-owner --no-privileges -f - < "$DUMP" > "$sql"

dc stop web api
# from an empty schema: --clean drops only what the dump holds, so a table added since
# (with foreign keys into the dumped ones) would stop it half-way
if ! { echo 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'; cat "$sql"; } |
  dc exec -T db psql -U wolfcar -d wolfcar -v ON_ERROR_STOP=1 -q --single-transaction >/dev/null; then
  echo "restore failed; the database is as it was" >&2
  dc up -d
  exit 1
fi

if [[ -n "$UPLOADS" ]]; then
  # node (uid 1000) owns /app/api/storage in the API image
  docker run --rm -i -v wolfcar-prod_uploads:/uploads alpine \
    sh -c 'rm -rf /uploads/* && tar xzf - -C /uploads && chown -R 1000:1000 /uploads' < "$UPLOADS"
fi

dc up -d
wait_healthy 240
echo "restored from $DUMP${UPLOADS:+ and $UPLOADS}"
