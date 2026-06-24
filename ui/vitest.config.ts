// Vitest config for the @noggin/ui package.
//
// We bundle React components and the @noggin/cli engine directly from
// source. Tests run in jsdom and have access to a full DOM, so the
// same components our hosts (desktop, extension) ship can be driven
// end-to-end with real keyboard/mouse events and a live in-memory
// noggin.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
