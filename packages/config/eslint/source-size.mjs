import { generatedSourcePatterns, sourceSizeLimits } from "../source-size.mjs"

export const sourceSizeConfig = [
  { ignores: generatedSourcePatterns },
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    rules: {
      "max-lines": [
        "warn",
        {
          max: sourceSizeLimits.fileWarning,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      "max-lines-per-function": [
        "warn",
        {
          max: sourceSizeLimits.functionWarning,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },
]
