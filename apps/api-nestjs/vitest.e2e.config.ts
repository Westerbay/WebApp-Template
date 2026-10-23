import { DEFAULT_LOCALE } from "@workspace/i18n/config"
import { isLocale } from "@workspace/i18n/runtime"
import swc from "unplugin-swc"
import { defineConfig } from "vitest/config"

const locale = process.env.AUTH_TEST_LOCALE ?? DEFAULT_LOCALE
if (!isLocale(locale)) throw new Error("Unsupported test locale")

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    environment: "node",
    reporters: ["default", "junit"],
    outputFile: `../../output/playwright/${locale}/auth-e2e-results.xml`,
    include: ["test/e2e/**/*.e2e.test.ts"],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 30000,
  },
})
