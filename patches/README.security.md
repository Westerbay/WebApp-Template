# Dependency security fixes

Minimatch compatibility rechecked against official releases on 2026-11-12. Prefer a compatible published
release over a local patch; keep the lockfile as the source of installed versions.

- `minimatch@11.0.4` replaces the backports for compatible consumers. The official
  fix for [CVE-2026-118764](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249)
  is available from 11.0.1. Overrides exclude legacy major versions.
- `eslint-plugin-import-x@4.18.1` includes the [upstream compatibility fix](https://github.com/un-ts/eslint-plugin-import-x/commit/72540485d12bea99039f30a636ace9ab8ce84ead) for minimatch 11.
  Its `no-internal-modules` rule now uses `Minimatch.match()` instead of the
  removed `makeRe()` export, so the scoped minimatch 10 override and backport
  are no longer needed. Existing lint checks exercise this consumer.
  The retired dependency-only backport tests have been removed; the remaining
  maintained patches keep their regression tests.

## Remaining local patches

- `deepmerge@4.3.1`: local guard rejecting `__proto__` keys on both merge inputs,
  based on [CVE-2026-93753](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).
  The advisory lists no patched version and 4.3.1 remains the latest published release.
  This is a project-maintained mitigation, not an official upstream fix. Remove it
  after a compatible release passes the prototype-pollution and normal-merge tests.

## Validation and removal

Run the root `test:dependency-security` script after a full frozen installation.
It exercises the installed modules with synthetic inputs, checking both the
security boundary and normal behavior. Run the affected lint, typecheck and build
commands as well: a passing security regression alone does not prove compatibility.

Keep the remaining patch files in installation and Docker build contexts. Local
patches retain the original package version, so version-based advisories remain
visible; a proposed PR does not establish integration or deployment. Remove obsolete
patch files and manifest entries together with a package-manager-generated lockfile.
