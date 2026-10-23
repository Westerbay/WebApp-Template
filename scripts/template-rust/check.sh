#!/bin/sh
set -eu
cd "$(dirname "$0")/../../apps/api-rust"
node ../../scripts/template-rust/check-assets.mjs
# Unique project, private network, disposable PostgreSQL, no published ports.
project="skull-rust-auth-prototype-$$"
cleanup() {
  docker compose --env-file /dev/null -p "$project" -f compose.test.yml down --remove-orphans
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker compose --env-file /dev/null -p "$project" -f compose.test.yml up --abort-on-container-exit --exit-code-from test
