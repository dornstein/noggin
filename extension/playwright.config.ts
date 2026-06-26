// Playwright E2E config for the VS Code extension.
//
// Tests live in test/e2e/*.spec.ts. They launch one or more VS Code
// Extension Development Host processes against a temp workspace and
// drive them via CDP. No webServer block — each spec spawns its own
// host(s). See test/e2e/helpers/vscode-host.ts.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  testMatch: /.*\.spec\.ts$/,
  // VS Code launch + extension activation is slow; give specs room.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // CDP attach + host spawn isn't parallel-safe (port allocation races,
  // file-watch deduplication), so default to one worker.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'vscode-host', use: { ...devices['Desktop Chrome'] } },
  ],
});
