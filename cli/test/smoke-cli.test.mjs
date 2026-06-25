// Smoke test: `node noggin.mjs help` exits 0 and prints the help banner.
// The 174-test engine suite lives in engine/test/ — this file just
// asserts the CLI still bootstraps against the extracted engine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', 'noggin.mjs');

test('noggin help bootstraps and prints the banner', () => {
  const r = spawnSync(process.execPath, [CLI, 'help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /working-memory tree CLI/);
});

test('noggin (no args) prints help (exit 0)', () => {
  const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /working-memory tree CLI/);
});
