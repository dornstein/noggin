#!/usr/bin/env node
// Build the noggin docs site under <out>/.
//
// Steps:
//   1. Copy assets/style.css.
//   2. Render each markdown page in pages/ to <out>/<slug>/index.html.
//   3. Run dynamic generators (CLI ref, JS API ref, schema) and write
//      to their slug locations.
//   4. Invoke scripts/build-demo-html.mjs into <out>/demo/index.html.
//
// Usage:
//   node docs/site/build.mjs                # → docs/site/dist/
//   node docs/site/build.mjs --out _site    # → _site/

import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { renderPage } from './template.mjs';
import { renderMarkdown } from './markdown.mjs';
import { buildSchemaPage } from './generators/schema.mjs';
import { buildCliPage } from './generators/cli.mjs';
import { buildApiPages } from './generators/api.mjs';
import { buildMcpPage } from './generators/mcp.mjs';
import { buildDemoPage } from './generators/demo.mjs';
import { buildPlaygroundPage } from './generators/playground.mjs';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

function parseOut() {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) return path.resolve(process.cwd(), argv[i + 1]);
    if (argv[i].startsWith('--out=')) return path.resolve(process.cwd(), argv[i].slice(6));
  }
  return path.join(here, 'dist');
}

const OUT = parseOut();
// Build atomically: write everything into a per-process
// `<OUT>.staging.<pid>` directory, then rmSync(OUT) + rename in
// one step at the end. Nothing observable changes in `OUT` until
// every generator has succeeded. A crash / audit failure mid-build
// leaves the previous build's output untouched.
//
// The PID suffix is what makes this safe under concurrent builds
// (e.g. serve.mjs's watch-triggered rebuild running alongside a
// manual `node build.mjs` invocation). Without it, both processes
// would share one staging directory and clobber each other's
// writes; whichever swap fired last would win with a
// half-populated result.
const STAGE = `${OUT}.staging.${process.pid}`;

function writeOut(slug, html) {
  const dir = slug === '' ? STAGE : path.join(STAGE, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
}

// ── 1. Prepare staging directory ────────────────────────────────────────────

// Wipe any leftover from a previous failed build; start clean.
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
mkdirSync(path.join(STAGE, 'assets'), { recursive: true });
copyFileSync(path.join(here, 'assets', 'style.css'), path.join(STAGE, 'assets', 'style.css'));

// Publish the canonical JSON Schema at /noggin.schema.json so its `$id`
// (https://dornstein.github.io/noggin/noggin.schema.json) resolves to the
// actual schema bytes with proper `application/json` content-type.
copyFileSync(path.join(repoRoot, 'engine', 'noggin.schema.json'), path.join(STAGE, 'noggin.schema.json'));

// ── 2. Render markdown pages ────────────────────────────────────────────────

const pagesDir = path.join(here, 'pages');
for (const file of walkMarkdown(pagesDir)) {
  const src = readFileSync(file, 'utf8');
  const rel = path.relative(pagesDir, file);
  const { meta, body } = parseFrontmatter(src);
  if (!meta.title) throw new Error(`pages/${rel}: missing frontmatter title`);
  if (meta.slug === undefined) throw new Error(`pages/${rel}: missing frontmatter slug (use "" for root)`);
  const html = renderPage({
    slug: meta.slug,
    title: meta.title,
    body: renderMarkdown(body),
  });
  writeOut(meta.slug, html);
  console.log(`page  → ${meta.slug || '/'}`);
}

// ── 3. Run dynamic generators ───────────────────────────────────────────────

const generators = [
  { slug: 'schema/', title: 'Noggin schema', build: buildSchemaPage },
  { slug: 'cli/', title: 'CLI reference', build: buildCliPage },
  { slug: 'mcp/', title: 'MCP server', build: buildMcpPage },
  { slug: 'demo/', title: 'Verb demo', build: buildDemoPage },
  { slug: 'playground/', title: 'Playground', build: buildPlaygroundPage },
];

for (const g of generators) {
  const body = g.build();
  const html = renderPage({ slug: g.slug, title: g.title, body });
  writeOut(g.slug, html);
  console.log(`gen   → ${g.slug}`);
}

// The API reference is a multi-page generator: it produces one page
// per exported symbol (or tight cluster of related symbols) so the
// nav can link directly into each type / function / class. Each entry
// is `{ slug, title, body }` and rendered through the same template
// chrome as everything else.
for (const page of buildApiPages()) {
  const html = renderPage({ slug: page.slug, title: page.title, body: page.body });
  writeOut(page.slug, html);
  console.log(`gen   → ${page.slug}`);
}

// ── 3b. Bundle the playground browser code with esbuild ───────────────────

await bundlePlayground();

// ── 4. .nojekyll so GitHub Pages serves _every_ file ────────────────────────

writeFileSync(path.join(STAGE, '.nojekyll'), '', 'utf8');

// ── 5. Atomic swap: replace OUT with STAGE ─────────────────────────────────
//
// Everything above wrote to STAGE. If we made it here, every generator
// succeeded — so swap the staging directory into place. Any observer
// (dev server, GitHub Pages upload) that started reading OUT during
// the build kept reading the previous good tree; from this point on
// they read the new one.
//
// The wipe-and-rename pair isn't a single atomic op on Windows, but
// it's the same pattern every static-site generator uses and is
// robust enough in practice. Concurrent builds don't interfere with
// each other because each writes to its own PID-suffixed STAGE.

rmSync(OUT, { recursive: true, force: true });
renameSync(STAGE, OUT);

// Clean up any orphaned staging dirs from previous crashed builds
// (ours has already been renamed, so this only sweeps siblings).
for (const entry of readdirSync(path.dirname(OUT), { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.startsWith(path.basename(OUT) + '.staging.')) {
    rmSync(path.join(path.dirname(OUT), entry.name), { recursive: true, force: true });
  }
}

console.log(`\nbuilt → ${OUT}`);

// ── Helpers ─────────────────────────────────────────────────────────────────

function* walkMarkdown(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMarkdown(full);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      yield full;
    }
  }
}

