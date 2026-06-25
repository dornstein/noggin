// Concurrency test: parallel CLI invocations against the same noggin
// file must not lose updates. The file backend's cross-process lock
// (proper-lockfile) is what protects us; this test would fail with
// last-write-wins or no locking at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', '..', 'cli', 'noggin.mjs');

function spawnPush(file, title) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, NOGGIN: file };
    const child = spawn(process.execPath, [CLI, 'add', title], { env });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(`exit ${code}: ${stderr}`));
      else resolve();
    });
    child.on('error', reject);
  });
}

test('parallel CLI adds against one file: no lost updates', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'noggin-concur-'));
  const file = path.join(dir, '.noggin.yaml');
  try {
    const N = 8;
    const titles = Array.from({ length: N }, (_, i) => `task-${i}`);
    await Promise.all(titles.map((t) => spawnPush(file, t)));
    const doc = yaml.load(readFileSync(file, 'utf8'));
    const got = doc.items.map((i) => i.title).sort();
    const want = [...titles].sort();
    assert.deepEqual(got, want, 'all N adds should land');
    // All items should have unique keys (no duplicate-on-retry bugs).
    const keys = new Set(doc.items.map((i) => i.key));
    assert.equal(keys.size, N, 'unique keys');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
