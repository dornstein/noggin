// esbuild config — bundles the extension host AND the webview entry.
//
// As of Phase 5 the extension host needs to import @noggin/rpc (and
// transitively @noggin/engine). Both are source-only workspace
// packages whose `main` points at `./src/index.ts`, so we can't load
// them at runtime with plain Node ESM resolution. We bundle the
// extension host into a single out/extension.js with vscode as the
// only external — the standard pattern for modern VS Code extensions.
//
// Two bundles:
//
//   - src/extension.ts      -> out/extension.js     (Node CJS; externals: vscode)
//   - src/webview/main.tsx  -> out/webview/app.js   (browser IIFE)
//
// `npm run compile` typechecks with tsc; `npm run bundle` produces
// both bundles; `npm run build` runs both.

import { build, context } from 'esbuild';
import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, 'out');
const webviewOutDir = resolve(outDir, 'webview');
const watch = process.argv.includes('--watch');

// ── Extension host ────────────────────────────────────────────────────

const hostConfig = {
  entryPoints: [resolve(here, 'src', 'extension.ts')],
  outfile: resolve(outDir, 'extension.cjs'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  // vscode is a peer; never bundled. The .mjs synced engine files are
  // bundled in (pure JS importable from anywhere).
  external: ['vscode'],
  loader: {
    '.ts': 'ts',
    '.mjs': 'js',
  },
  preserveSymlinks: true,
  nodePaths: [resolve(here, 'node_modules')],
  resolveExtensions: ['.ts', '.mjs', '.js', '.json'],
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
};

// ── Webview bundle ────────────────────────────────────────────────────

const webviewConfig = {
  entryPoints: [resolve(here, 'src', 'webview', 'main.tsx')],
  outfile: resolve(webviewOutDir, 'app.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  preserveSymlinks: true,
  nodePaths: [resolve(here, 'node_modules')],
  // React (and other packages that ship dual dev/prod builds) branch
  // on process.env.NODE_ENV at module top-level. Without this define,
  // esbuild bundles the development build, which is bigger and uses
  // patterns recent V8 versions reject (the Chromium 148 webview
  // chokes on react-dom-client.development.js).
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  loader: {
    '.tsx': 'tsx',
    '.ts': 'ts',
    '.css': 'css',
    '.ttf': 'file',
    '.woff': 'file',
    '.woff2': 'file',
  },
  resolveExtensions: ['.tsx', '.ts', '.mjs', '.js', '.jsx', '.json'],
  assetNames: '[name]-[hash]',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
};

// ── Run ───────────────────────────────────────────────────────────────

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });

const allConfigs = [hostConfig, webviewConfig];

if (watch) {
  for (const cfg of allConfigs) {
    const ctx = await context(cfg);
    await ctx.watch();
  }
  console.log('esbuild watching extension host + webview…');
} else {
  await Promise.all(allConfigs.map((cfg) => build(cfg)));
}
