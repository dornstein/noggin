// CLI golden tests — file resolution (`where`).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli, makeTempNoggin } from './helpers.mjs';

describe('where', () => {
  test('reports the --file flag with source=flag', () => {
    const n = makeTempNoggin('schemaVersion: 1\nactive: null\nitems: []\n');
    try {
      const r = runCli(['where', '--file', n.file, '--json'], { file: null });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.status, 'ok');
      assert.equal(r.json.data.source, 'flag');
      assert.equal(r.json.data.file, n.file);
      assert.equal(r.json.data.exists, true);
    } finally { n.cleanup(); }
  });

  test('reports the env var with source=env', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['where', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.data.source, 'env');
      assert.equal(r.json.data.file, n.file);
      // exists:false is pruned; absence means "does not exist"
      assert.equal(r.json.data.exists, undefined);
    } finally { n.cleanup(); }
  });

  test('falls back to ~/.noggin.yaml when no flag or env', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'noggin-home-'));
    try {
      const r = runCli(['where', '--json'], { file: null, env: { HOME: home, USERPROFILE: home } });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.data.source, 'default');
      assert.match(r.json.data.file, /\.noggin\.yaml$/);
      // env:null pruned (no $NOGGIN_FILE set); exists:false pruned (default file absent)
      assert.equal(r.json.data.env, undefined);
      assert.equal(r.json.data.exists, undefined);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  test('--file beats env', () => {
    const a = makeTempNoggin();
    const b = makeTempNoggin();
    try {
      const r = runCli(['where', '--file', a.file, '--json'], { file: b.file });
      assert.equal(r.json.data.source, 'flag');
      assert.equal(r.json.data.file, a.file);
    } finally { a.cleanup(); b.cleanup(); }
  });

  test('human output prints the resolved path and metadata', () => {
    const n = makeTempNoggin('schemaVersion: 1\nactive: null\nitems: []\n');
    try {
      const r = runCli(['where', '--file', n.file], { file: null });
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, new RegExp(n.file.replace(/\\/g, '\\\\')));
      assert.match(r.stdout, /source: flag/);
      assert.match(r.stdout, /exists: true/);
    } finally { n.cleanup(); }
  });
});
