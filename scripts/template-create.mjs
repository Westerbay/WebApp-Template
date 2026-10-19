import { parseArgs } from "node:util"
import { generateTemplate } from "./template-generator.mjs"

const arguments_ = process.argv.slice(2)
if (arguments_[0] === "--") arguments_.shift()

const { values } = parseArgs({
  args: arguments_,
  options: {
    output: { type: "string" },
    profile: { type: "string", default: "en" },
    backend: { type: "string", default: "nestjs" },
  },
})
const output = await generateTemplate({
  output: values.output,
  profile: values.profile,
  backend: values.backend,
})
console.log(`Template generated at ${output}`)
