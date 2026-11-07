#!/usr/bin/env bash
# Build, start, verify. If the new version is unhealthy or fails the smoke
# test, the previous images are put back and verified again.
#   scripts/deploy.sh             git pull, then deploy
#   scripts/deploy.sh --no-pull   deploy the working tree as it is
# Database migrations are applied by the API on start and are NOT undone by a
# rollback; they are additive by convention. One that is not is undone only by
# scripts/restore.sh with the backup taken before the deploy.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
cd "$ROOT"
load_env
SMOKE="${SMOKE:-$ROOT/scripts/smoke.sh}"

[[ "${1:-}" == "--no-pull" ]] || git pull --ff-only

# next build needs ~1.5 GB; warn early instead of dying half-way on a small box
if command -v free >/dev/null; then
  headroom=$(free -m | awk '/^Mem:/{m=$7} /^Swap:/{s=$4} END{print m+s}')
  if (( headroom < 1500 )); then
    echo "WARNING: only ${headroom} MB of memory+swap free; the build may be killed." >&2
  fi
fi

had_previous=0
for svc in api web; do
  if docker image inspect "wolfcar-$svc:latest" >/dev/null 2>&1; then
    docker tag "wolfcar-$svc:latest" "wolfcar-$svc:previous"
    had_previous=1
  fi
done

dc build

# `up` waits for the new API to be healthy before it starts the website: bounded, and
# inside the `if`, so an API that never gets there (a bad setting, a crash loop) rolls back
if timeout 300 "${DC[@]}" up -d && wait_healthy 240 && "$SMOKE" "$PUBLIC_URL"; then
  docker image prune -f >/dev/null
  echo "deployed $(git rev-parse --short HEAD)"
  exit 0
fi

echo "---- new version failed; recent logs ----" >&2
dc logs --tail 100 api web >&2 || true

if (( had_previous == 0 )); then
  echo "no previous version to roll back to" >&2
  exit 1
fi

echo "---- rolling back to the previous images ----" >&2
for svc in api web; do docker tag "wolfcar-$svc:previous" "wolfcar-$svc:latest"; done
if timeout 300 "${DC[@]}" up -d --no-build && wait_healthy 240 && "$ROOT/scripts/smoke.sh" "$PUBLIC_URL"; then
  echo "rolled back; the site is on the previous version" >&2
else
  echo "ROLLBACK ALSO FAILED — check 'docker compose -f compose.prod.yml ps' now" >&2
fi
exit 1
