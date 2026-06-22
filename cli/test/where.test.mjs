// CLI golden tests — file resolution (`where`).
//
// In the post-fileNoggin world the where verb's JSON output is a
// describe() string, not a structured FileResolution. The CLI's human
// output still shows the resolution source (flag/env/default) for
// diagnostics; the JSON only carries describe()'s string.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli, makeTempNoggin } from './helpers.mjs';

describe('where', () => {
  test('JSON --file: data string mentions the file', () => {
    const n = makeTempNoggin('schemaVersion: 1\nactive: null\nitems: []\n');
    try {
      const r = runCli(['where', '--file', n.file, '--json'], { file: null });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.status, 'ok');
      assert.equal(typeof r.json.data, 'string');
      assert.match(r.json.data, new RegExp(n.file.replace(/\\/g, '\\\\')));
      assert.match(r.json.data, /exists: true/);
    } finally { n.cleanup(); }
  });

  test('JSON env: describe shows the env-resolved file', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['where', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(typeof r.json.data, 'string');
      assert.match(r.json.data, new RegExp(n.file.replace(/\\/g, '\\\\')));
    } finally { n.cleanup(); }
  });

  test('JSON default: describe shows ~/.noggin.yaml', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'noggin-home-'));
    try {
      const r = runCli(['where', '--json'], { file: null, env: { HOME: home, USERPROFILE: home } });
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.json.data, /\.noggin\.yaml/);
      assert.match(r.json.data, /exists: false/);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  test('--file beats env (human output mentions the flag-resolved file)', () => {
    const a = makeTempNoggin();
    const b = makeTempNoggin();
    try {
      const r = runCli(['where', '--file', a.file], { file: b.file });
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, new RegExp(a.file.replace(/\\/g, '\\\\')));
      assert.match(r.stdout, /source: flag/);
    } finally { a.cleanup(); b.cleanup(); }
  });

  test('human output prints the resolved path, exists, and source', () => {
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
