import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, open, readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { createServer } from "node:net"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { sdkJourney, browserJourney } from "./frontend-journeys.mjs"

const root = fileURLToPath(new URL("../../", import.meta.url))
const output = join(
  root,
  "output",
  `rust-auth-frontend-${randomUUID().slice(0, 8)}`
)
await mkdir(output, { recursive: true })
const requireWeb = createRequire(
  new URL("../../apps/web/package.json", import.meta.url)
)
const requireApi = createRequire(
  new URL("../../apps/web/package.json", import.meta.url)
)
const { createAuthClient } = await import(
  pathToFileURL(requireWeb.resolve("better-auth/client"))
)
const { chromium, expect } = requireApi("@playwright/test")
const project = `skull-rust-auth-frontend-${randomUUID().slice(0, 8)}`
const composeArgs = [
  "compose",
  "--env-file",
  "/dev/null",
  "-p",
  project,
  "-f",
  "apps/api/compose.test.yml",
  "-f",
  "apps/api/compose.frontend.yml",
]
let composeEnv = {
  ...process.env,
  RUST_AUTH_TEST_API_PORT: "4100",
  RUST_AUTH_TEST_WEB_PORT: "3000",
}

async function run(
  command,
  args,
  {
    cwd = root,
    env = process.env,
    log = join(output, "tooling.log"),
    capture = false,
  } = {}
) {
  const file = await open(log, "a")
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env,
        stdio: ["ignore", capture ? "pipe" : file.fd, file.fd],
      })
      let text = ""
      if (capture)
        child.stdout.on("data", (chunk) => {
          text += chunk
        })
      child.once("error", reject)
      child.once("close", (code) =>
        code === 0
          ? resolve(text.trim())
          : reject(new Error(`${command} exited ${code}; see ${log}`))
      )
    })
  } finally {
    await file.close()
  }
}
const compose = (args, options = {}) =>
  run("docker", [...composeArgs, ...args], { env: composeEnv, ...options })
async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  assert(address && typeof address !== "string")
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return address.port
}
async function ready(url, processHandle) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (processHandle && processHandle.exitCode !== null)
      throw new Error(
        `Frontend exited before startup: ${processHandle.exitCode}`
      )
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1500) })).ok) return
    } catch {
      /* Owned service is still starting. */
    }
    await delay(200)
  }
  throw new Error(`Owned service did not start: ${new URL(url).origin}`)
}
async function stop(child) {
  if (child.exitCode !== null) return
  const exited = new Promise((resolve) => child.once("close", resolve))
  child.kill("SIGTERM")
  await Promise.race([exited, delay(10_000)])
  if (child.exitCode === null) {
    child.kill("SIGKILL")
    await exited
  }
}
const results = []
let browser
try {
  console.log(`Rust auth frontend evidence: ${output}`)
  await compose(["build", "test"])
  await compose([
    "run",
    "--no-deps",
    "--rm",
    "test",
    "cargo",
    "build",
    "--locked",
    "--features",
    "fixtures",
  ])
  await compose(["up", "-d", "--wait", "postgres", "mailpit"])
  const mailpitPort = (
    await compose(["port", "mailpit", "8025"], { capture: true })
  )
    .split(":")
    .at(-1)
  const mailpit = `http://127.0.0.1:${mailpitPort}`
  browser = await chromium.launch()
  const settings = JSON.parse(
    await readFile(
      join(root, "packages/i18n/project.inlang/settings.json"),
      "utf8"
    )
  )
  for (const profile of ["generated"]) {
    const directory = root
    await run("pnpm", ["--filter", "@workspace/i18n", "build"])
    const { localizeHref } = await import(
      pathToFileURL(join(directory, "packages/i18n/src/generated/runtime.js"))
    )
    const messages = await import(
      pathToFileURL(join(directory, "packages/i18n/src/generated/messages.js"))
    )
    const webPort = await freePort()
    const apiPort = await freePort()
    const web = `http://127.0.0.1:${webPort}`
    const api = `http://127.0.0.1:${apiPort}`
    composeEnv = {
      ...process.env,
      RUST_AUTH_TEST_API_PORT: String(apiPort),
      RUST_AUTH_TEST_WEB_PORT: String(webPort),
      RUST_AUTH_TEST_BASE_LOCALE: settings.baseLocale,
    }
    const log = await open(join(output, "vite.log"), "a")
    const vite = spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "--config",
        "vite.e2e.config.ts",
        "--port",
        String(webPort),
      ],
      {
        cwd: join(directory, "apps/web"),
        env: { ...process.env, VITE_API_URL: api },
        stdio: ["ignore", log.fd, log.fd],
      }
    )
    try {
      const locales = settings.locales
      for (const locale of locales) {
        const message = (key, params = {}) => messages[key](params, { locale })
        const publicUrl = (path) =>
          new URL(localizeHref(path, { locale }), web).href
        await ready(publicUrl("/sign-in"), vite)
        await compose(["up", "-d", "--force-recreate", "api"])
        await ready(`${api}/api/auth/ok`)
        console.log(`Testing Better Auth SDK: ${profile}/${locale}`)
        await sdkJourney({
          createAuthClient,
          api,
          web,
          mailpit,
          publicUrl,
          message,
        })
        await compose(["restart", "api"])
        await ready(`${api}/api/auth/ok`)
        console.log(
          `Testing actual React frontend in Chromium: ${profile}/${locale}`
        )
        await browserJourney({
          expect,
          browser,
          api,
          mailpit,
          publicUrl,
          message,
          directory: output,
          locale,
        })
        results.push(`${profile}/${locale}: SDK and browser passed`)
      }
    } finally {
      await stop(vite)
      await log.close()
    }
  }
  console.log(results.join("\n"))
} finally {
  if (browser) await browser.close()
  await compose(["logs", "--no-color", "api"], { log: join(output, "api.log") })
  await compose(["down", "--remove-orphans"])
}
