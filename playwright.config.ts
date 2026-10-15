import { defineConfig, devices } from "@playwright/test";
import { parseSmokeBaseUrl, SMOKE_BASE_URL_ENV } from "./scripts/smoke/smoke-env.ts";

// The local smoke. Run it through npm run smoke (or smoke:run), which starts
// the app and sets the base URL; on its own this config refuses to run.
// One worker, no retries: the scenarios share one server and one login
// limiter, and a retry that passes would hide the flakiness the smoke is for.
// Traces, screenshots and videos are off so the admin password typed into the
// login form is never recorded.
export default defineConfig({
  testDir: "e2e/smoke",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: parseSmokeBaseUrl(process.env[SMOKE_BASE_URL_ENV]),
    ignoreHTTPSErrors: true,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
