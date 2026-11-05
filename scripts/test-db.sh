#!/usr/bin/env bash
# Sobe um PostgreSQL temporário, aplica um stub mínimo do Supabase,
# roda todas as migrations e executa os testes SQL em supabase/tests.
# Requer binários do PostgreSQL (initdb/pg_ctl/psql) instalados.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PATH="$PG_BIN:$PATH"
PORT="${PG_TEST_PORT:-54329}"
WORK="$(mktemp -d)"
RUN_AS=()

# O PostgreSQL não roda como root.
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -r -m postgres
  chown postgres "$WORK"
  RUN_AS=(runuser -u postgres --)
fi

cleanup() {
  "${RUN_AS[@]}" pg_ctl -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"${RUN_AS[@]}" initdb -D "$WORK/data" -U postgres --auth=trust >/dev/null
"${RUN_AS[@]}" pg_ctl -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null

PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)

run_suite() {
  local test_file="$1"
  "${PSQL[@]}" -d postgres -c "drop database if exists t" -c "create database t" >/dev/null 2>&1 || return 1
  "${PSQL[@]}" -d t -f "$ROOT/supabase/tests/_supabase_stub.sql" >/dev/null || return 1
  for m in "$ROOT"/supabase/migrations/*.sql; do
    "${PSQL[@]}" -d t -f "$m" >/dev/null || { echo "✗ migration falhou: $(basename "$m")"; return 1; }
  done
  echo "▶ $(basename "$test_file")"
  "${PSQL[@]}" -d t -o /dev/null -f "$test_file" 2>&1 | sed -e 's/^psql:.*NOTICE:  /  /'
}

status=0
for t in "$ROOT"/supabase/tests/[0-9]*_test.sql; do
  run_suite "$t" || status=1
done
exit $status
