#!/usr/bin/env node
// Sync the source-of-truth engine/ + cli/ directories into the consumer
// packages that need to ship a copy of the skill + CLI:
//
//   plugin/skills/noggin/      ← consumed by the agent plugin runtime
//   extension/skills/noggin/   ← consumed by chatSkills + bundled with the .vsix
//
// Also produces a self-contained MCP server bundle (noggin-mcp.bundle.mjs)
// in each destination via esbuild, because the Codex plugin runtime doesn't
// run `npm install` on plugins. Without the bundle, the MCP server crashes
// on import("@modelcontextprotocol/sdk").
//
// Run after editing anything under engine/ or cli/. Idempotent.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { buildBundle } from './build-mcp-bundle.mjs';

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const engineSrc = path.join(repoRoot, 'engine');
const cliSrc = path.join(repoRoot, 'cli');
const mcpSrc = path.join(repoRoot, 'mcp');
const dests = [
  path.join(repoRoot, 'plugin', 'skills', 'noggin'),
  path.join(repoRoot, 'extension', 'skills', 'noggin'),
];

// Files to copy into each destination, paired with their source root.
// The destination layout stays flat (noggin-api.mjs and providers/file.mjs
// sit alongside noggin.mjs) so consumers that import via
// '../skills/noggin/noggin-api.mjs' don't need to change paths.
// Entries may use forward slashes for nested paths; the script mirrors
// the structure under each destination.
// We deliberately do NOT copy node_modules, package-lock.json, or anything
// else — each consumer manages its own dependencies as appropriate for
// its runtime.
const files = [
  // Engine source-of-truth: data model, verbs, providers, serializers,
  // and the agent-facing skill protocol.
  { src: engineSrc, name: 'noggin-api.mjs', label: 'engine/noggin-api.mjs' },
  { src: engineSrc, name: 'noggin-api.d.mts', label: 'engine/noggin-api.d.mts' },
  { src: engineSrc, name: 'providers/file.mjs', label: 'engine/providers/file.mjs' },
  { src: engineSrc, name: 'providers/file.d.mts', label: 'engine/providers/file.d.mts' },
  { src: engineSrc, name: 'providers/memory.mjs', label: 'engine/providers/memory.mjs' },
  { src: engineSrc, name: 'providers/memory.d.mts', label: 'engine/providers/memory.d.mts' },
  { src: engineSrc, name: 'serializers/yaml.mjs', label: 'engine/serializers/yaml.mjs' },
  { src: engineSrc, name: 'serializers/yaml.d.mts', label: 'engine/serializers/yaml.d.mts' },
  { src: engineSrc, name: 'serializers/json.mjs', label: 'engine/serializers/json.mjs' },
  { src: engineSrc, name: 'serializers/json.d.mts', label: 'engine/serializers/json.d.mts' },
  { src: engineSrc, name: 'SKILL.md', label: 'engine/SKILL.md' },
  // CLI source-of-truth: argv parser + user-facing intro README.
  { src: cliSrc, name: 'noggin.mjs', label: 'cli/noggin.mjs' },
  { src: cliSrc, name: 'README.md', label: 'cli/README.md' },
  // MCP source-of-truth: stdio JSON-RPC server + its package.json (the
  // bundle inlines the version from this manifest so the MCP wire shows
  // the noggin-mcp package version).
  { src: mcpSrc, name: 'noggin-mcp.mjs', label: 'mcp/noggin-mcp.mjs' },
  { src: mcpSrc, name: 'package.json', label: 'mcp/package.json' },
];

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
  // One-time cleanup: the engine's backends/ folder was renamed to
  // providers/ in Phase 0b of the noggin-rpc plan. Remove any stale
  // `backends/` folder a previous sync left behind so the destination
  // mirrors the current source exactly.
  const staleBackends = path.join(destDir, 'backends');
  if (fs.existsSync(staleBackends)) {
    fs.rmSync(staleBackends, { recursive: true, force: true });
  }
  for (const entry of files) {
    const from = path.join(entry.src, entry.name);
    if (!fs.existsSync(from)) {
      console.warn(`skip (missing): ${path.relative(repoRoot, from)}`);
      continue;
    }
    const to = path.join(destDir, entry.name);
    // Ensure parent directory exists for nested paths.
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const ext = path.extname(entry.name);
    const banner = bannerFor(entry.label, ext);
    if (banner) {
      // Annotate text formats with a header that screams "synced copy".
      // Two things have to stay on top of the file ahead of the banner:
      //   1. Shebang lines (`#!`) must stay on line 1 or Unix won't honor them.
      //   2. YAML frontmatter (`---` … `---` at the very top of a Markdown
      //      file) is how skill loaders find `name`/`description`. Anything
      //      before the opening `---` — including an HTML comment — invalidates
      //      the frontmatter.
      // So: detect either, slip the banner in just after, and otherwise
      // prepend to the top.
      const contents = fs.readFileSync(from, 'utf8');
      let output;
      if (contents.startsWith('#!')) {
        const nl = contents.indexOf('\n');
        const shebang = contents.slice(0, nl + 1);
        const rest = contents.slice(nl + 1);
        output = shebang + banner + rest;
      } else if (contents.startsWith('---\n') || contents.startsWith('---\r\n')) {
        // YAML frontmatter: find the closing `---` line and place the banner after it.
        const lines = contents.split(/\r?\n/);
        let closeIdx = -1;
        for (let i = 1; i < lines.length; i++) {
          if (lines[i] === '---') { closeIdx = i; break; }
        }
        if (closeIdx >= 0) {
          const frontmatter = lines.slice(0, closeIdx + 1).join('\n') + '\n';
          const rest = lines.slice(closeIdx + 1).join('\n');
          // Drop the leading blank line of `rest` if there is one — the banner
          // already ends with the spacer.
          const trimmedRest = rest.startsWith('\n') ? rest.slice(1) : rest;
          output = frontmatter + banner + trimmedRest;
        } else {
          // Unterminated frontmatter — fall back to plain prepend.
          output = banner + contents;
        }
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

// Bundles to produce in each destination. Each entry becomes a
// self-contained .bundle.mjs alongside the unbundled source. The
// unbundled noggin.mjs / noggin-mcp.mjs are still synced for reference,
// but consumers (Codex plugin, anyone running from plugin/skills/noggin/)
// should use the .bundle.mjs because the plugin distribution has no
// node_modules.
const bundles = [
  { entry: 'noggin.mjs',     out: 'noggin.bundle.mjs',     source: 'cli' },
  { entry: 'noggin-mcp.mjs', out: 'noggin-mcp.bundle.mjs', source: 'mcp' },
];

for (const dest of dests) {
  copyFiles(dest);
  console.log(`synced -> ${path.relative(repoRoot, dest)}`);
  for (const { entry, out, source } of bundles) {
    const outAbs = path.join(dest, out);
    await buildBundle({ entry, outFile: outAbs, source });
    console.log(`bundled -> ${path.relative(repoRoot, outAbs)}`);
  }
}
