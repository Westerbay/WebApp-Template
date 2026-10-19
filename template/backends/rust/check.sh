#!/bin/sh
set -eu
cd "$(dirname "$0")"
node check-assets.mjs
# Unique project, private network, disposable PostgreSQL, no published ports.
project="skull-rust-auth-prototype-$$"
cleanup() {
  docker compose --env-file /dev/null -p "$project" -f compose.yml down --remove-orphans
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker compose --env-file /dev/null -p "$project" -f compose.yml up --abort-on-container-exit --exit-code-from test
