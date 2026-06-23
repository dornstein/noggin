#!/usr/bin/env node
// Build the docs site to docs/site/dist/, then serve it locally over
// HTTP. Zero dependencies — uses only node:http/fs/path so it works
// on any machine that can already build the docs.
//
// Usage:
//   node docs/site/serve.mjs                # build once, serve on :8080
//   node docs/site/serve.mjs --port 4000
//   node docs/site/serve.mjs --watch        # rebuild on source changes
//   node docs/site/serve.mjs --no-build     # skip the initial build
//
// Stop with Ctrl+C. The dist/ output is in .gitignore.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const BUILD = path.join(here, 'build.mjs');

const argv = process.argv.slice(2);
function flag(name) { return argv.includes(name); }
function opt(name, fallback) {
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(name + '='));
  if (eq) return eq.slice(name.length + 1);
  return fallback;
}

const port = Number(opt('--port', process.env.PORT || '8080'));
const doWatch = flag('--watch');
const doBuild = !flag('--no-build');
const DIST = path.resolve(repoRoot, opt('--out', path.join('docs', 'site', 'dist')));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt':  'text/plain; charset=utf-8',
};

function runBuild() {
  return new Promise((resolve) => {
    const t0 = Date.now();
    process.stdout.write('building… ');
    const child = spawn(process.execPath, [BUILD, '--out', DIST], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (b) => { out += b.toString(); });
    child.on('exit', (code) => {
      const ms = Date.now() - t0;
      if (code === 0) console.log(`ok (${ms}ms)`);
      else { console.log(`failed (exit ${code})`); process.stdout.write(out); }
      resolve(code === 0);
    });
  });
}

async function serveFile(res, fsPath) {
  try {
    const buf = await readFile(fsPath);
    const ext = path.extname(fsPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  let rel = decodeURIComponent(u.pathname);
  if (rel.includes('..')) { res.writeHead(400).end('bad path'); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const fsPath = path.join(DIST, rel);
  // Reject anything that escapes DIST.
  if (!fsPath.startsWith(DIST)) { res.writeHead(400).end('bad path'); return; }

  // Try the exact path, then path/index.html, then 404.
  if (await serveFile(res, fsPath)) return;
  try {
    const s = await stat(fsPath);
    if (s.isDirectory() && await serveFile(res, path.join(fsPath, 'index.html'))) return;
  } catch { /* fall through */ }
  res.writeHead(404, { 'Content-Type': 'text/plain' }).end(`404 ${rel}`);
});

function setupWatch() {
  // Coarse-grained: rebuild when anything under these dirs changes.
  // fs.watch with { recursive: true } is supported on Windows and
  // macOS in modern node; Linux gets best-effort.
  const watchDirs = [
    path.join(here, 'pages'),
    path.join(here, 'generators'),
    path.join(here, 'playground'),
    path.join(here, 'assets'),
    path.join(repoRoot, 'cli'),
    path.join(repoRoot, 'scripts'),
  ];
  let timer = null;
  let building = false;
  let queued = false;
  const trigger = () => {
    if (building) { queued = true; return; }
    building = true;
    runBuild().then(() => {
      building = false;
      if (queued) { queued = false; trigger(); }
    });
  };
  const debounce = () => {
    clearTimeout(timer);
    timer = setTimeout(trigger, 150);
  };
  for (const dir of watchDirs) {
    try {
      watch(dir, { recursive: true }, (_evt, name) => {
        if (!name) return;
        // Skip the dist tree to avoid rebuild loops.
        if (name.split(path.sep).includes('dist')) return;
        if (name.endsWith('~') || name.endsWith('.tmp')) return;
        debounce();
      });
    } catch (e) {
      console.warn(`watch(${dir}) failed: ${e.message}`);
    }
  }
}

(async () => {
  if (doBuild) {
    const ok = await runBuild();
    if (!ok) process.exit(1);
  }
  if (doWatch) setupWatch();
  server.listen(port, () => {
    const urlStr = `http://localhost:${port}/`;
    console.log(`serving ${path.relative(repoRoot, DIST)} at ${urlStr}`);
    if (doWatch) console.log('watching for source changes (Ctrl+C to stop)');
  });
})();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { server.close(() => process.exit(0)); });
}
