import { defineConfig } from "@playwright/test"

const port = Number(process.env.HTML_CHECK_PORT)
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Run pnpm test:html to allocate an isolated port")

export default defineConfig({
  testDir: "./test/html",
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: "list",
  outputDir: process.env.HTML_CHECK_OUTPUT,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js preview --config vite.html.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
  },
})
