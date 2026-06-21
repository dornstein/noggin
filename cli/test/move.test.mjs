// CLI golden tests — move verb.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runCli, makeTempNoggin, buildFixture, summarize } from './helpers.mjs';

function tree() {
  // 1 root1 (active)
  //   1/1 alpha
  //   1/2 beta
  //     1/2/1 beta-kid
  // 2 root2
  return buildFixture({
    active: '1',
    roots: [
      { title: 'root1', children: [{ title: 'alpha' }, { title: 'beta', children: [{ title: 'beta-kid' }] }] },
      { title: 'root2' },
    ],
  });
}

describe('move', () => {
  test('placement required → exit 2', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['move', '/1/1', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /choose exactly one/);
    } finally { n.cleanup(); }
  });

  test('--into reparents under anchor as last child', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['move', '/1/1', '--into', '/2', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.deepEqual(sum.roots[0].children.map((c) => c.title), ['beta']);
      assert.deepEqual(sum.roots[1].children.map((c) => c.title), ['alpha']);
      assert.equal(sum.active, '/1');
    } finally { n.cleanup(); }
  });

  test('--before places as sibling before anchor', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['move', '/2', '--before', '/1', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(summarize(n.read()).roots.map((r) => r.title), ['root2', 'root1']);
    } finally { n.cleanup(); }
  });

  test('--after places as sibling after anchor', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['move', '/1/1', '--after', '/1/2', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(
        summarize(n.read()).roots[0].children.map((c) => c.title),
        ['beta', 'alpha'],
      );
    } finally { n.cleanup(); }
  });

  test('cycle: into self → exit 1', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['move', '/1/2', '--into', '/1/2', '--json'], { file: n.file });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /cycle/);
    } finally { n.cleanup(); }
  });

  test('cycle: into own descendant → exit 1', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['move', '/1/2', '--into', '/1/2/1', '--json'], { file: n.file });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /cycle/);
    } finally { n.cleanup(); }
  });

  test('cycle: before/after own descendant → exit 1', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['move', '/1/2', '--after', '/1/2/1', '--json'], { file: n.file });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /cycle/);
    } finally { n.cleanup(); }
  });

  test('before self is a silent no-op', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['move', '/1/1', '--before', '/1/1', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(
        summarize(n.read()).roots[0].children.map((c) => c.title),
        ['alpha', 'beta'],
      );
    } finally { n.cleanup(); }
  });

  test('default target is active when no path given', () => {
    // Set active to 1/1 then move into 2
    const n = makeTempNoggin(buildFixture({
      active: '1/1',
      roots: [
        { title: 'root1', children: [{ title: 'alpha' }] },
        { title: 'root2' },
      ],
    }));
    try {
      const r = runCli(['move', '--into', '/2', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.deepEqual(sum.roots[1].children.map((c) => c.title), ['alpha']);
      // active still points at the moved item (same key)
      assert.equal(sum.active, '/2/1');
    } finally { n.cleanup(); }
  });

  test('move with no active and no path → exit 1', () => {
    const n = makeTempNoggin(buildFixture({
      roots: [{ title: 'a' }, { title: 'b' }],
    }));
    try {
      const r = runCli(['move', '--into', '/2', '--json'], { file: n.file });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /no active item/);
    } finally { n.cleanup(); }
  });

  test('preserves active by key across reparent', () => {
    const n = makeTempNoggin(tree());
    try {
      runCli(['move', '/1', '--after', '/2', '--json'], { file: n.file });
      const sum = summarize(n.read());
      // root1 moved to position 2; active follows
      assert.equal(sum.active, '/2');
      assert.deepEqual(sum.roots.map((r) => r.title), ['root2', 'root1']);
    } finally { n.cleanup(); }
  });
});
