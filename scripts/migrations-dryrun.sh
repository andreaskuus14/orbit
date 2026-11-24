#!/usr/bin/env bash
# Dry run of supabase/migrations on a throwaway local Postgres (no network, nothing touches the real database).
#  1. fresh:  apply every file in order on an empty database (with Supabase stand-ins) -> must all pass.
#  2. re-run: add a little data, then run every file again, each as one transaction (like pasting it into the
#     Supabase SQL editor). Reports which files are not safe to run twice and checks no data changed.
# Needs Postgres 15+ server binaries and pgvector (Ubuntu: apt install postgresql-16 postgresql-16-pgvector).
# Usage: scripts/migrations-dryrun.sh [--strict-rerun-from NNNN]
#   --strict-rerun-from 0012  also fail if any file numbered >= 0012 can't be re-run.
#   --autocommit              re-run pass without a transaction per file (shows partial-apply damage).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$ROOT/supabase/migrations"; DRY="$ROOT/supabase/dryrun"
STRICT_FROM=""; TX="--single-transaction"
while [ $# -gt 0 ]; do case "$1" in
  --strict-rerun-from) STRICT_FROM="${2:?number}"; shift 2;;
  --autocommit) TX=""; shift;;   # re-run statement by statement, to see what a half-applied file leaves behind
  *) echo "unknown option $1"; exit 2;; esac; done
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/initdb" ] || { echo "Postgres server binaries not found (set PGBIN)"; exit 2; }
TMP="$(mktemp -d)"; PORT=$((20000 + RANDOM % 20000))
AS=""; if [ "$(id -u)" = 0 ]; then AS="runuser -u postgres --"; chown postgres "$TMP"; fi  # initdb refuses root
cleanup() { $AS "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1; rm -rf "$TMP"; }
trap cleanup EXIT
$AS "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null || exit 2
$AS "$PGBIN/pg_ctl" -D "$TMP/data" -l "$TMP/pg.log" -o "-k $TMP -p $PORT -c listen_addresses=''" -w start >/dev/null || { cat "$TMP/pg.log"; exit 2; }
psqlq() { psql -X -q -v ON_ERROR_STOP=1 -h "$TMP" -p "$PORT" -U postgres -d postgres "$@"; }
fingerprint() { psqlq -At -c "select string_agg(t || '=' || n, ' ' order by t) from (
  select 'public.'||tablename t, (xpath('/row/c/text()', query_to_xml('select md5(coalesce(string_agg(x::text, '','' order by x::text), '''')) c from public.'||quote_ident(tablename)||' x', false, false, '')))[1]::text n
  from pg_tables where schemaname = 'public'
  union all select 'storage.buckets', md5(coalesce(string_agg(b::text, ',' order by b::text), '')) from storage.buckets b) s"; }

psqlq -f "$DRY/supabase-stub.sql" || exit 2
fail=0
echo "== fresh apply, in order"
for f in "$MIG"/*.sql; do
  if out=$(psqlq --single-transaction -f "$f" 2>&1); then echo "ok    $(basename "$f")"
  else echo "FAIL  $(basename "$f")"; echo "$out" | sed 's/^/      /'; fail=1; fi
done
[ $fail = 0 ] || { echo "Fresh apply failed."; exit 1; }
psqlq --single-transaction -f "$DRY/seed.sql" || { echo "seed failed"; exit 1; }

echo "== re-run each file on a database that already has it (one transaction per file)"
before=$(fingerprint); notsafe=()
for f in "$MIG"/*.sql; do
  name=$(basename "$f")
  if out=$(psqlq $TX -f "$f" 2>&1); then echo "ok    $name"
  else
    echo "NO    $name  ${TX:+(rolled back)}: $(echo "$out" | grep -m1 ERROR | sed 's/.*ERROR: *//')"
    notsafe+=("$name")
    if [ -n "$STRICT_FROM" ] && [ "${name:0:4}" \> "$(printf '%04d' $((10#$STRICT_FROM - 1)))" ]; then fail=1; fi
  fi
done
after=$(fingerprint)
if [ "$before" != "$after" ]; then
  echo "DATA CHANGED by a re-run:"; diff <(tr ' ' '\n' <<<"$before") <(tr ' ' '\n' <<<"$after"); fail=1
else echo "Data unchanged after re-runs."; fi
echo "Not safe to run twice (${#notsafe[@]}): ${notsafe[*]:-none}"
exit $fail
