// Vitest config for @noggin/rpc.
//
// Pure node tests: the framework is transport-agnostic and the test
// suite exercises everything through MemoryTransport (in-process) plus
// fake clocks for heartbeat / timeout behaviour. No DOM, no jsdom.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.ts'],
  },
});
