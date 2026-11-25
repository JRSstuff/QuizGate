import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3002",
    trace: "on-first-retry",
    ...devices["Pixel 5"], // Mobile-first viewport (393 x 851, 360px class)
  },
  webServer: {
    command: "npx next start -p 3002",
    url: "http://localhost:3002",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
