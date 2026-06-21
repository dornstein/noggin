// CLI golden tests — push verb.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runCli, makeTempNoggin, buildFixture, summarize, getTarget } from './helpers.mjs';

describe('push', () => {
  test('into empty store becomes root and active', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push', 'first', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.status, 'ok');
      const t = getTarget(r.json.data);
      assert.equal(t.title, 'first');
      assert.equal(t.path, '/1');
      assert.equal(t.position, 1);
      assert.equal(r.json.data.activePath, '/1');
      const sum = summarize(n.read());
      assert.equal(sum.active, '/1');
      assert.deepEqual(sum.roots.map((r) => r.title), ['first']);
    } finally { n.cleanup(); }
  });

  test('to active becomes child + new active', () => {
    const n = makeTempNoggin(buildFixture({ active: '1', roots: [{ title: 'parent' }] }));
    try {
      const r = runCli(['push', 'child', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(getTarget(r.json.data).title, 'child');
      assert.equal(getTarget(r.json.data).path, '/1/1');
      assert.equal(r.json.data.activePath, '/1/1');
      const sum = summarize(n.read());
      assert.equal(sum.active, '/1/1');
      assert.equal(sum.roots[0].children[0].title, 'child');
    } finally { n.cleanup(); }
  });

  test('multi-word title via positional', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push', 'review', 'design', 'doc', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(getTarget(r.json.data).title, 'review design doc');
    } finally { n.cleanup(); }
  });

  test('--title flag overrides positional', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['push', 'ignored', '--title', 'wins', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(getTarget(r.json.data).title, 'wins');
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

  test('records createdAt and empty notes defaults', () => {
    const n = makeTempNoggin();
    try {
      runCli(['push', 'x', '--json'], { file: n.file });
      const store = n.read();
      const item = store.items[0];
      assert.ok(item.createdAt, 'createdAt should be set');
      assert.equal(item.pushedAt, undefined, 'pushedAt field should not exist');
      assert.equal(item.closedAt, undefined, 'closedAt field should not exist');
      assert.deepEqual(item.notes, []);
      assert.equal(item.done, false);
    } finally { n.cleanup(); }
  });

  test('JSON output: recursive tree trims ancestor-siblings, target depth lists peers', () => {
    const fixture = buildFixture({
      active: '1',
      roots: [
        { title: 'a', children: [{ title: 'a1' }] },
        { title: 'b' }, // sibling of root ancestor — must be trimmed
      ],
    });
    const n = makeTempNoggin(fixture);
    try {
      const r = runCli(['push', 'new', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const { items, targetKey } = r.json.data;
      assert.equal(getTarget(r.json.data).path, '/1/2');
      assert.equal(r.json.data.activePath, '/1/2');
      // Single root in the rendered tree: 'a'. Sibling 'b' is trimmed.
      assert.equal(items.length, 1);
      assert.equal(items[0].title, 'a');
      // 'a' expands to the target's peer row (a1, new); target identified by targetKey.
      assert.deepEqual(items[0].children.map((c) => c.title), ['a1', 'new']);
      assert.ok(items[0].children.some((c) => c.key === targetKey));
      // Peer 'a1' is a leaf; target carries its (empty) children.
      const a1 = items[0].children.find((c) => c.title === 'a1');
      const target = items[0].children.find((c) => c.key === targetKey);
      // Peer 'a1' is a leaf: no `children` field. Target carries its (empty) children.
      assert.equal('children' in a1, false);
      assert.deepEqual(target.children, []);
    } finally { n.cleanup(); }
  });
});
