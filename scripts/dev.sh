#!/usr/bin/env bash
#
# DevDigest local bootstrap — bring the whole stack up from zero.
#
#   ./scripts/dev.sh              # full: docker → migrate → seed → server + client
#   ./scripts/dev.sh --no-seed    # skip the demo seed
#   ./scripts/dev.sh --no-client  # run only Postgres + API (no Next.js)
#   ./scripts/dev.sh --db-only    # just Postgres + migrate + seed, then exit
#
# Idempotent: re-running installs only what's missing, migrations and seed
# both upsert. Ctrl-C stops the dev servers and leaves Postgres running.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CONTAINER="devdigest-postgres"
RUN_SEED=1
RUN_CLIENT=1
DB_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --no-seed)   RUN_SEED=0 ;;
    --no-client) RUN_CLIENT=0 ;;
    --db-only)   DB_ONLY=1 ;;
    -h|--help)   sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
err()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; }

# All descendants of $1, deepest last. `pnpm dev` spawns a chain
# (subshell → pnpm → tsx watch → node), and killing only the subshell PID
# orphans everything below it — those orphans keep holding :3000/:3001 and make
# the *next* run fail with EADDRINUSE. Enumerate before killing: once the parent
# dies its children are reparented and `pgrep -P` can no longer find them.
descendants() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    printf '%s\n' "$child"
    descendants "$child"
  done
}

# Refuse to start on an occupied port, naming the culprit so it can be killed by
# hand. Never kills anything itself — an unrelated process may legitimately own
# the port.
require_free_port() {
  local port="$1" label="$2" pid
  command -v lsof >/dev/null || return 0   # no lsof: skip the check rather than guess
  pid="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
  [ -n "$pid" ] || return 0
  err "port $port ($label) is already in use:"
  ps -o pid,etime,command -p "$pid" 2>/dev/null | tail -1 | sed 's/^/    /' >&2
  printf '\n    This is usually a dev server left over from an earlier run.\n' >&2
  printf '    Stop it, then re-run:\n\n        kill %s\n\n' "$pid" >&2
  exit 1
}

# --- prerequisites -----------------------------------------------------------
command -v docker >/dev/null || { echo "docker not found"; exit 1; }
command -v pnpm   >/dev/null || { echo "pnpm not found (npm i -g pnpm)"; exit 1; }

# Fail fast: check this BEFORE docker/migrate/seed, so an occupied port is
# reported in a second rather than after a full bootstrap.
if [ "$DB_ONLY" -eq 0 ]; then
  require_free_port 3001 "API"
  [ "$RUN_CLIENT" -eq 1 ] && require_free_port 3000 "web"
fi

# --- env files ---------------------------------------------------------------
for dir in server client; do
  if [ ! -f "$dir/.env" ] && [ -f "$dir/.env.example" ]; then
    cp "$dir/.env.example" "$dir/.env"
    warn "created $dir/.env from .env.example — add your API keys (OPENAI/ANTHROPIC/GITHUB_TOKEN) in server/.env"
  fi
done

# --- Postgres ----------------------------------------------------------------
# The container name is fixed (container_name: devdigest-postgres), so if one is
# already running (possibly under another compose project) we reuse it instead
# of failing on a name conflict. If it exists but is stopped, start it; else
# create it via compose.
state="$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "missing")"
case "$state" in
  running) log "Postgres container already running — reusing it" ;;
  exited|created) log "starting existing Postgres container"; docker start "$CONTAINER" >/dev/null ;;
  *)       log "starting Postgres (docker compose up -d)"; docker compose up -d ;;
esac

log "waiting for Postgres to be healthy"
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "starting")"
  [ "$status" = "healthy" ] && break
  sleep 1
done
[ "${status:-}" = "healthy" ] || { echo "Postgres did not become healthy in time"; exit 1; }
log "Postgres healthy"

# --- install deps (only if missing) ------------------------------------------
install_if_needed() {
  if [ ! -d "$1/node_modules" ]; then
    log "installing deps in $1"
    (cd "$1" && pnpm install)
  fi
}
install_if_needed server
[ "$DB_ONLY" -eq 0 ] && [ "$RUN_CLIENT" -eq 1 ] && install_if_needed client

# --- migrate + seed ----------------------------------------------------------
log "applying migrations"
(cd server && pnpm db:migrate)

if [ "$RUN_SEED" -eq 1 ]; then
  log "seeding demo data"
  (cd server && pnpm db:seed)
fi

if [ "$DB_ONLY" -eq 1 ]; then
  log "DB ready. Postgres is running; server/client not started (--db-only)."
  exit 0
fi

# --- dev servers -------------------------------------------------------------
SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] || return 0
  log "shutting down dev servers (Postgres stays up; stop it with: docker compose down)"
  # Kill the whole tree, not just the subshell — see descendants() above.
  local pids
  pids="$(descendants "$SERVER_PID"; printf '%s\n' "$SERVER_PID")"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 1
  # shellcheck disable=SC2086
  kill -9 $pids 2>/dev/null || true
}
trap cleanup EXIT INT TERM

log "starting API on :3001 (server)"
(cd server && pnpm dev) &
SERVER_PID=$!

if [ "$RUN_CLIENT" -eq 1 ]; then
  log "starting web on :3000 (client) — Ctrl-C to stop both"
  (cd client && pnpm dev)
else
  log "API running (PID $SERVER_PID) — Ctrl-C to stop"
  wait "$SERVER_PID"
fi
