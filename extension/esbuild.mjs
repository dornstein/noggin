// Build script for the tree webview bundle.
//
// tsc compiles the extension host (src/*.ts, excluding src/treeWebview/**).
// esbuild bundles the React tree webview (src/treeWebview/main.tsx) into a
// single IIFE that the WebviewView loads via a vscode-resource <script>.

import { build, context } from 'esbuild';
import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, 'out', 'webview');
const watch = process.argv.includes('--watch');

const config = {
  entryPoints: [resolve(here, 'src', 'treeWebview', 'main.tsx')],
  outfile: resolve(outDir, 'treeView.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  loader: {
    '.tsx': 'tsx',
    '.ts': 'ts',
    '.css': 'css',
    '.ttf': 'file',
    '.woff': 'file',
    '.woff2': 'file',
  },
  // Webview imports from the host's src/treeBridge.ts; .js -> .ts resolution.
  resolveExtensions: ['.tsx', '.ts', '.mjs', '.js', '.jsx', '.json'],
  assetNames: '[name]-[hash]',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
};

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });

if (watch) {
  const ctx = await context(config);
  await ctx.watch();
  console.log('esbuild watching webview…');
} else {
  await build(config);
}
