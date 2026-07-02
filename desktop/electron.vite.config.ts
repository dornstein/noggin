import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// electron-vite bundles main + preload + renderer through Vite in
// separate "environments". Each gets its own config below.
//
// Phase 4 of the noggin-rpc plan moved the engine from the renderer
// into the main process. The renderer is now a regular browser
// bundle (no Node access); the engine + file provider run in main
// behind a noggin-rpc server. The `nodeBuiltinsAsRuntimeRequire` dev
// plugin and the renderer-side `node:*` externalization that used to
// live here are gone — neither is needed once the renderer stops
// importing the engine.

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
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
      // Pin the dev port so multiple Vite apps on the same machine
      // don't collide. electron-vite would otherwise default to 5173
      // (the Vite default), which clashes with any unrelated Vite
      // app already using that port. `strictPort: true` makes the
      // failure obvious instead of silently bumping to 5174+.
      port: 5200,
      strictPort: true,
      fs: {
        // The renderer pulls @noggin/ui from a sibling workspace folder.
        // Allow the whole repo so its source is reachable in dev.
        allow: [resolve(__dirname, '..')],
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
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
