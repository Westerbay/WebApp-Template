# Dependency security patches

These patches are applied by the package manager and pinned in the lockfile.
Run `test:dependency-security` with this project's package manager after installation.
The regression tests fail on the original packages and pass on the patched copies.

## deepmerge 4.3.1

[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4): reject `__proto__` when copying either input so an attacker cannot poison the returned object's prototype. Keep the existing arrays, symbols and custom merge API. No fixed upstream release was available on 2026-10-29. The source, CommonJS and browser bundles are patched.

## Maintenance

Version-only scanners, including Dependabot, may continue to report the original version. Do not dismiss an alert solely because a patch exists. Review its affected paths and tests, replace the patch with a compatible upstream release when available, and remove the matching regression-only direct dependency or alias when it is no longer needed. These checks do not establish what is deployed.
