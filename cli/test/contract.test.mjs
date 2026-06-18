// CLI golden tests — JSON output contract and exit-code mapping.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runCli, makeTempNoggin, buildFixture } from './helpers.mjs';

describe('JSON output contract', () => {
  test('always wraps as { status: "ok", data: ... }', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push', 'x', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.status, 'ok');
      assert.ok('data' in r.json);
    } finally { n.cleanup(); }
  });

  test('prunes false, null, and empty collections from data', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push', 'x', '--json'], { file: n.file });
      // fresh item has done=false, closedAt=null, notes=[], no ancestors/siblings/children
      assert.equal(r.code, 0, r.stderr);
      const data = r.json.data;
      assert.equal(data.done, undefined, 'false stripped');
      assert.equal(data.closedAt, undefined, 'null stripped');
      assert.equal(data.notes, undefined, 'empty array stripped');
      assert.equal(data.ancestors, undefined);
      assert.equal(data.siblings, undefined);
      // children stripped because empty
      assert.equal(data.children, undefined);
    } finally { n.cleanup(); }
  });

  test('includes title, key, path, position, active', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push', 'first', '--json'], { file: n.file });
      const d = r.json.data;
      assert.equal(typeof d.key, 'string');
      assert.match(d.key, /^i-\d{8}-\d{6}-[0-9a-f]{6}$/);
      assert.equal(d.title, 'first');
      assert.equal(d.path, '1');
      assert.equal(d.position, 1);
      assert.equal(d.active, '1');
    } finally { n.cleanup(); }
  });

  test('siblings exclude the focused item', () => {
    const n = makeTempNoggin(buildFixture({
      active: '1/2',
      roots: [{ title: 'r', children: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] }],
    }));
    try {
      const r = runCli(['show', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      // siblings of b → a and c, never b
      const titles = (r.json.data.siblings || []).map((s) => s.title);
      assert.deepEqual(titles, ['a', 'c']);
    } finally { n.cleanup(); }
  });

  test('--debug prints human output then JSON', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push', 'x', '--debug'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      // human line should appear before the JSON block
      const jsonIdx = r.stdout.indexOf('{');
      const humanIdx = r.stdout.indexOf('[1');
      assert.ok(humanIdx >= 0 && humanIdx < jsonIdx, 'human output should precede JSON');
    } finally { n.cleanup(); }
  });
});

describe('exit codes and stderr', () => {
  test('usage errors → exit 2 with "noggin: " prefix', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /^noggin: /);
    } finally { n.cleanup(); }
  });

  test('runtime errors → exit 1', () => {
    const n = makeTempNoggin(buildFixture({ active: '1', roots: [{ title: 'x' }] }));
    try {
      const r = runCli(['done', '1', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr); // first done ok
      const r2 = runCli(['done', '1', '--json'], { file: n.file });
      assert.equal(r2.code, 1);
      assert.match(r2.stderr, /already done/);
    } finally { n.cleanup(); }
  });

  test('unknown verb → exit 2', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['frobnicate', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /unknown command/);
    } finally { n.cleanup(); }
  });

  test('unknown flag → exit 2', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push', 'x', '--bogus', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /unknown flag/);
    } finally { n.cleanup(); }
  });

  test('schema version mismatch → exit 2', () => {
    const n = makeTempNoggin('schemaVersion: 99\nactive: null\nitems: []\n');
    try {
      const r = runCli(['show', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /schemaVersion/);
    } finally { n.cleanup(); }
  });

  test('help text prints and exits 0', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['help'], { file: n.file });
      assert.equal(r.code, 0);
      assert.match(r.stdout, /working-memory tree CLI/);
      assert.match(r.stdout, /Verbs:/);
    } finally { n.cleanup(); }
  });

  test('no args prints help and exits 0', () => {
    const r = runCli([], { file: null });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /working-memory tree CLI/);
  });
});
