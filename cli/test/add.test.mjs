// CLI golden tests — add verb.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runCli, makeTempNoggin, buildFixture, summarize } from './helpers.mjs';

function withTree() {
  // root1 (active)
  //   1/1 alpha
  //   1/2 beta
  // root2
  return buildFixture({
    active: '1',
    roots: [
      { title: 'root1', children: [{ title: 'alpha' }, { title: 'beta' }] },
      { title: 'root2' },
    ],
  });
}

describe('add', () => {
  test('default placement is child of active; active unchanged', () => {
    const n = makeTempNoggin(withTree());
    try {
      const r = runCli(['add', 'gamma', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.equal(sum.active, '1');
      assert.deepEqual(sum.roots[0].children.map((c) => c.title), ['alpha', 'beta', 'gamma']);
      // emitted target is the new item, not the active item
      assert.equal(r.json.data.title, 'gamma');
      assert.equal(r.json.data.path, '1/3');
      assert.equal(r.json.data.active, '1');
    } finally { n.cleanup(); }
  });

  test('--into <path> appends as last child of anchor', () => {
    const n = makeTempNoggin(withTree());
    try {
      const r = runCli(['add', 'inner', '--into', '1/1', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.equal(sum.roots[0].children[0].children[0].title, 'inner');
      assert.equal(r.json.data.path, '1/1/1');
    } finally { n.cleanup(); }
  });

  test('--before <path> inserts as sibling before anchor', () => {
    const n = makeTempNoggin(withTree());
    try {
      const r = runCli(['add', 'pre-alpha', '--before', '1/1', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.deepEqual(
        sum.roots[0].children.map((c) => c.title),
        ['pre-alpha', 'alpha', 'beta'],
      );
      assert.equal(r.json.data.path, '1/1');
    } finally { n.cleanup(); }
  });

  test('--after <path> inserts as sibling after anchor', () => {
    const n = makeTempNoggin(withTree());
    try {
      const r = runCli(['add', 'mid', '--after', '1/1', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.deepEqual(
        sum.roots[0].children.map((c) => c.title),
        ['alpha', 'mid', 'beta'],
      );
      assert.equal(r.json.data.path, '1/2');
    } finally { n.cleanup(); }
  });

  test('mutually exclusive: --before and --after together → exit 2', () => {
    const n = makeTempNoggin(withTree());
    try {
      const r = runCli(['add', 'x', '--before', '1/1', '--after', '1/2', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /mutually exclusive/);
    } finally { n.cleanup(); }
  });

  test('placement flag without value → exit 2', () => {
    const n = makeTempNoggin(withTree());
    try {
      const r = runCli(['add', 'x', '--into', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /requires a value/);
    } finally { n.cleanup(); }
  });

  test('--goto . moves active to the new item', () => {
    const n = makeTempNoggin(withTree());
    try {
      const r = runCli(['add', 'gamma', '--goto', '.', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.equal(sum.active, '1/3');
      assert.equal(r.json.data.active, '1/3');
    } finally { n.cleanup(); }
  });

  test('--goto bare (no path) moves active to the new item', () => {
    const n = makeTempNoggin(withTree());
    try {
      const r = runCli(['add', 'gamma', '--goto', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.equal(sum.active, '1/3');
    } finally { n.cleanup(); }
  });

  test('missing title → exit 2', () => {
    const n = makeTempNoggin(withTree());
    try {
      const r = runCli(['add', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /title required/);
    } finally { n.cleanup(); }
  });

  test('into empty store with no placement → root, active unchanged (null)', () => {
    const n = makeTempNoggin();
    try {
      const r = runCli(['add', 'first', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.equal(sum.active, null);
      assert.deepEqual(sum.roots.map((r) => r.title), ['first']);
    } finally { n.cleanup(); }
  });
});
