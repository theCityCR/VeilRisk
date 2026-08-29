import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // Vinext can invalidate optimized dependency URLs when multiple browsers
  // first load the Midnight SDK concurrently. Serial execution keeps the
  // desktop/mobile quality gate deterministic.
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: "line",
  use: {
    baseURL: "http://localhost:4173",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --force --port 4173",
    url: "http://localhost:4173",
    reuseExistingServer: false,
  },
});
