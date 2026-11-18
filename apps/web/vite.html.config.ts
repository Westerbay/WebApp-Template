import { defineConfig, mergeConfig } from "vite"
import config from "./vite.config"

export default mergeConfig(config, defineConfig({ envDir: false }))
