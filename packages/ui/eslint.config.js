//  @ts-check

import { tanstackConfig } from "@tanstack/eslint-config"
import { sourceSizeConfig } from "../config/eslint/source-size.mjs"

export default [
  ...tanstackConfig,
  ...sourceSizeConfig,
  {
    rules: {
      "import/no-cycle": "off",
      "import/order": "off",
      "sort-imports": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/require-await": "off",
      "pnpm/json-enforce-catalog": "off",
    },
  },
  {
    ignores: ["eslint.config.js", ".prettierrc"],
  },
]
