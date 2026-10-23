import { tanstackConfig } from "@tanstack/eslint-config"

export default [
  ...tanstackConfig,
  {
    ignores: ["eslint.config.js"],
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
]
