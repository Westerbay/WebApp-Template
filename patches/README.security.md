# Dependency security fixes

Reviewed against official releases on 2026-11-02. Prefer a compatible published
release over a local patch; keep the lockfile as the source of installed versions.

- `minimatch@11.0.4` replaces the backports for compatible consumers. The official
  fix for [CVE-2026-118764](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249)
  is available from 11.0.1. Overrides exclude legacy major versions.
- `eslint-plugin-import-x` still calls `makeRe()`, removed in minimatch 11. Even
  its current official 4.17.1 release retains that call. Its scoped override therefore
  keeps patched `minimatch@10.2.6`; other consumers use 11.0.4. This backport adapts
  [upstream commit 77a0f5c](https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8)
  to the published CommonJS/ESM files. Remove it when the plugin supports the fixed
  API, then rerun lint and the bounded-matching regressions.

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
