// Playwright Component Testing config for @noggin/ui.
//
// Mounts a single component in a real Chromium page. Use this tier
// for tests where jsdom can't help — layout, sizing, ResizeObserver,
// display:none, HTML5 drag-and-drop, virtualization, real focus.
//
// Tests live in src/__tests__/ct/**/*.ct.{ts,tsx}. The mount entry
// point is playwright/index.html + playwright/index.ts.
//
// Run with: npm run test:ct

import { defineConfig, devices } from '@playwright/experimental-ct-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const shimDir = path.join(here, '..', 'docs', 'site', 'playground', 'shims');

export default defineConfig({
  testDir: './src/__tests__/ct',
  testMatch: /.*\.ct\.(ts|tsx)$/,
  snapshotDir: './src/__tests__/ct/__snapshots__',
  timeout: 10_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'on-first-retry',
    ctPort: 3100,
    // Resolve the @noggin/ui workspace package + its subpath exports
    // against the local source. Mirrors the alias map in
    // docs/site/build.mjs for the playground bundle.
    //
    // The node:* shims point at docs/site/playground/shims/* so CT
    // fixtures can import `@noggin/engine/providers/memory` and drive
    // a real in-process noggin (engine pulls `node:crypto` for key
    // generation, which doesn't exist in a browser).
    ctViteConfig: {
      resolve: {
        alias: {
          '@noggin/ui': '/src/index.ts',
          '@noggin/ui/styles.css': '/src/styles.css',
          '@noggin/ui/tokens.css': '/src/tokens.css',
          '@noggin/ui/themes/light.css': '/src/themes/light.css',
          '@noggin/ui/themes/dark.css': '/src/themes/dark.css',
          '@noggin/ui/themes/auto.css': '/src/themes/auto.css',
          '@noggin/ui/themes/vscode.css': '/src/themes/vscode.css',
          'node:fs': path.join(shimDir, 'fs.mjs'),
          'node:path': path.join(shimDir, 'path.mjs'),
          'node:os': path.join(shimDir, 'os.mjs'),
          'node:crypto': path.join(shimDir, 'crypto.mjs'),
        },
      },
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
