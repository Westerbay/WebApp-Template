import { fileURLToPath } from "node:url"

const output = new URL("../../output/rust-auth-prototype/", import.meta.url)

export default {
  rustIdentity: {
    input: fileURLToPath(new URL("openapi.json", output)),
    output: {
      client: "zod",
      target: fileURLToPath(new URL("identity.zod.ts", output)),
      override: { zod: { version: 4 } },
    },
  },
}
