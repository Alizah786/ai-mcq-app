import { defineConfig, devices } from "@playwright/test";

const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT || 5173);
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 4000);
const FRONTEND_URL = process.env.E2E_FRONTEND_URL || `http://127.0.0.1:${FRONTEND_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120000,
  expect: {
    timeout: 15000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: FRONTEND_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: `npm run start`,
      cwd: "../../backend",
      url: `http://127.0.0.1:${BACKEND_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${FRONTEND_PORT}`,
      cwd: ".",
      url: FRONTEND_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
});

