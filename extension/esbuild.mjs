// esbuild config — bundles the extension host AND the webview entries.
//
// As of Phase 5 the extension host needs to import @noggin/rpc (and
// transitively @noggin/engine). Both are source-only workspace
// packages whose `main` points at `./src/index.ts`, so we can't load
// them at runtime with plain Node ESM resolution. We bundle the
// extension host into a single out/extension.js with vscode as the
// only external — the standard pattern for modern VS Code extensions.
//
// Three bundles:
//
//   - src/extension.ts          -> out/extension.js     (Node ESM, externals: vscode)
//   - src/webview/main.tsx      -> out/webview/app.js   (browser IIFE; Phase 5 combined view)
//   - src/treeWebview/main.tsx  -> out/webview/treeView.js (legacy; deleted in the next commit)
//
// `npm run compile` still typechecks with tsc; `npm run build:webview`
// is now `npm run build` (host + webviews bundled together).

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
  outfile: resolve(outDir, 'extension.js'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  // vscode is a peer; never bundled. The .mjs synced engine files are
  // bundled in by esbuild (they're pure JS importable from anywhere).
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

// ── Webview bundles ───────────────────────────────────────────────────

const webviewShared = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  preserveSymlinks: true,
  nodePaths: [resolve(here, 'node_modules')],
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

const webviewEntries = [
  {
    entryPoints: [resolve(here, 'src', 'webview', 'main.tsx')],
    outfile: resolve(webviewOutDir, 'app.js'),
    ...webviewShared,
  },
  {
    entryPoints: [resolve(here, 'src', 'treeWebview', 'main.tsx')],
    outfile: resolve(webviewOutDir, 'treeView.js'),
    ...webviewShared,
  },
];

// ── Run ───────────────────────────────────────────────────────────────

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });

const allConfigs = [hostConfig, ...webviewEntries];

if (watch) {
  for (const cfg of allConfigs) {
    const ctx = await context(cfg);
    await ctx.watch();
  }
  console.log('esbuild watching extension host + webviews…');
} else {
  await Promise.all(allConfigs.map((cfg) => build(cfg)));
}
