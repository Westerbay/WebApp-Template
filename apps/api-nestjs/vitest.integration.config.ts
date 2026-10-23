import swc from "unplugin-swc"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    environment: "node",
    include: ["test/integration/**/*.integration.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
