import { defineConfig, devices } from "@playwright/test";

const port = 4187;
const chromiumExecutablePath = process.env["WORKSPACE_CHROMIUM_PATH"] ?? "/usr/bin/chromium";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions: {
      executablePath: chromiumExecutablePath,
    },
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run build && WORKSPACE_MODE=production WORKSPACE_PORT=${port} npm run start`,
    port,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
