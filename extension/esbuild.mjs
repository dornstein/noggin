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
  // The extension imports from BOTH `@noggin/engine` (via @noggin/rpc's
  // server-adapter) AND `@noggin/engine/providers/file` (side-effect
  // registers the file:// provider as default). Because every workspace
  // package's `file:` dep gets its own node_modules tree, esbuild's
  // path-based resolution can end up loading the engine twice — once
  // for rpc's view, once for the extension's view. That splits the
  // providers registry: file.mjs registers into one instance, the
  // server-adapter looks at the other, and the rpc server reports
  // "no default provider registered". Force every engine subpath to
  // resolve to a single canonical copy.
  alias: {
    '@noggin/engine': resolve(here, 'node_modules', '@noggin', 'engine', 'noggin-api.mjs'),
    '@noggin/engine/providers/file': resolve(here, 'node_modules', '@noggin', 'engine', 'providers', 'file.mjs'),
    '@noggin/engine/providers/memory': resolve(here, 'node_modules', '@noggin', 'engine', 'providers', 'memory.mjs'),
    '@noggin/engine/providers/vscode-todo': resolve(here, 'node_modules', '@noggin', 'engine', 'providers', 'vscode-todo.mjs'),
  },
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
  // The @noggin/ui workspace package brings its own copies of react,
  // react-dom, react/jsx-runtime, etc. under
  // extension/node_modules/@noggin/ui/node_modules/. If we let esbuild
  // resolve those, we end up with TWO React instances bundled — one
  // that our code calls into and one that the hook-dispatcher mounts
  // against — and React's invariant fires:
  //   "Cannot read properties of null (reading 'useState')"
  // Force every React resolution to the extension's own copies.
  alias: {
    'react': resolve(here, 'node_modules', 'react'),
    'react-dom': resolve(here, 'node_modules', 'react-dom'),
    'react/jsx-runtime': resolve(here, 'node_modules', 'react', 'jsx-runtime.js'),
    'react/jsx-dev-runtime': resolve(here, 'node_modules', 'react', 'jsx-dev-runtime.js'),
  },
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
