// CLI golden tests — note, retitle, show, delete.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runCli, makeTempNoggin, buildFixture, summarize } from './helpers.mjs';

function tree() {
  return buildFixture({
    active: '1',
    roots: [
      { title: 'root1', children: [{ title: 'alpha' }, { title: 'beta', children: [{ title: 'beta-kid' }] }] },
      { title: 'root2' },
    ],
  });
}

describe('note', () => {
  test('appends to active when no path given', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['note', 'first observation', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.deepEqual(sum.roots[0].notes, ['first observation']);
    } finally { n.cleanup(); }
  });

  test('treats first positional as path when it looks like one', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['note', '1/2', 'note on beta', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.deepEqual(sum.roots[0].children[1].notes, ['note on beta']);
      // active unchanged
      assert.equal(sum.active, '1');
    } finally { n.cleanup(); }
  });

  test('treats first positional as text when it does not look like a path', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['note', 'hello', 'world', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(summarize(n.read()).roots[0].notes, ['hello world']);
    } finally { n.cleanup(); }
  });

  test('missing text → exit 2', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['note', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /text required/);
    } finally { n.cleanup(); }
  });

  test('refuses when no active and no path', () => {
    const n = makeTempNoggin(buildFixture({ roots: [{ title: 'x' }] }));
    try {
      const r = runCli(['note', 'hi', '--json'], { file: n.file });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /no active item/);
    } finally { n.cleanup(); }
  });

  test('stamps timestamp on the note', () => {
    const n = makeTempNoggin(tree());
    try {
      runCli(['note', 'tick', '--json'], { file: n.file });
      const item = n.read().items.find((i) => i.title === 'root1');
      assert.equal(item.notes.length, 1);
      assert.match(item.notes[0].timestamp, /\d{4}-\d{2}-\d{2}T/);
      assert.equal(item.notes[0].text, 'tick');
    } finally { n.cleanup(); }
  });

  test('--goto . moves active to the noted item', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['note', '1/2', 'observation', '--goto', '.', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(summarize(n.read()).active, '1/2');
    } finally { n.cleanup(); }
  });
});

describe('retitle', () => {
  test('renames active when no path', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['retitle', 'new', 'name', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(summarize(n.read()).roots[0].title, 'new name');
    } finally { n.cleanup(); }
  });

  test('renames by path', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['retitle', '1/1', 'first', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(summarize(n.read()).roots[0].children[0].title, 'first');
    } finally { n.cleanup(); }
  });

  test('--title flag wins over positional text', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['retitle', '1/1', 'positional', '--title', 'flag-wins', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(summarize(n.read()).roots[0].children[0].title, 'flag-wins');
    } finally { n.cleanup(); }
  });

  test('missing title → exit 2', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['retitle', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /new title required/);
    } finally { n.cleanup(); }
  });

  test('refuses when no active and no path', () => {
    const n = makeTempNoggin(buildFixture({ roots: [{ title: 'x' }] }));
    try {
      const r = runCli(['retitle', 'wat', '--json'], { file: n.file });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /no active item/);
    } finally { n.cleanup(); }
  });
});

describe('show', () => {
  test('default: details for active + its children', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['show', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.data.path, '1');
      assert.deepEqual(r.json.data.children.map((c) => c.title), ['alpha', 'beta']);
    } finally { n.cleanup(); }
  });

  test('by path', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['show', '1/2', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.data.path, '1/2');
      assert.deepEqual(r.json.data.children.map((c) => c.title), ['beta-kid']);
    } finally { n.cleanup(); }
  });

  test('--nokids omits the children list', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['show', '--nokids', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.data.children, undefined);
    } finally { n.cleanup(); }
  });

  test('--notes includes note bodies in human output', () => {
    const n = makeTempNoggin(buildFixture({
      active: '1',
      roots: [{ title: 'root', notes: ['n1', 'n2'] }],
    }));
    try {
      const r = runCli(['show', '--notes'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /n1/);
      assert.match(r.stdout, /n2/);
    } finally { n.cleanup(); }
  });

  test('no active and no path → (no active item; pass a path)', () => {
    const n = makeTempNoggin(buildFixture({ roots: [{ title: 'x' }] }));
    try {
      const r = runCli(['show'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /no active item/);
    } finally { n.cleanup(); }
  });

  test('--goto persists active change', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['show', '1/2', '--goto', '.', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(summarize(n.read()).active, '1/2');
    } finally { n.cleanup(); }
  });
});

describe('delete', () => {
  test('leaf item removed', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['delete', '1/1', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.deepEqual(sum.roots[0].children.map((c) => c.title), ['beta']);
    } finally { n.cleanup(); }
  });

  test('refuses item with descendants without --recursive', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['delete', '1/2', '--json'], { file: n.file });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /descendant/);
    } finally { n.cleanup(); }
  });

  test('--recursive removes whole subtree', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['delete', '1/2', '--recursive', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.deepEqual(sum.roots[0].children.map((c) => c.title), ['alpha']);
    } finally { n.cleanup(); }
  });

  test('deleting the active subtree shifts active to parent', () => {
    const n = makeTempNoggin(buildFixture({
      active: '1/1',
      roots: [{ title: 'parent', children: [{ title: 'kid' }] }],
    }));
    try {
      const r = runCli(['delete', '1/1', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(summarize(n.read()).active, '1');
    } finally { n.cleanup(); }
  });

  test('deleting the only root with active=that root → active becomes null', () => {
    const n = makeTempNoggin(buildFixture({
      active: '1',
      roots: [{ title: 'only' }],
    }));
    try {
      const r = runCli(['delete', '1', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      // active: null is stripped by pruneDefaults
      assert.equal(r.json.data.active, undefined);
      assert.equal(summarize(n.read()).active, null);
    } finally { n.cleanup(); }
  });

  test('missing path → exit 2', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['delete', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /path required/);
    } finally { n.cleanup(); }
  });

  test('--goto refused', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['delete', '1/1', '--goto', '.', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /--goto is not supported/);
    } finally { n.cleanup(); }
  });
});
