import { defineConfig, devices } from "@playwright/test";

const port = 4187;
const chromiumExecutablePath = process.env["WORKSPACE_CHROMIUM_PATH"] ?? "/usr/bin/chromium";

export default defineConfig({
  testDir: "./tests/e2e",
  // Reload replaces the shared test server; browser journeys must not race it.
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions: {
      executablePath: chromiumExecutablePath,
    },
    trace: "on-first-retry",
  },
  webServer: {
    command: `state=$(mktemp -d); trap 'rm -rf "$state"' EXIT; export WORKSPACE_STATE_DIR="$state"; pnpm run build && WORKSPACE_PORT=${port} pnpm run start`,
    port,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
