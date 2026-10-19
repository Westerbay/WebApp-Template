#!/bin/sh
set -eu
cd "$(dirname "$0")/../../.."
mkdir -p output/rust-auth-prototype
project="skull-rust-auth-contract-$$"
compose() {
  docker compose --env-file /dev/null -p "$project" -f template/backends/rust/compose.yml "$@"
}
cleanup() { compose down --remove-orphans; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
compose build test
compose run --no-deps --rm test cargo run --locked -- --openapi > output/rust-auth-prototype/openapi.json
node --input-type=module -e 'import {readFileSync} from "node:fs"; const spec = JSON.parse(readFileSync("output/rust-auth-prototype/openapi.json", "utf8")); if (!spec.paths["/api/me"]) throw new Error("Missing identity contract");'
pnpm --filter web exec openapi-typescript ../../output/rust-auth-prototype/openapi.json -o ../../output/rust-auth-prototype/schema.d.ts
pnpm dlx --allow-build esbuild orval@8.43.0 --config template/backends/rust/orval.config.mjs
node template/backends/rust/check-generated-contract.mjs
