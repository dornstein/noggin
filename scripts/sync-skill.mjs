#!/usr/bin/env node
// Sync the source-of-truth cli/ directory into the consumer packages
// that need to ship a copy of the skill + CLI:
//
//   plugin/skills/noggin/      ← consumed by the agent plugin runtime
//   extension/skills/noggin/   ← consumed by chatSkills + bundled with the .vsix
//
// Also produces a self-contained MCP server bundle (noggin-mcp.bundle.mjs)
// in each destination via esbuild, because the Codex plugin runtime doesn't
// run `npm install` on plugins. Without the bundle, the MCP server crashes
// on import("@modelcontextprotocol/sdk").
//
// Run after editing anything under cli/. Idempotent.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { buildMcpBundle } from './build-mcp-bundle.mjs';

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const src = path.join(repoRoot, 'cli');
const dests = [
  path.join(repoRoot, 'plugin', 'skills', 'noggin'),
  path.join(repoRoot, 'extension', 'skills', 'noggin'),
];

// Files to copy from cli/ into each destination.
// We deliberately do NOT copy node_modules, package-lock.json, or anything else
// — each consumer manages its own dependencies as appropriate for its runtime.
const files = ['noggin.mjs', 'noggin-mcp.mjs', 'noggin-api.mjs', 'noggin-api.d.mts', 'SKILL.md', 'README.md', 'package.json'];

// Comment-syntax map for the auto-sync banner that the script prepends to
// each copy. We only annotate file types where a comment is harmless. JSON
// has no comment syntax so we just copy it verbatim (the `files` array still
// names it; consumers know it's synced from CONTRIBUTING.md).
const BANNER_FORMATTERS = {
  '.md':   (line) => `<!-- ${line} -->`,
  '.mjs':  (line) => `// ${line}`,
  '.mts':  (line) => `// ${line}`,
  '.js':   (line) => `// ${line}`,
  '.ts':   (line) => `// ${line}`,
};

function bannerFor(srcRel, ext) {
  const fmt = BANNER_FORMATTERS[ext];
  if (!fmt) return null;
  return [
    fmt(`AUTO-SYNCED FROM ${srcRel} — DO NOT EDIT HERE.`),
    fmt(`Edit the source and run: node scripts/sync-skill.mjs`),
    '',
    '',
  ].join('\n');
}

function copyFiles(destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of files) {
    const from = path.join(src, name);
    if (!fs.existsSync(from)) {
      console.warn(`skip (missing): ${path.relative(repoRoot, from)}`);
      continue;
    }
    const to = path.join(destDir, name);
    const ext = path.extname(name);
    const banner = bannerFor(`cli/${name}`, ext);
    if (banner) {
      // Annotate text formats with a header that screams "synced copy".
      // Shebang lines must stay on line 1, so we slip the banner in *after*
      // the shebang when present.
      const contents = fs.readFileSync(from, 'utf8');
      let output;
      if (contents.startsWith('#!')) {
        const nl = contents.indexOf('\n');
        const shebang = contents.slice(0, nl + 1);
        const rest = contents.slice(nl + 1);
        output = shebang + banner + rest;
      } else {
        output = banner + contents;
      }
      fs.writeFileSync(to, output);
    } else {
      // Binary or comment-less formats (e.g., JSON) — straight copy.
      fs.copyFileSync(from, to);
    }
  }
}

for (const dest of dests) {
  copyFiles(dest);
  console.log(`synced -> ${path.relative(repoRoot, dest)}`);
  const bundleOut = path.join(dest, 'noggin-mcp.bundle.mjs');
  await buildMcpBundle(bundleOut);
  console.log(`bundled -> ${path.relative(repoRoot, bundleOut)}`);
}
