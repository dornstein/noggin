// Playwright E2E config for the docs site (tier 4 — full app).
//
// Builds the docs site into _e2e/ and serves it on a free port via
// docs/site/serve.mjs. Tests live in tests/*.spec.ts.
//
// Run with: npm run test:e2e

import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.NOGGIN_DOCS_E2E_PORT || '8125';
// serve.mjs resolves --out against the repo root, not its cwd, so
// give it a repo-relative path that lands inside docs/site/.
const OUT = 'docs/site/_e2e';

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.ts$/,
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    // Builds the docs into _e2e/ and serves it. --no-build skipped so
    // we always test against fresh output.
    command: `node serve.mjs --port ${PORT} --out ${OUT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
