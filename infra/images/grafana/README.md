# Grafana image

The optional observability stack builds
`webapp-template-grafana:13.2.4-security.2` locally for Linux amd64 or arm64. It is
not a registry publication or an unmodified official Grafana image.

The official 13.2.4 server and bundled datasource executables contain vulnerable
Go dependencies. Updating the tag alone does not fix them. This recipe:

- rebuilds the Grafana 13.2.4 server with Go 1.27.3, `kin-openapi` 0.149.0
  and `go-jose/v4` 4.1.6 (CVE-2026-116587);
- rebuilds Loki datasource 13.2.2 from its exact upstream commit with Go 1.27.3
  and `golang.org/x/net` 0.60.0;
- retains the official signed Prometheus datasource 13.2.4 unchanged;
- reuses upstream frontend assets, configuration, license and entrypoint on a
  maintained Alpine base, running as UID 472.

Only Loki and Prometheus datasource backends are bundled, matching the template's
dashboards. Other integrations must be added deliberately and scanned. The rebuilt
Loki component is installed in Grafana's image-owned core plugin directory; its
frontend and executable are read-only. Its old external signature manifest is
removed because it no longer describes the rebuilt executable. Grafana classifies
it as an internal component. External plugins still require valid signatures:
there is no unsigned-plugin allowlist or verification patch. Prometheus keeps its
upstream signature, checked by the observability test along with Loki loading,
frontend assets, datasource health and dashboard queries.

`plugins.json` pins both official plugin archives by architecture and SHA-256.
The Dockerfile pins source archives and base digests. To update, review the server,
source archives, module fixes and both plugin versions/checksums together; then
bump `security.N` in Compose and rebuild. Updating only the frontend image would
mix incompatible server and frontend versions. Keep these coupled
upstream pins under manual review.

```sh
docker build --pull -t webapp-template-grafana:13.2.4-security.2 infra/images/grafana
trivy image --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed=false --exit-code 1 webapp-template-grafana:13.2.4-security.2
pnpm logs:test
pnpm logs:test:docker
```

Scan the final image, including OS packages and every Go executable, without
ignoring unfixed CVEs. Local users can run
`docker compose -f infra/compose/observability.yml build grafana` to rebuild.

The build changes are fully expressed in the Dockerfile and fetch script. Sources:
[Grafana 13.2.4](https://github.com/grafana/grafana/tree/v13.2.4),
[Loki datasource commit](https://github.com/grafana/grafana-loki-datasource/tree/6d076df3d695f5fda342fbbad1f52547b55a96e2),
[Prometheus datasource](https://github.com/grafana/grafana-prometheus-datasource).
Grafana and Loki retain their upstream AGPL licensing; this repository's MIT
license does not relicense those components. Preserve their source links and
licenses when distributing this modified image, and provide its corresponding
source/build changes under the upstream license.
