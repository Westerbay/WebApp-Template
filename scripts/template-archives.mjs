import { parseArgs } from "node:util"
import { readdir, readFile, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { zipSync } from "fflate"
import { generateTemplate } from "./template-generator.mjs"
import { templateProfiles } from "./template-profiles.mjs"

export async function createTemplateArchive({
  output,
  profile,
  backend = "nestjs",
}) {
  const directory = resolve(output)
  const id = backend === "nestjs" ? profile : `${profile}-${backend}`
  const project = await generateTemplate({
    output: resolve(directory, id),
    profile,
    backend,
  })
  const entries = await readArchiveFiles(project)
  const archive = resolve(directory, `webapp-template-${id}.zip`)
  await writeFile(archive, zipSync(entries), { flag: "wx" })
  return archive
}

async function readArchiveFiles(directory, prefix = "") {
  const files = {}
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    const name = prefix + entry.name
    if (entry.isDirectory()) {
      Object.assign(files, await readArchiveFiles(path, name + "/"))
    } else if (entry.isFile()) {
      const metadata = await stat(path)
      files[name] = [
        await readFile(path),
        {
          os: 3,
          attrs: (metadata.mode & 0o777) << 16,
          mtime: metadata.mtime,
        },
      ]
    } else {
      throw new Error(`Unsupported archive entry: ${name}`)
    }
  }
  return files
}

if (import.meta.main) {
  const arguments_ = process.argv.slice(2)
  if (arguments_[0] === "--") arguments_.shift()
  const { values } = parseArgs({
    args: arguments_,
    options: {
      output: { type: "string", default: "output/templates" },
      profile: { type: "string" },
      backend: { type: "string", default: "nestjs" },
    },
  })
  const profiles = values.profile
    ? [values.profile]
    : templateProfiles.map(({ id }) => id)
  for (const profile of profiles) {
    const archive = await createTemplateArchive({
      output: values.output,
      profile,
      backend: values.backend,
    })
    console.log(`Template archive ready: ${archive}`)
  }
}
