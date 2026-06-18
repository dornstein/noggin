// CLI golden tests — push verb.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runCli, makeTempNoggin, buildFixture, summarize } from './helpers.mjs';

describe('push', () => {
  test('into empty store becomes root and active', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push', 'first', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.status, 'ok');
      assert.equal(r.json.data.title, 'first');
      assert.equal(r.json.data.path, '1');
      assert.equal(r.json.data.position, 1);
      assert.equal(r.json.data.active, '1');
      const sum = summarize(n.read());
      assert.equal(sum.active, '1');
      assert.deepEqual(sum.roots.map((r) => r.title), ['first']);
    } finally { n.cleanup(); }
  });

  test('to active becomes child + new active', () => {
    const n = makeTempNoggin(buildFixture({ active: '1', roots: [{ title: 'parent' }] }));
    try {
      const r = runCli(['push', 'child', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.data.title, 'child');
      assert.equal(r.json.data.path, '1/1');
      assert.equal(r.json.data.active, '1/1');
      const sum = summarize(n.read());
      assert.equal(sum.active, '1/1');
      assert.equal(sum.roots[0].children[0].title, 'child');
    } finally { n.cleanup(); }
  });

  test('multi-word title via positional', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push', 'review', 'design', 'doc', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.data.title, 'review design doc');
    } finally { n.cleanup(); }
  });

  test('--title flag overrides positional', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push', 'ignored', '--title', 'wins', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.data.title, 'wins');
    } finally { n.cleanup(); }
  });

  test('missing title is a usage error (exit 2)', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /title required/);
    } finally { n.cleanup(); }
  });

  test('records pushedAt and empty notes defaults', () => {
    const n = makeTempNoggin();
    try {
      runCli(['push', 'x', '--json'], { file: n.file });
      const store = n.read();
      const item = store.items[0];
      assert.ok(item.pushedAt, 'pushedAt should be set');
      assert.equal(item.closedAt, undefined, 'closedAt field should not exist');
      assert.deepEqual(item.notes, []);
      assert.equal(item.done, false);
    } finally { n.cleanup(); }
  });

  test('JSON output includes ancestors/siblings/children shape', () => {
    const fixture = buildFixture({
      active: '1',
      roots: [
        { title: 'a', children: [{ title: 'a1' }] },
        { title: 'b' },
      ],
    });
    const n = makeTempNoggin(fixture);
    try {
      const r = runCli(['push', 'new', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.data.path, '1/2');
      assert.equal(r.json.data.active, '1/2');
      // ancestors: just 'a'
      assert.deepEqual(r.json.data.ancestors.map((a) => a.title), ['a']);
      // siblings: a1 (excludes the new item)
      assert.deepEqual(r.json.data.siblings.map((s) => s.title), ['a1']);
    } finally { n.cleanup(); }
  });
});
