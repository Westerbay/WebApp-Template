# Template maintenance

The generator offers NestJS (default) or [Rust with Axum and Better Auth RS](backends/rust/README.md).
Backend choice is independent of the three language profiles. Rust uses a pinned
alpha auth dependency; validate it for your deployment before adoption.

This guide belongs to the WebApp Template source repository only. Generated projects
keep application code, tests, CI and documentation. They exclude this directory,
generation scripts and their tests, the distribution workflow, template commands
and archive-only dependencies.

Install the source repository dependencies with `pnpm install --frozen-lockfile`
before running the commands below.

## Language profiles and archives

The maintainer repository offers three profiles:

| Profile        | Interface and email | Public routes                  | Documentation |
| -------------- | ------------------- | ------------------------------ | ------------- |
| `en`           | English             | `/sign-in`                     | English       |
| `fr`           | French              | `/connexion`                   | French        |
| `multilingual` | English + French    | `/en/sign-in`, `/fr/connexion` | English       |

```bash
pnpm template:create -- --profile en --output output/english-app
pnpm template:create -- --profile fr --output output/french-app
pnpm template:create -- --profile multilingual --output output/bilingual-app
pnpm template:create -- --backend rust --profile multilingual --output output/rust-app
pnpm template:check
pnpm template:archives
```

The default backend is `nestjs`; pass `--backend rust` to generate a Rust-only API,
versioned PostgreSQL migrations, Docker runtime, CI and matching documentation.
Rust archives append `-rust` (for example `webapp-template-fr-rust.zip`).
`pnpm template:archives -- --backend rust` creates all three Rust archives.
The default archive command retains the three NestJS names.

The default profile is `en`. The multilingual profile defaults to English;
the URL selects the active language. `scripts/template-profiles.mjs` defines
the three profiles for generation, archives and CI. There are no independent
documentation options or arbitrary locale combinations.

Generation checks message and route coverage before creating output, creates
missing parent directories and refuses existing output directories. It never
reads real environment files or connects to a database. Generated projects omit
source packs, template tooling, Git history, dependencies and caches. Install
dependencies normally before building. ZIPs are written to `output/templates`
and contain the project files directly, including required dotfiles; a Git clone
includes all source packs. `pnpm template:archives -- --profile fr --output output/dist`
generates only the French ZIP. The command uses Node.js and pnpm and requires no external
archive utility. Existing project directories and ZIP files are never overwritten.

Internal routes stay English. Update `packages/i18n/messages/en.json` for source
messages and `template/locales/fr/messages.json` / `routes.json` for French
messages and public paths. Keep message keys and internal route coverage aligned.
French application documentation lives under `template/locales/fr`.

Each language owns `template/locales/<locale>/pack.json`. Its `messages`, optional
`routes` and `documentation` paths resolve relative to that pack directory.
Without a routes file, public paths keep their internal spelling. The English
pack references the existing source catalog and documentation, without copies.
The generator compares every selected catalog with the source `baseLocale`
catalog and every route map with the internal paths before creating output.
To introduce another language, add its pack and complete translations, then
select it in `scripts/template-profiles.mjs`; no language-specific generator
branch is needed. Published profiles and their documentation languages remain
explicit in that file. Adding published profiles also requires updating the
release workflow's expected archive count. Application libraries with language-specific resources
(such as password-strength dictionaries) need their own compatibility review.

## Ownership and generated files

`scripts/template-profiles.mjs` owns the three supported profiles.
`template-generator.mjs` validates catalogs, routes and documentation before
creating output. `template-files.mjs` selects and copies source files.
`template-archives.mjs` packages a freshly generated project before installation.

The generator removes `template:*` commands and `fflate` from the generated
manifest. It refreshes the copied lockfile with pnpm in lockfile-only mode,
with lifecycle scripts disabled. No dependencies are installed and unused
lockfile entries are pruned. Cached registry metadata is preferred; missing
metadata is fetched so generation also works on fresh CI runners. Registry
access is required when the cache is incomplete; supply-chain checks remain
enabled. Generation fails if the lockfile cannot be refreshed.

Application documentation is shared with the output (French documents replace
English ones for the French profile). The generator discovers every Markdown
document directly under `docs/`; each must exist in the selected pack's
documentation directory. A missing translation fails preparation before
creating output, instead of silently keeping the English document. Keep
commands, code examples, configuration keys and alert identifiers unchanged
when translating. Generated-profile tests verify the complete document inventory
and its selected language, and run the link checker on the result.
Documentation tests also compare each translated pack’s executable examples and
link destinations with the source. They do not assess prose meaning; review translations alongside
their source and preserve the same scope instead of appending a second history.
A `<!-- template-maintainers:start -->` /
`<!-- template-maintainers:end -->` block marks the source README's maintenance
link; the generator omits this block. Keep distribution procedures in this guide,
not in application documentation.

## Distribution validation

The `Template validation` workflow runs on PRs and manual requests. Both it and
the tag-only `Template release` workflow call `template-validation.yml`, which
checks the generator and all three NestJS profiles. It creates source ZIPs, extracts
them, then runs `pnpm check`, integration and E2E in each active language against
the extracted projects. The ZIPs themselves are uploaded, without an outer archive.
All template workflows are excluded from generated projects; application CI is
copied unchanged.

New commits cancel obsolete PR validations. Release runs are serialized per tag
and never cancel an active publication. Dependency caches cover both the source
and extracted-project lockfiles. Failed profile runs retain available E2E
screenshots and JUnit results for seven days, with diagnostics separated by
profile and language.

## Publishing template releases

PRs and `Run workflow` perform validation and provide downloadable artifacts.
Only pushing a `v*` tag starts `Template release`, which publishes after all three
profiles succeed. Publication is absent from PR runs rather than shown as skipped.
Choose a new version on the intended commit, normally the merged `main`:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The example version must be unused. The release contains `webapp-template-en.zip`,
`webapp-template-fr.zip` and `webapp-template-multilingual.zip`. Download those assets;
GitHub's automatic `Source code` archives contain the maintainer repository.

Only the tag publication job has repository write access. It verifies the remote
tag exists, downloads the tested ZIPs without decompressing them, checks archive integrity, creates a draft,
uploads all assets, then publishes it with generated release notes. A failed
upload leaves a draft rather than publishing an incomplete release. Existing
releases are not overwritten; inspect an existing draft before retrying a failed
publication. No npm package is published.

If publication fails before creating a draft, inspect the failed job's logs.
Missing or empty ZIPs produce an explicit error. A workflow correction must be
included in the tagged commit: rerunning an old tag uses its original workflow.
Publish a new unused version after merging the correction; do not move an
existing release tag.
