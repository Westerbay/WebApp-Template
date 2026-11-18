import { tanstackConfig } from "@tanstack/eslint-config"
import { sourceSizeConfig } from "../config/eslint/source-size.mjs"

export default [
  ...tanstackConfig,
  ...sourceSizeConfig,
  {
    ignores: ["eslint.config.js"],
  },
]
