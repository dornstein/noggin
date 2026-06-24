import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// electron-vite bundles main + preload + renderer through Vite in
// separate "environments". Each gets its own config below.
//
// As of this commit the renderer ALSO loads the noggin engine and the
// file backend in-process — so we configure it as an Electron renderer
// (Node + Chromium) rather than a pure browser bundle: node: builtins
// and 'electron' are externalized so they're loaded at runtime via
// require(), not bundled.

const NODE_BUILTINS = [
  'electron',
  /^node:/,
  'fs', 'fs/promises', 'path', 'os', 'url', 'crypto', 'events', 'stream',
  'util', 'buffer', 'child_process',
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: [/^\.\.\/\.\.\/skills\/noggin\//],
      },
      lib: {
        entry: 'src/main/index.ts',
        formats: ['es'],
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },

  // Preload exposes only thin shell IPC (file dialogs + menu actions).
  // The renderer has full Node access via nodeIntegration, so the
  // engine itself is loaded directly in the renderer process.
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: 'src/preload/index.ts',
        formats: ['cjs'],
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },

  renderer: {
    plugins: [react()],
    root: 'src/renderer',
    server: {
      fs: {
        // The renderer pulls @noggin/ui from a sibling workspace folder
        // and the engine from ../../skills/noggin/. Allow the whole repo.
        allow: [resolve(__dirname, '..')],
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
        external: NODE_BUILTINS,
      },
    },
    optimizeDeps: {
      exclude: ['electron'],
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
});
