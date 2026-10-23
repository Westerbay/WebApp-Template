FROM rust:1.90-bookworm@sha256:3914072ca0c3b8aad871db9169a651ccfce30cf58303e5d6f2db16d1d8a7e58f AS build
ENV CARGO_BUILD_JOBS=1
WORKDIR /build
COPY Cargo.toml Cargo.lock build.rs ./
COPY src ./src
COPY migrations ./migrations
COPY assets ./assets
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/usr/local/cargo/git --mount=type=cache,target=/build/target cargo build --release --locked && cp target/release/webapp-api /webapp-api

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
COPY --from=build /webapp-api /usr/local/bin/webapp-api
USER 10001:10001
ENV API_HOST=0.0.0.0 API_PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=4s CMD ["webapp-api", "--health-check"]
ENTRYPOINT ["webapp-api"]
