#!/bin/sh
set -eu
cd "$(dirname "$0")/../../apps/api-rust"
project="skull-rust-runtime-image-$$"
export RUST_AUTH_TEST_OWNED="$project"
override="$(mktemp)"
cat > "$override" <<'YAML'
services:
  runtime:
    image: webapp-api:local
    command: !reset null
    volumes: !reset []
    healthcheck:
      test: [CMD, webapp-api, --health-check]
YAML
compose() { docker compose --env-file /dev/null -p "$project" -f compose.test.yml -f "$override" "$@"; }
cleanup() {
  compose --profile runtime down --remove-orphans
  rm -f "$override"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
compose up -d --wait postgres mailpit
if compose run --no-deps --rm runtime; then
  echo "Unmigrated production image unexpectedly started" >&2
  exit 1
fi
compose run --no-deps --rm runtime --migrate
compose run --no-deps --rm runtime --check-migrations
compose up -d --wait runtime
compose exec -T runtime webapp-api --health-check
compose restart runtime
compose up -d --wait runtime
compose exec -T runtime webapp-api --health-check
compose run --no-deps --rm runtime --migrate
