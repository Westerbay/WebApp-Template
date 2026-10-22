#!/bin/sh
set -eu
cd "$(dirname "$0")"
project="skull-rust-runtime-$$"
export RUST_AUTH_TEST_OWNED="$project"
compose_file=compose.yml
if [ -f compose.test.yml ]; then compose_file=compose.test.yml; fi
compose() { docker compose --env-file /dev/null -p "$project" -f "$compose_file" "$@"; }
cleanup() { compose --profile runtime down --remove-orphans; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
compose up -d --wait postgres mailpit
compose run --no-deps --rm test cargo build --locked
# The runtime shares only this owned PostgreSQL container's network namespace,
# so its verified local migration target is loopback. No host ports are published.
if compose run --no-deps --rm runtime /work/target/debug/webapp-api; then
  echo "Unmigrated API unexpectedly started" >&2
  exit 1
fi
compose run --no-deps --rm runtime /work/target/debug/webapp-api --migrate
compose run --no-deps --rm runtime /work/target/debug/webapp-api --check-migrations
compose up -d --wait runtime
compose exec -T runtime /work/target/debug/webapp-api --health-check
compose restart runtime
compose up -d --wait runtime
compose exec -T runtime /work/target/debug/webapp-api --health-check
compose run --no-deps --rm runtime /work/target/debug/webapp-api --migrate
