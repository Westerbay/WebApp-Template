import { generate } from "orval"

export async function generateZod(specPath, targetPath) {
  await generate(
    {
      input: { target: specPath },
      output: {
        client: "zod",
        mode: "single",
        target: targetPath,
        override: {
          zod: {
            version: 4,
            generate: {
              param: false,
              query: false,
              header: false,
              body: false,
              response: true,
            },
          },
        },
      },
    },
    process.cwd(),
    { throwOnError: true }
  )
}
