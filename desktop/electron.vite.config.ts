import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// electron-vite bundles main + preload + renderer through Vite in
// separate "environments". Each gets its own config below.
//
// The main process imports the noggin engine + file backend directly
// from `desktop/skills/noggin/` (a synced copy of the canonical cli/).
// We tell Vite to leave node_modules alone and not bundle them — Electron
// loads them at runtime — and to leave the synced skills/noggin/ files
// alone too so the import path stays stable.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: [/^\.\.\/\.\.\/skills\/noggin\//],
      },
      // Output ESM so we can use top-level await + import.meta.url.
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

  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: 'src/preload/index.ts',
        // Preload must be CJS for contextBridge to work on the older
        // sandboxed renderer model. electron-vite handles this default
        // but we set it explicitly to be safe.
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
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
});
