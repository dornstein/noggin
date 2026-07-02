import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    // Tier-1 logic tests run in node; the tier-2 component test opts
    // into jsdom per-file via a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx,mts,mjs}'],
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
