import { defineConfig } from "@playwright/test";

const executablePath =
  process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"] ??
  (process.platform === "linux" ? "/usr/bin/chromium" : undefined);

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  use: {
    trace: "off",
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
    },
  },
});
