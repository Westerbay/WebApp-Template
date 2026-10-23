import swc from "unplugin-swc"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    environment: "node",
    include: ["test/valkey/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 90000,
  },
})
