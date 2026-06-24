import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

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

// Vite's dev server treats `import x from 'node:path'` as a browser
// module and stubs it out with a "module externalized" warning. The
// build config externalizes them correctly via `external` below, but
// dev needs a custom plugin: intercept node: imports and serve a tiny
// ESM shim that does a runtime `require()`. Works because the renderer
// has `nodeIntegration: true`, so `require` is on globalThis.
//
// Only DEFAULT imports are forwarded \u2014 the engine + file backend in
// cli/ exclusively use `import x from 'node:y'` for builtins. If we
// ever add named imports (`import { resolve } from 'node:path'`), the
// shim has to be extended to enumerate keys.
const NODE_BUILTIN_NAMES = new Set([
  'assert', 'buffer', 'child_process', 'crypto', 'events', 'fs',
  'fs/promises', 'http', 'https', 'module', 'net', 'os', 'path',
  'path/posix', 'path/win32', 'process', 'querystring', 'stream',
  'string_decoder', 'timers', 'tls', 'url', 'util', 'worker_threads',
  'zlib',
]);

function nodeBuiltinsAsRuntimeRequire(): Plugin {
  return {
    name: 'noggin:node-builtins-as-runtime-require',
    enforce: 'pre',
    apply: 'serve', // dev only; `build.rollupOptions.external` handles prod
    resolveId(source) {
      const bare = source.startsWith('node:') ? source.slice(5) : source;
      if (!NODE_BUILTIN_NAMES.has(bare)) return null;
      return '\0noggin-node-builtin:' + bare;
    },
    load(id) {
      if (!id.startsWith('\0noggin-node-builtin:')) return null;
      const bare = id.slice('\0noggin-node-builtin:'.length);
      // `require` is available because the renderer's BrowserWindow
      // has `nodeIntegration: true`. We default-export the whole
      // module since every consumer uses `import x from 'node:y'`.
      return [
        `const _m = require(${JSON.stringify(bare)});`,
        `export default _m;`,
      ].join('\n');
    },
  };
}

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
    plugins: [react(), nodeBuiltinsAsRuntimeRequire()],
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
