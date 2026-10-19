# Rust API toolchain

This first slice adds the Rust 1.90 / edition 2024 crate manifest, reproducible
Cargo lock and development image for the optional backend. The next pull request
adds the modular API, authentication, migrations and behavioral tests.

The existing NestJS application and generator remain unchanged. There is no Rust
server to start in this setup slice. With Rust 1.90 installed, verify dependencies:

```sh
cargo check --locked --manifest-path template/backends/rust/Cargo.toml
```

Better Auth RS is pinned to revision
`9f91cd7fdb8a5f73a9c69d5c56d363468a7dc281`, an alpha release. Keep `Cargo.lock`
and use `--locked`. The development Docker image provides the same Rust toolchain.
