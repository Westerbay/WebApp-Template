# Continuous integration

[CI](../.github/workflows/ci.yml) is the only entry point for PR, main, manual and
scheduled checks. Other validation workflows are reusable and do not subscribe
to the same repository events.

| Event                            | Work performed                                                           |
| -------------------------------- | ------------------------------------------------------------------------ |
| Pull request                     | Full application/template validation and security                        |
| Direct push to main              | Full validation and security                                             |
| Merge of an already validated PR | Reuse the successful run only when its recorded Git tree matches exactly |
| Weekly schedule                  | Security refresh only                                                    |
| Manual dispatch                  | Full validation and security                                             |

A successful full PR run stores a small `ci-validated-tree` artifact for 30 days.
The main planner verifies its repository, PR, head and tree before skipping work.
Missing, expired or untrusted proof, an API failure, or a changed tree causes full
validation. Fork merges are checked again on main. A cheap planning job still
runs on main to make this decision; application builds and scans are not repeated
for a proven merge. New commits on a PR cancel its obsolete run. A scheduled
security refresh does not cancel an application validation.

[Security](../.github/workflows/security.yml) scans the complete Git history with
Gitleaks, audits JavaScript dependencies with pnpm, checks a present Cargo lockfile
with Trivy and scans a matrix of unique infrastructure images. HIGH and CRITICAL
findings fail even without an available fix. Registry/advisory service failures
also fail. Exact reviewed false positives are separate from real vulnerabilities;
known vulnerable upstream images keep the security gate red until remediated.
These checks never load real environment files or start a database.

The application validation is shared through
[Application checks](../.github/workflows/ci-application.yml) and local composite
actions. It checks quality, unit tests, contracts, integration and browser journeys.
Rust also exercises migrations and runtime restart, builds its production image
and scans that built image. Browser tests exercise the configured application
locales. Individual steps expose the failing stage and diagnostics are retained.

`Security checks` aggregates all security jobs. `CI checks` is the stable overall
status to require in branch protection. Both reject failed, cancelled or unexpectedly
skipped prerequisites. Requiring these statuses in repository branch rules is an
administrator operation; workflow files alone do not enforce merge protection.
