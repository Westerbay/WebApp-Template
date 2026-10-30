# Dependency security patches

These patches are applied by the package manager and pinned in the lockfile.
Run `test:dependency-security` with this project's package manager after installation.
The regression tests fail on the original packages and pass on the patched copies.

## deepmerge 4.3.1

[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4): reject `__proto__` when copying either input so an attacker cannot poison the returned object's prototype. Keep the existing arrays, symbols and custom merge API. No fixed upstream release was available on 2026-10-29. The source, CommonJS and browser bundles are patched.

## Maintenance

Version-only scanners, including Dependabot, may continue to report the original version. Do not dismiss an alert solely because a patch exists. Review its affected paths and tests, replace the patch with a compatible upstream release when available, and remove the matching regression-only direct dependency or alias when it is no longer needed. These checks do not establish what is deployed.

## Dependency and image updates

The workspace upgrades vulnerable direct and transitive packages and removes the
shadcn CLI from the runtime UI dependency tree. Only its previously imported CSS
is retained locally with its MIT attribution; the UI styles stay the same.
Nest-only security overrides are removed from generated Rust workspaces.

PostgreSQL and Grafana use the recipes documented in `infra/images/`. The Rust
release image retains glibc/OpenSSL and its non-root UID on a pinned Distroless
Debian 13 base. Test migrations and readiness with
`sh scripts/template-rust/image-check.sh` after building that image.
These changes do not modify the CI workflows or publish images to a registry.

Three Rust findings remain in the pinned better-auth-rs dependency chain:

- [RUSTSEC-2023-0071](https://rustsec.org/advisories/RUSTSEC-2023-0071.html):
  rsa 0.9.10 has no patched compatible stable release.
- [RUSTSEC-2026-0387](https://rustsec.org/advisories/RUSTSEC-2026-0387.html):
  crypto-bigint 0.5.5 requires a dependency/API migration to reach the fix.
- [RUSTSEC-2024-0449](https://rustsec.org/advisories/RUSTSEC-2024-0449.html):
  unsafe-libyaml is unmaintained through serde_yaml.

Replacing authentication or cryptography APIs needs a separate reviewed change.
No advisory is ignored or dismissed by this update.