function parseFrontmatter(text) {
  // Minimal YAML-ish frontmatter parser. Only supports
  //   key: value
  //   key: "value with: colons"
  //   key: ""        (empty string)
  // Frontmatter is delimited by `---` on its own line at the very top.
  // Normalize line endings up front so we don't have to deal with \r\n
  // separately on every check.
  const norm = text.replace(/\r\n/g, '\n');
  if (!norm.startsWith('---\n')) return { meta: {}, body: text };
  const end = norm.indexOf('\n---\n', 4);
  if (end < 0) return { meta: {}, body: text };
  const block = norm.slice(4, end);
  const body = norm.slice(end + 5);
  const meta = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    meta[m[1]] = v;
  }
  return { meta, body };
}

// ── Playground bundler ───────────────────────────────────────────────────────
//
// Builds docs/site/playground/main.mjs → dist/playground/playground.js
// for the in-browser CLI demo. Esbuild is borrowed from cli/node_modules
// (the docs site itself has no deps).

async function bundlePlayground() {
  const { createRequire } = await import('node:module');
  const require = createRequire(path.join(repoRoot, 'cli/package.json'));
  const esbuild = require('esbuild');
  const entry = path.join(here, 'playground', 'main.mjs');
  const outfile = path.join(STAGE, 'playground', 'playground.js');
  const shimDir = path.join(here, 'playground', 'shims');
  // React, react-dom, @noggin/ui and its transitive deps live in
  // ui/node_modules. Add that as a resolution root so the playground
  // bundle can find them without docs/site needing its own
  // package.json entries.
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: false,
    minify: true,
    logLevel: 'warning',
    jsx: 'automatic',
    loader: {
      '.ts': 'ts',
      '.tsx': 'tsx',
      '.css': 'css',
      '.ttf': 'file',
    },
    nodePaths: [path.join(repoRoot, 'ui', 'node_modules')],
    alias: {
      'node:fs': path.join(shimDir, 'fs.mjs'),
      'node:path': path.join(shimDir, 'path.mjs'),
      'node:os': path.join(shimDir, 'os.mjs'),
      'node:crypto': path.join(shimDir, 'crypto.mjs'),
      // Resolve the @noggin/ui workspace package and its subpath
      // exports directly against the ui/ sources. The docs site has
      // no package.json declaring @noggin/ui as a dependency, so
      // esbuild's default node resolver can't find it.
      '@noggin/ui': path.join(repoRoot, 'ui', 'src', 'index.ts'),
      '@noggin/ui/styles.css': path.join(repoRoot, 'ui', 'src', 'styles.css'),
      '@noggin/ui/tokens.css': path.join(repoRoot, 'ui', 'src', 'tokens.css'),
      '@noggin/ui/themes/light.css': path.join(repoRoot, 'ui', 'src', 'themes', 'light.css'),
      '@noggin/ui/themes/dark.css': path.join(repoRoot, 'ui', 'src', 'themes', 'dark.css'),
      '@noggin/ui/themes/auto.css': path.join(repoRoot, 'ui', 'src', 'themes', 'auto.css'),
      '@noggin/ui/themes/vscode.css': path.join(repoRoot, 'ui', 'src', 'themes', 'vscode.css'),
    },
  });
  console.log(`bundle → playground/playground.js`);
}
