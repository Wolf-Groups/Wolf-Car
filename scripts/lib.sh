# Shared helpers for the production scripts. Source it; do not run it.
# Bash only (uses BASH_SOURCE); the scripts run it with bash.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# docker compose for this project; DC is the same command as an array, for `timeout 300 "${DC[@]}" ...`
DC=(docker compose -f "$ROOT/compose.prod.yml" --env-file "$ROOT/deploy/prod.env")
dc() {
  "${DC[@]}" "$@"
}

# Exports POSTGRES_PASSWORD and PUBLIC_URL from deploy/prod.env.
load_env() {
  if [[ ! -f "$ROOT/deploy/prod.env" ]]; then
    echo "missing $ROOT/deploy/prod.env — run scripts/make-env.sh first" >&2
    return 1
  fi
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/deploy/prod.env"
  set +a
}

# Waits until every container of the project reports "healthy".
# Returns 1 on timeout or if any container is unhealthy/exited.
wait_healthy() {
  local timeout="${1:-180}" waited=0 ids states="" bad
  while (( waited < timeout )); do
    ids=$(dc ps -q)
    if [[ -n "$ids" ]]; then
      # shellcheck disable=SC2086
      states=$(docker inspect -f '{{.Name}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $ids)
      bad=$(awk '$2 != "running" || $3 == "unhealthy"' <<<"$states")
      if [[ -n "$bad" ]]; then echo "$bad" >&2; return 1; fi
      if ! grep -qv ' healthy$' <<<"$states"; then return 0; fi
    fi
    sleep 3; waited=$(( waited + 3 ))
  done
  echo "timed out after ${timeout}s waiting for healthy containers:" >&2
  echo "$states" >&2
  return 1
}
