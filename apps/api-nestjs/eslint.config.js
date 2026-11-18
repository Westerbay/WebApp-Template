import { tanstackConfig } from "@tanstack/eslint-config"
import { sourceSizeConfig } from "../../packages/config/eslint/source-size.mjs"

export default [
  ...tanstackConfig,
  ...sourceSizeConfig,
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
