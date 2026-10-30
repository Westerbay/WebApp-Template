# Rebuild the server and the Loki component used by this template. Prometheus
# remains an unmodified, signed upstream plugin. Other datasource backends are
# not bundled; external plugin signature verification keeps its upstream default.
FROM golang:1.27.3-alpine3.24@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c AS build
RUN apk add --no-cache make git bash
WORKDIR /src
ADD --checksum=sha256:fdd57503b5f591e951ea3dff80ab53a41487c3373dc89370da2e36e7bf752f52 https://codeload.github.com/grafana/grafana/tar.gz/refs/tags/v13.2.4 /tmp/source.tgz
RUN tar -xzf /tmp/source.tgz --strip-components=1 && rm /tmp/source.tgz
ENV CGO_ENABLED=0 GOMAXPROCS=2 GOFLAGS=-p=2 COMMIT_SHA=af4a33e BUILD_BRANCH=13.2.x
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build go get github.com/getkin/kin-openapi@v0.149.0 github.com/go-jose/go-jose/v4@v4.1.6 && go work sync
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build make gen-go && make build-go

FROM golang:1.27.3-alpine3.24@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c AS loki
WORKDIR /src
ADD --checksum=sha256:d195ba01a3ff22541f197fd0f8cecf3fdfc2e2fba8034d45439cfb497c5a8933 https://codeload.github.com/grafana/grafana-loki-datasource/tar.gz/6d076df3d695f5fda342fbbad1f52547b55a96e2 /tmp/source.tgz
RUN tar -xzf /tmp/source.tgz --strip-components=1
ENV CGO_ENABLED=0 GOMAXPROCS=2 GOFLAGS=-p=2
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build go get golang.org/x/net@v0.60.0 && go build -buildvcs=false -trimpath -o /loki ./pkg

FROM alpine:3.24.3@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a AS assets
RUN apk add --no-cache curl jq unzip
ARG TARGETARCH
COPY plugins.json fetch-plugins.sh /build/
RUN sh /build/fetch-plugins.sh "$TARGETARCH"

FROM grafana/grafana:13.2.4@sha256:dbbc38ea21103cefb50396340cd88afec779c7e070b0a7bf5a75b4ce46651d3f AS upstream
FROM alpine:3.24.3@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a
ARG TARGETARCH
RUN apk add --no-cache bash ca-certificates tzdata && adduser -S -D -H -u 472 -G root grafana
ENV GF_PATHS_CONFIG=/etc/grafana/grafana.ini \
    GF_PATHS_DATA=/var/lib/grafana \
    GF_PATHS_HOME=/usr/share/grafana \
    GF_PATHS_LOGS=/var/log/grafana \
    GF_PATHS_PLUGINS=/var/lib/grafana/plugins \
    GF_PATHS_PROVISIONING=/etc/grafana/provisioning \
    PATH=/usr/share/grafana/bin:$PATH
WORKDIR /usr/share/grafana
COPY --from=upstream /usr/share/grafana/public ./public
COPY --from=upstream /usr/share/grafana/conf ./conf
COPY --from=upstream /usr/share/grafana/LICENSE ./LICENSE
COPY --from=upstream /etc/grafana /etc/grafana
COPY --from=upstream /run.sh /run.sh
COPY --from=build /src/bin/grafana ./bin/grafana
COPY --from=assets /plugins/loki ./public/app/plugins/datasource/loki
COPY --from=loki /loki ./public/app/plugins/datasource/loki/gpx_grafana-loki-datasource_linux_${TARGETARCH}
COPY --from=assets /plugins/prometheus ./data/plugins-bundled/prometheus
RUN mkdir -p /var/lib/grafana/plugins /var/log/grafana /etc/grafana/provisioning && \
    chown -R 472:0 /var/lib/grafana /var/log/grafana /etc/grafana/provisioning && \
    chmod -R a-w public/app/plugins/datasource/loki data/plugins-bundled/prometheus
USER 472:0
EXPOSE 3000
ENTRYPOINT ["/run.sh"]
