import { execFileSync } from "node:child_process"
import { lstat, readdir, readFile } from "node:fs/promises"
import { matchesGlob, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  generatedSourcePatterns,
  sourceScanIgnoredDirectories,
  sourceSizeExceptions,
  sourceSizeLimits,
} from "../../packages/config/source-size.mjs"
import { countSourceLines } from "./source-lines.mjs"

export function isMaintainedSource(path) {
  return (
    /\.(?:[cm]?[jt]s|[jt]sx|rs|css)$/.test(path) &&
    !generatedSourcePatterns.some((pattern) => matchesGlob(path, pattern))
  )
}

export function assessSourceSize(path, lines, exception) {
  if (
    exception &&
    (!exception.reason?.trim() ||
      !Number.isInteger(exception.maxLines) ||
      exception.maxLines <= sourceSizeLimits.fileMaximum)
  ) {
    throw new Error(
      `${path}: exception needs a reason and a bounded higher limit`
    )
  }
  if (exception && lines <= sourceSizeLimits.fileMaximum) {
    throw new Error(`${path}: remove the unnecessary size exception`)
  }
  const maximum = exception?.maxLines ?? sourceSizeLimits.fileMaximum
  const level =
    lines > maximum
      ? "error"
      : lines > sourceSizeLimits.fileWarning
        ? "warning"
        : null
  return { path, lines, maximum, level, reason: exception?.reason }
}

async function listSourceFiles(root) {
  let hasGit = true
  try {
    await lstat(resolve(root, ".git"))
  } catch (error) {
    if (error.code !== "ENOENT") throw error
    hasGit = false
  }
  if (hasGit)
    return [
      ...new Set(
        execFileSync(
          "git",
          ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
          {
            cwd: root,
            encoding: "utf8",
          }
        )
          .split("\0")
          .filter(isMaintainedSource)
      ),
    ].sort()
  // Distribution archives contain source files but no Git metadata.
  const paths = []
  async function visit(directory) {
    for (const entry of await readdir(resolve(root, directory), {
      withFileTypes: true,
    })) {
      if (entry.name.startsWith(".env")) continue
      const path = directory ? directory + "/" + entry.name : entry.name
      if (
        entry.isDirectory() &&
        !sourceScanIgnoredDirectories.includes(entry.name)
      ) {
        await visit(path)
      } else if (entry.isFile() && isMaintainedSource(path)) paths.push(path)
    }
  }
  await visit("")
  return paths.sort()
}

export async function checkSourceSizes(root) {
  const paths = await listSourceFiles(root)
  const results = []
  for (const path of paths) {
    let source
    try {
      source = await readFile(resolve(root, path), "utf8")
    } catch (error) {
      if (error.code === "ENOENT") continue // A tracked deletion in a local refactor.
      throw error
    }
    results.push(
      assessSourceSize(
        path,
        countSourceLines(source, path),
        sourceSizeExceptions[path]
      )
    )
  }
  for (const path of Object.keys(sourceSizeExceptions)) {
    if (!results.some((result) => result.path === path)) {
      throw new Error(
        `${path}: size exception does not target a maintained source`
      )
    }
  }
  return results
}

async function main() {
  const root = resolve(import.meta.dirname, "../..")
  const results = await checkSourceSizes(root)
  for (const { path, lines, level, maximum, reason } of results) {
    if (!level) continue
    const detail = reason ? `; exception: ${reason}` : ""
    console[level === "error" ? "error" : "warn"](
      `${level}: ${path}: ${lines} source lines (warning > ${sourceSizeLimits.fileWarning}, maximum ${maximum}${detail})`
    )
  }
  const failures = results.filter(({ level }) => level === "error").length
  console.log(
    `Source size: ${results.length} files checked, ${failures} errors`
  )
  if (failures) process.exitCode = 1
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main()
}
