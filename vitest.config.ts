import { defineConfig } from "vitest/config"
import { tmpdir } from "node:os"
import { join } from "node:path"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
    env: { RADAR_HOME: join(tmpdir(), "radar-test-home") },
  },
})
