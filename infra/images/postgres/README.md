# PostgreSQL image

Compose builds `webapp-template-postgres:17.11-security.1` locally. It is not a
published registry image and needs no registry account. The recipe keeps the
official PostgreSQL 17.11 Alpine image, entrypoint, extensions, data directory and
user IDs. Only `gosu` 1.19 is rebuilt with the patched Go toolchain: the upstream
binary still embeds a vulnerable Go standard library.

The Dockerfile pins both base image digests and the upstream source checksum.
To update, review the PostgreSQL and Go releases, update the pins, bump the local
`security.N` image tag in every Compose consumer, then build and scan the result:

```sh
docker build --pull -t webapp-template-postgres:17.11-security.1 infra/images/postgres
trivy image --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed=false --exit-code 1 webapp-template-postgres:17.11-security.1
```

Run application integration tests against a fresh owned database afterward.
Changing this image does not migrate or reset existing data.
Local users can run `docker compose build postgres` to rebuild explicitly.

Sources: [official PostgreSQL image](https://github.com/docker-library/postgres),
[gosu 1.19](https://github.com/tianon/gosu/tree/1.19). Upstream licenses remain
included in the original image and source distribution.
