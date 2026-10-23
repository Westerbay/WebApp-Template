import { resolve } from "node:path"

export default {
  forbidden: [
    {
      name: "unresolved-source-import",
      severity: "error",
      comment:
        "Unresolved imports must not silently bypass boundaries. Vite resolves CSS URL assets.",
      from: { path: "^(apps/[^/]+|packages/[^/]+)/src/" },
      to: { couldNotResolve: true, pathNot: "\\.css\\?url$" },
    },
    {
      name: "web-no-server",
      severity: "error",
      comment:
        "The web consumes public contracts, never server implementations.",
      from: { path: "^apps/web/src/" },
      to: {
        path: "^(apps/api(?:-nestjs|-rust)?/|packages/(?:database|email|core)/|@workspace/(?:database|email|core)(?:/|$))",
      },
    },
    {
      name: "web-lib-no-composition",
      severity: "error",
      comment:
        "Shared web mechanisms cannot depend on features or page composition.",
      from: { path: "^apps/web/src/lib/" },
      to: {
        path: "^apps/web/src/(?:features/|components/|routes/|router\\.tsx$|server\\.ts$)",
      },
    },
    {
      name: "web-features-no-composition",
      severity: "error",
      comment:
        "Features are composed by routes and the application shell, never the reverse.",
      from: { path: "^apps/web/src/features/" },
      to: {
        path: "^apps/web/src/(?:components/|routes/|router\\.tsx$|server\\.ts$)",
      },
    },
    {
      name: "web-features-independent",
      severity: "error",
      comment:
        "Compose different features in routes or the application shell; share generic mechanisms through lib.",
      from: { path: "^apps/web/src/features/([^/]+)/" },
      to: {
        path: "^apps/web/src/features/",
        pathNot: "^apps/web/src/features/$1/",
      },
    },
    {
      name: "api-no-web",
      severity: "error",
      from: { path: "^apps/api(?:-nestjs|-rust)?/src/" },
      to: { path: "^(apps/web/|packages/ui/|@workspace/ui(?:/|$))" },
    },
    {
      name: "api-modules-independent",
      severity: "error",
      comment:
        "Compose API modules in the application; share generic mechanisms through infrastructure or packages.",
      from: { path: "^apps/api(?:-nestjs|-rust)?/src/modules/([^/]+)/" },
      to: {
        path: "^apps/api(?:-nestjs|-rust)?/src/modules/",
        pathNot: "^apps/api(?:-nestjs|-rust)?/src/modules/$1/",
      },
    },
    {
      name: "api-support-no-modules",
      severity: "error",
      comment:
        "Infrastructure and configuration cannot depend on application modules.",
      from: {
        path: "^apps/api(?:-nestjs|-rust)?/src/(?:infrastructure|config)/",
      },
      to: { path: "^apps/api(?:-nestjs|-rust)?/src/modules/" },
    },
    {
      name: "api-no-composition-dependencies",
      severity: "error",
      comment:
        "Modules, infrastructure and configuration cannot import runtime or OpenAPI composition.",
      from: {
        path: "^apps/api(?:-nestjs|-rust)?/src/(?:modules|infrastructure|config)/",
      },
      to: {
        path: "^apps/api(?:-nestjs|-rust)?/src/(?:app\\.ts$|bootstrap\\.ts$|index\\.ts$|openapi/)",
      },
    },
    {
      name: "packages-no-apps",
      severity: "error",
      comment: "Shared packages cannot depend on application composition.",
      from: { path: "^packages/[^/]+/src/" },
      to: { path: "^apps/" },
    },
    {
      name: "core-independent",
      severity: "error",
      comment: "Core ports have no runtime, framework or adapter dependencies.",
      from: { path: "^packages/core/src/" },
      to: { pathNot: "^packages/core/src/" },
    },
    {
      name: "contracts-independent",
      severity: "error",
      comment: "Public schemas depend only on other contracts and Zod.",
      from: { path: "^packages/contracts/src/" },
      to: { pathNot: "^packages/contracts/src/|(^|/)node_modules/zod/" },
    },
    {
      name: "ui-no-business-dependencies",
      severity: "error",
      comment:
        "UI primitives do not depend on application features or business packages.",
      from: { path: "^packages/ui/src/" },
      to: { path: "^(apps/|packages/(?!ui/)|@workspace/(?!ui(?:/|$)))" },
    },
  ],
  options: {
    doNotFollow: {
      path: "(^|/)(?:node_modules|dist|test|generated|\\.output|\\.tanstack)(?:/|$)",
    },
    tsPreCompilationDeps: true,
    // The resolver needs an explicit baseUrl for aliases in a nested tsconfig.
    tsConfig: { fileName: resolve("scripts/tsconfig.boundaries.json") },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["types", "import", "node", "default"],
    },
  },
}
