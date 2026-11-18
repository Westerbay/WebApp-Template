export const sourceSizeLimits = {
  fileWarning: 300,
  fileMaximum: 500,
  functionWarning: 50,
}

// Paths are repository-relative. Exceptions require a bounded limit and a reason.
export const sourceSizeExceptions = {}

export const generatedSourcePatterns = [
  "**/src/routeTree.gen.ts",
  "**/src/lib/api/schema.d.ts",
  "**/src/lib/api/responses.zod.ts",
  "**/src/generated/**",
  "**/project.inlang/cache/**",
  "template/backends/rust/schema.d.ts",
  "template/backends/rust/responses.zod.ts",
]

// Used only in extracted projects without Git metadata. Never scan dependency/build output.
export const sourceScanIgnoredDirectories = [
  "node_modules",
  ".git",
  ".pnpm-store",
  "dist",
  "dist-ssr",
  "target",
  "coverage",
  "output",
  ".turbo",
  ".tanstack",
  ".vinxi",
  ".output",
  ".wrangler",
  "playwright-report",
  "test-results",
  ".worktree",
  ".planning",
  ".agents",
  ".codex",
  ".vite",
  ".cache",
]
