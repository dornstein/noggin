// CLI golden tests — `where`.
//
// Contract: `where` prints a single canonical location string identifying
// the noggin in use. The string is whatever was passed to openNoggin
// (which the CLI resolves from --noggin, $NOGGIN, or the default
// `~/.noggin.yaml`) — unexpanded, unresolved, round-trippable.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli, makeTempNoggin } from './helpers.mjs';

describe('where', () => {
  test('JSON --noggin: data is exactly the flag value', () => {
    const n = makeTempNoggin('schemaVersion: 1\nactive: null\nitems: []\n');
    try {
      const r = runCli(['where', '--noggin', n.file, '--json'], { file: null });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.status, 'ok');
      assert.equal(r.json.data, n.file);
    } finally { n.cleanup(); }
  });

  test('JSON env: data is the env-resolved file', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['where', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.data, n.file);
    } finally { n.cleanup(); }
  });

  test('JSON default: data is the symbolic ~/.noggin.yaml', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'noggin-home-'));
    try {
      const r = runCli(['where', '--json'], { file: null, env: { HOME: home, USERPROFILE: home } });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.data, '~/.noggin.yaml');
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  test('--noggin beats env', () => {
    const a = makeTempNoggin();
    const b = makeTempNoggin();
    try {
      const r = runCli(['where', '--noggin', a.file], { file: b.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout.trim(), a.file);
    } finally { a.cleanup(); b.cleanup(); }
  });

  test('human output is the single canonical location, nothing else', () => {
    const n = makeTempNoggin('schemaVersion: 1\nactive: null\nitems: []\n');
    try {
      const r = runCli(['where', '--noggin', n.file], { file: null });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout.trim(), n.file);
      assert.doesNotMatch(r.stdout, /source/);
      assert.doesNotMatch(r.stdout, /exists/);
      assert.doesNotMatch(r.stdout, /^file: /);
    } finally { n.cleanup(); }
  });

  test('relative path passed by --noggin round-trips verbatim', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'noggin-rel-'));
    try {
      const r = runCli(['where', '--noggin', './noggin.yaml', '--json'], {
        file: null,
        cwd: dir,
      });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.data, './noggin.yaml');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
