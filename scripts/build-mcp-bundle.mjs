#!/usr/bin/env node
// Bundle cli/noggin-mcp.mjs into a single self-contained ESM file.
//
// The plugin/ distribution ships the MCP server source but no node_modules,
// and Codex doesn't run `npm install` on plugins. Without bundling, the
// server crashes on import("@modelcontextprotocol/sdk"). This script inlines
// the SDK, js-yaml, and noggin-api.mjs into one .mjs that runs with just
// Node 20+.
//
// Called by scripts/sync-skill.mjs for each plugin/extension destination.
// Can also be run standalone for debugging:
//   node scripts/build-mcp-bundle.mjs <output-path>

import path from 'node:path';
import url from 'node:url';
import { build } from '../cli/node_modules/esbuild/lib/main.js';

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

export async function buildMcpBundle(outFile) {
  await build({
    entryPoints: [path.join(repoRoot, 'cli', 'noggin-mcp.mjs')],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    // Mark only Node built-ins as external. Everything else (the MCP SDK,
    // js-yaml, the local noggin-api.mjs) gets inlined.
    external: [
      'node:*',
      'fs', 'path', 'os', 'crypto', 'url', 'util', 'stream',
      'process', 'tty', 'events', 'buffer', 'string_decoder',
    ],
    // esbuild preserves the entry file's shebang already; the banner just
    // labels the artifact so anyone opening it sees it's generated.
    banner: {
      js: [
        '// AUTO-GENERATED BUNDLE — DO NOT EDIT.',
        '// Source: cli/noggin-mcp.mjs (+ inlined @modelcontextprotocol/sdk, js-yaml, cli/noggin-api.mjs).',
        '// Rebuild: node scripts/sync-skill.mjs',
        '',
      ].join('\n'),
    },
    legalComments: 'none',
    logLevel: 'warning',
  });
}

if (import.meta.url === url.pathToFileURL(process.argv[1] ?? '').href) {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: node scripts/build-mcp-bundle.mjs <output-path>');
    process.exit(2);
  }
  await buildMcpBundle(path.resolve(out));
  console.log(`bundled -> ${path.relative(repoRoot, path.resolve(out))}`);
}
