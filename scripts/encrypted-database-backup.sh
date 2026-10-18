#!/usr/bin/env bash
# Encrypted, operator-run PostgreSQL backup. This script never mutates the database.
set -Eeuo pipefail
umask 077
for name in PGHOST PGUSER PGDATABASE AGE_RECIPIENT; do
  if [[ -z "${!name:-}" ]]; then
    printf 'Missing required environment variable: %s\n' "$name" >&2
    exit 2
  fi
done
for cmd in pg_dump age; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf '%s must be installed before backing up.\n' "$cmd" >&2
    exit 2
  fi
done
export PGSSLMODE=require
export PGCONNECT_TIMEOUT=20
dir="${RAINBOW_BACKUP_DIR:-./backups}"
mkdir -p "$dir"
tmp="$(mktemp "$dir/.rainbow-backup.XXXXXXXX")"
trap 'rm -f "$tmp"' EXIT
name="rainbow-$(date -u +%Y%m%dT%H%M%SZ)-$$.pgcustom.age"
# pg_dump uses PGHOST/PGPORT/PGUSER/PGDATABASE and ~/.pgpass; the private age key is NOT needed to make backups.
pg_dump --format=custom --no-owner --no-acl --dbname="$PGDATABASE" |
  age -r "$AGE_RECIPIENT" > "$tmp"
bytes="$(wc -c < "$tmp" | tr -d ' ')"
if [[ "$bytes" -lt 1024 ]]; then
  printf 'Backup output unexpectedly small; refusing to mark it valid.\n' >&2
  exit 1
fi
mv "$tmp" "$dir/$name"
trap - EXIT
printf 'Encrypted PostgreSQL archive: %s (%s bytes)\n' "$dir/$name" "$bytes"
if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$dir/$name"
elif command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$dir/$name"
fi
printf 'Next: decrypt and restore to an ISOLATED test database to verify recovery.\n'
