#!/usr/bin/env bash
# Blisscco: PRODUCTION Supabase database ka backup (pg_dump, custom format).
#
# READ-ONLY: sirf padhta hai (pg_dump). Production me kuch likhta/badalta nahi.
# Connection string kabhi file me nahi likhi jati: environment variable SUPABASE_DB_URL se aati hai aur kahin print nahi hoti.
#
# Use:
#   export SUPABASE_DB_URL='<Supabase Dashboard > Connect > Session pooler connection string>'
#   bash scripts/backup-production-db.sh            # backup banao + verify
#   bash scripts/backup-production-db.sh --check    # sirf tools/URL jaancho, backup mat banao
#
# Output: ./backups/blisscco-prod-<UTC time>.dump (+ .sha256). backups/ git me kabhi nahi jata (.gitignore).
# Dump me asli user/payment data hota hai: file ko safe jagah rakho (encrypted drive), kisi ko mat bhejo, git/chat me mat daalo.
set -euo pipefail

MODE="backup"
if [ "${1:-}" = "--check" ]; then MODE="check"; elif [ -n "${1:-}" ]; then echo "Unknown option: $1 (use --check or no option)" >&2; exit 2; fi

fail() { echo "ERROR: $*" >&2; exit 1; }

command -v pg_dump >/dev/null 2>&1 || fail "pg_dump not found. Install PostgreSQL client tools (Termux: pkg install postgresql; Ubuntu: apt install postgresql-client)."
command -v pg_restore >/dev/null 2>&1 || fail "pg_restore not found (comes with the PostgreSQL client tools)."
command -v psql >/dev/null 2>&1 || fail "psql not found (comes with the PostgreSQL client tools)."
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum not found."

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL first (Supabase Dashboard > Connect > Session pooler). It is never stored in the repo.}"
case "$SUPABASE_DB_URL" in
  postgres://*|postgresql://*) ;;
  *) fail "SUPABASE_DB_URL must start with postgresql://" ;;
esac

# pg_dump ka major version server se kam nahi hona chahiye (warna pg_dump mana kar deta hai ya adhura dump deta hai).
SERVER_NUM="$(psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -tA -c 'show server_version_num' 2>/dev/null)" || fail "Cannot connect with SUPABASE_DB_URL (check password / host / network)."
SERVER_MAJOR=$(( SERVER_NUM / 10000 ))
CLIENT_MAJOR="$(pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
echo "Server major version: ${SERVER_MAJOR}, pg_dump major version: ${CLIENT_MAJOR}"
if [ "$CLIENT_MAJOR" -lt "$SERVER_MAJOR" ]; then
  fail "pg_dump (${CLIENT_MAJOR}) is older than the server (${SERVER_MAJOR}). Install a newer PostgreSQL client."
fi

if [ "$MODE" = "check" ]; then
  echo "Check OK: tools found, connection works, versions compatible. No backup was made."
  exit 0
fi

OUT_DIR="${BACKUP_DIR:-backups}"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${OUT_DIR}/blisscco-prod-${STAMP}.dump"

umask 077
# public + private = app ka sara data/functions. auth = users (profiles ka foreign key). Storage ke asli image files is dump me nahi aate (neeche runbook dekho).
if ! pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner --no-privileges --schema=public --schema=private --schema=auth --file="$FILE"; then
  rm -f "$FILE"
  fail "pg_dump failed. No backup file was kept."
fi

# Verify: dump padhne layak hai aur usme app ki tables hain.
LIST="$(pg_restore --list "$FILE")" || { rm -f "$FILE"; fail "Backup file is not readable by pg_restore. It was deleted."; }
echo "$LIST" | grep -q "TABLE public campaigns" || { rm -f "$FILE"; fail "Backup does not contain public.campaigns. It was deleted."; }

sha256sum "$FILE" > "${FILE}.sha256"
SIZE="$(wc -c < "$FILE" | tr -d ' ')"
echo "Backup OK: ${FILE} (${SIZE} bytes)"
echo "Checksum:  ${FILE}.sha256"
echo "Next: copy this file to a safe place OUTSIDE this project (encrypted drive / private storage). Do not commit it."
