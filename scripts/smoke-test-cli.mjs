#!/usr/bin/env node
// Smoke test: run the bundled CLI through a couple of verbs and confirm
// it can write/read a noggin without crashing on a missing dependency.
// Used by CI to catch the same class of bug the MCP-bundle smoke test
// catches (the bundle accidentally externalising js-yaml, etc.).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import process from 'node:process';

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const bundlePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, 'plugin', 'skills', 'noggin', 'noggin.bundle.mjs');

const tmp = mkdtempSync(path.join(os.tmpdir(), 'noggin-cli-smoke-'));
const nog = path.join(tmp, 'noggin.yaml');

function run(args, expect) {
  const r = spawnSync(process.execPath, [bundlePath, ...args], {
    env: { ...process.env, NOGGIN: nog },
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(`bundle exited ${r.status} on: ${args.join(' ')}`);
    console.error(r.stderr || r.stdout);
    rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
  }
  if (expect && !r.stdout.includes(expect)) {
    console.error(`expected '${expect}' in stdout of: ${args.join(' ')}`);
    console.error(r.stdout);
    rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
  }
  return r.stdout;
}

run(['push', 'bundled cli works']);
run(['add', 'child item']);
run(['show'], 'bundled cli works');
run(['where']);

console.log('CLI bundle smoke test OK');
rmSync(tmp, { recursive: true, force: true });
