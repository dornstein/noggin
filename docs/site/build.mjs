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

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { renderPage } from './template.mjs';
import { renderMarkdown } from './markdown.mjs';
import { buildSchemaPage } from './generators/schema.mjs';
import { buildCliPage } from './generators/cli.mjs';
import { buildApiPage } from './generators/api.mjs';

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

function writeOut(slug, html) {
  const dir = slug === '' ? OUT : path.join(OUT, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
}

// ── 1. Reset output, copy assets ─────────────────────────────────────────────

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(path.join(OUT, 'assets'), { recursive: true });
copyFileSync(path.join(here, 'assets', 'style.css'), path.join(OUT, 'assets', 'style.css'));

// ── 2. Render markdown pages ────────────────────────────────────────────────

const pagesDir = path.join(here, 'pages');
for (const file of readdirSync(pagesDir)) {
  if (!file.endsWith('.md')) continue;
  const src = readFileSync(path.join(pagesDir, file), 'utf8');
  const { meta, body } = parseFrontmatter(src);
  if (!meta.title) throw new Error(`pages/${file}: missing frontmatter title`);
  if (meta.slug === undefined) throw new Error(`pages/${file}: missing frontmatter slug (use "" for root)`);
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
  { slug: 'schema/', title: 'Document schema', build: buildSchemaPage },
  { slug: 'cli/', title: 'CLI reference', build: buildCliPage },
  { slug: 'api/', title: 'JavaScript API', build: buildApiPage },
];

for (const g of generators) {
  const body = g.build();
  const html = renderPage({ slug: g.slug, title: g.title, body });
  writeOut(g.slug, html);
  console.log(`gen   → ${g.slug}`);
}

// ── 4. Invoke the legacy CLI demo builder ───────────────────────────────────

const demoOut = path.join(OUT, 'demo', 'index.html');
mkdirSync(path.dirname(demoOut), { recursive: true });
const demoScript = path.join(repoRoot, 'scripts', 'build-demo-html.mjs');
const r = spawnSync(process.execPath, [demoScript, '--out', demoOut], {
  stdio: 'inherit',
});
if (r.status !== 0) throw new Error(`build-demo-html.mjs exited with ${r.status}`);
console.log(`demo  → demo/`);

// The demo script writes its own full HTML page (it has its own
// styles tailored for the side-by-side scenario layout). That's
// intentional — the demo page is link-only from the rest of the site
// rather than wrapped in the same chrome.

// ── 5. .nojekyll so GitHub Pages serves _every_ file ────────────────────────

writeFileSync(path.join(OUT, '.nojekyll'), '', 'utf8');

console.log(`\nbuilt → ${OUT}`);

// ── Helpers ─────────────────────────────────────────────────────────────────

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
