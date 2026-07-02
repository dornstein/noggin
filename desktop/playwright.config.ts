import { defineConfig } from '@playwright/test';

// Tier-4 end-to-end config for the desktop app. Launches the real
// Electron app via `_electron.launch()` (see test/e2e/). Separate from
// the vitest suite: vitest owns `*.test.*`, Playwright owns `test/e2e/`.
export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 1,
  reporter: [['list']],
});
