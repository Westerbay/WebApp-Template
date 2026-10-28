import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { basename } from "node:path"

function githubApi(args) {
  return JSON.parse(
    execFileSync("gh", ["api", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    })
  )
}

export function publishRelease(repository, tag, files, api = githubApi) {
  const endpoint = `repos/${repository}/releases`
  const matches = api([`${endpoint}?per_page=100`, "--paginate", "--slurp"])
    .flat()
    .filter((release) => release.tag_name === tag)
  // A manually published release can coexist with an older automation draft.
  const published = matches.filter((release) => !release.draft)
  const candidates = published.length ? published : matches
  if (candidates.length > 1) {
    throw new Error(
      `Multiple releases match ${tag}; resolve the duplicates before retrying`
    )
  }

  let release = candidates[0]
  if (!release) {
    // Preserve --verify-tag: never let the release API create a missing tag.
    api([`repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`])
    release = api([
      endpoint,
      "--method",
      "POST",
      "-f",
      `tag_name=${tag}`,
      "-f",
      `name=${tag}`,
      "-F",
      "draft=true",
      "-F",
      "generate_release_notes=true",
    ])
  }

  // Keep this ID for every write; resolving the tag again can select another release.
  const releaseEndpoint = `${endpoint}/${release.id}`
  const existingAssets = api([
    `${releaseEndpoint}/assets?per_page=100`,
    "--paginate",
    "--slurp",
  ]).flat()
  const pending = files.filter((file) => {
    const name = basename(file)
    const existing = existingAssets.find((asset) => asset.name === name)
    if (!existing) return true
    const digest = `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`
    if (existing.state !== "uploaded" || existing.digest !== digest) {
      throw new Error(
        `Release asset ${name} has different or incomplete content; refusing to overwrite it`
      )
    }
    return false
  })
  for (const file of pending) {
    api([
      `https://uploads.github.com/${releaseEndpoint}/assets?name=${encodeURIComponent(basename(file))}`,
      "--method",
      "POST",
      "-H",
      "Content-Type: application/zip",
      "--input",
      file,
    ])
  }
  if (release.draft) {
    release = api([releaseEndpoint, "--method", "PATCH", "-F", "draft=false"])
  }
  return release
}

if (import.meta.main) {
  const release = publishRelease(
    process.env.GH_REPO,
    process.env.RELEASE_TAG,
    process.argv.slice(2)
  )
  console.log(`Published release ${release.id}: ${release.html_url}`)
}
