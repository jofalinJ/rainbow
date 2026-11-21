#!/usr/bin/env bash
# Read-only encrypted backup check: never connects to, mutates, or restores a database.
set -Eeuo pipefail
umask 077

if [[ "$#" -ne 1 ]]; then
  printf 'Usage: AGE_IDENTITY_FILE=/secure/path/key.txt %s /secure/backup.pgcustom.age\n' "$0" >&2
  exit 2
fi
archive="$1"
if [[ ! -f "$archive" || ! -r "$archive" ]]; then
  printf 'Encrypted backup not readable.\n' >&2
  exit 2
fi
if [[ ! -f "$AGE_IDENTITY_FILE" || ! -r "$AGE_IDENTITY_FILE" ]]; then
  printf 'AGE_IDENTITY_FILE must point to a readable private age identity file.\n' >&2
  exit 2
fi
for command_name in age pg_restore; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$command_name" >&2
    exit 2
  fi
done

# Only the PostgreSQL custom archive TOC is parsed. No plaintext copy is
# written to disk and no restore is attempted against any database.
if ! age --decrypt --identity "$AGE_IDENTITY_FILE" "$archive" | pg_restore --list >/dev/null; then
  printf 'Encrypted backup verification FAILED: decrypt or archive TOC invalid.\n' >&2
  exit 1
fi
printf 'Encrypted backup header and archive TOC verified.\n'
printf 'This is NOT a full recovery test. Next restore to an isolated, non-production database and check data.\n'