#!/usr/bin/env node
// Bundle an entry point (from cli/ or mcp/) into a single self-contained
// ESM file.
//
// The plugin/ distribution ships the cli/ + mcp/ sources but no
// node_modules, and Codex doesn't run `npm install` on plugins. Without
// bundling, scripts that import the MCP SDK or js-yaml crash with
// ERR_MODULE_NOT_FOUND. This builder inlines those deps + the local
// sources into one .mjs that runs with just Node 20+.
//
// Called by scripts/sync-skill.mjs once per bundle target. Can also be
// run standalone for debugging:
//   node scripts/build-mcp-bundle.mjs [--source <dir>] <entry> <output-path>
//
// `--source` defaults to `cli` for back-compat. Pass `--source mcp` for
// the MCP server bundle.

import path from 'node:path';
import url from 'node:url';
import { build } from '../cli/node_modules/esbuild/lib/main.js';

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

/**
 * Build a self-contained bundle from an entry point in `cli/` or `mcp/`.
 * @param {object} args
 * @param {string} args.entry - path to the entry, relative to `source` (e.g. 'noggin-mcp.mjs')
 * @param {string} args.outFile - absolute output path
 * @param {string} [args.source] - source folder under repoRoot (default 'cli')
 * @param {string} [args.label] - human label used in the AUTO-GENERATED banner
 */
export async function buildBundle({ entry, outFile, source = 'cli', label }) {
  const entryAbs = path.join(repoRoot, source, entry);
  const labelText = label ?? `${source}/${entry}`;
  await build({
    entryPoints: [entryAbs],
    outfile: outFile,
    // Pin the working dir so esbuild's path comments are stable across
    // invocations (locally vs CI, run from repo root vs cli/). Without
    // this, local sync produces `engine/...` comments while CI's sync
    // step produces `../engine/...` because of where the user happened
    // to `cd`, which makes the "verify sync clean" check flap.
    absWorkingDir: repoRoot,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    // Mark only Node built-ins as external. Everything else (MCP SDK,
    // js-yaml, the local noggin-api.mjs, providers, serializers) gets inlined.
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
        `// Source: ${labelText} (+ inlined deps).`,
        '// Rebuild: node scripts/sync-skill.mjs',
        '',
      ].join('\n'),
    },
    legalComments: 'none',
    logLevel: 'warning',
  });
}

// Back-compat shim — the MCP-only entry point that existed before we
// generalized this. Kept so old call sites (none in-tree, but in case
// someone scripts it externally) still work.
export async function buildMcpBundle(outFile) {
  return buildBundle({ entry: 'noggin-mcp.mjs', outFile, source: 'mcp' });
}

if (import.meta.url === url.pathToFileURL(process.argv[1] ?? '').href) {
  // Tiny argv parser: optional `--source <dir>` then positional <entry> <output>.
  const argv = process.argv.slice(2);
  let source = 'cli';
  while (argv[0] === '--source') {
    argv.shift();
    source = argv.shift();
  }
  const [entry, out] = argv;
  if (!entry || !out) {
    console.error('usage: node scripts/build-mcp-bundle.mjs [--source <dir>] <entry> <output-path>');
    process.exit(2);
  }
  await buildBundle({ entry, outFile: path.resolve(out), source });
  console.log(`bundled -> ${path.relative(repoRoot, path.resolve(out))}`);
}
