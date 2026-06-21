// CLI golden tests — note, set (title), show, delete.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runCli, makeTempNoggin, buildFixture, summarize, getTarget } from './helpers.mjs';

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
      const r = runCli(['note', '/1/2', 'note on beta', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.deepEqual(sum.roots[0].children[1].notes, ['note on beta']);
      // active unchanged
      assert.equal(sum.active, '/1');
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
      const r = runCli(['note', '/1/2', 'observation', '--goto', '.', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(summarize(n.read()).active, '/1/2');
    } finally { n.cleanup(); }
  });
});

describe('set (title operations — formerly `retitle`)', () => {
  test('renames active when no path', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['set', '--title', 'new name', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(summarize(n.read()).roots[0].title, 'new name');
    } finally { n.cleanup(); }
  });

  test('renames by path', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['set', '/1/1', '--title', 'first', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(summarize(n.read()).roots[0].children[0].title, 'first');
    } finally { n.cleanup(); }
  });

  test('setting the same title is idempotent (no error)', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['set', '/1/1', '--title', 'alpha', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(summarize(n.read()).roots[0].children[0].title, 'alpha');
    } finally { n.cleanup(); }
  });

  test('no state and no title → exit 2', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['set', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /nothing to set/);
    } finally { n.cleanup(); }
  });

  test('refuses when no active and no path', () => {
    const n = makeTempNoggin(buildFixture({ roots: [{ title: 'x' }] }));
    try {
      const r = runCli(['set', '--title', 'wat', '--json'], { file: n.file });
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
      const target = getTarget(r.json.data);
      assert.equal(target.path, '/1');
      assert.deepEqual(target.children.map((c) => c.title), ['alpha', 'beta']);
    } finally { n.cleanup(); }
  });

  test('by path', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['show', '/1/2', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const target = getTarget(r.json.data);
      assert.equal(target.path, '/1/2');
      assert.deepEqual(target.children.map((c) => c.title), ['beta-kid']);
    } finally { n.cleanup(); }
  });

  test('--nokids: target.children field is omitted', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['show', '--nokids', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const target = getTarget(r.json.data);
      // --nokids omits the `children` field entirely (no field rather than null).
      assert.equal('children' in target, false);
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
      const r = runCli(['show', '/1/2', '--goto', '.', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(summarize(n.read()).active, '/1/2');
    } finally { n.cleanup(); }
  });

  test('--allup adds ancestor siblings (as leaves) along the spine', () => {
    // tree: /1 root1{/1/1 alpha, /1/2 beta{/1/2/1 beta-kid}}, /2 root2
    // Show /1/2/1: default shows only the spine (root1→beta→beta-kid),
    // trimming root1's sibling alpha. --allup keeps alpha as a leaf.
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['show', '/1/2/1', '--allup', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const [root1] = r.json.data.items;
      assert.equal(root1.title, 'root1');
      const titles = root1.children.map((c) => c.title);
      // root1's full child row, NOT just the spine descent.
      assert.deepEqual(titles, ['alpha', 'beta']);
      // alpha is a leaf (ancestor sibling): no `children` field.
      const alpha = root1.children.find((c) => c.title === 'alpha');
      assert.equal('children' in alpha, false);
      // beta keeps its expanded subtree.
      const beta = root1.children.find((c) => c.title === 'beta');
      assert.deepEqual(beta.children.map((c) => c.title), ['beta-kid']);
    } finally { n.cleanup(); }
  });

  test('--alldown expands the target subtree recursively', () => {
    // Show /1 with --alldown: every descendant gets a `children` field.
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['show', '/1', '--alldown', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const target = getTarget(r.json.data);
      assert.equal(target.title, 'root1');
      const beta = target.children.find((c) => c.title === 'beta');
      // beta normally would be a leaf; with --alldown it has its kids.
      assert.deepEqual(beta.children.map((c) => c.title), ['beta-kid']);
      // beta-kid has no kids; --alldown still emits an empty `children`.
      const betaKid = beta.children[0];
      assert.deepEqual(betaKid.children, []);
      // alpha (also under root1) is expanded — empty children.
      const alpha = target.children.find((c) => c.title === 'alpha');
      assert.deepEqual(alpha.children, []);
    } finally { n.cleanup(); }
  });

  test('--all combines --allup and --alldown', () => {
    // Show /1/2 with --all: root1's siblings appear; beta's whole subtree expands.
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['show', '/1/2/1', '--all', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      // allUp: root1's sibling row in root1.children includes alpha (as leaf).
      const root1 = r.json.data.items[0];
      assert.ok(root1.children.some((c) => c.title === 'alpha'));
      // allDown applies at the target (beta-kid) — it gets a children: [].
      const target = getTarget(r.json.data);
      assert.deepEqual(target.children, []);
    } finally { n.cleanup(); }
  });

  test('--alldown and --nokids are mutually exclusive', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['show', '--alldown', '--nokids', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /mutually exclusive/);
    } finally { n.cleanup(); }
  });
});

describe('delete', () => {
  test('leaf item removed', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['delete', '/1/1', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.deepEqual(sum.roots[0].children.map((c) => c.title), ['beta']);
    } finally { n.cleanup(); }
  });

  test('refuses item with descendants without --recursive', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['delete', '/1/2', '--json'], { file: n.file });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /descendant/);
    } finally { n.cleanup(); }
  });

  test('--recursive removes whole subtree', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['delete', '/1/2', '--recursive', '--json'], { file: n.file });
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
      const r = runCli(['delete', '/1/1', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(summarize(n.read()).active, '/1');
    } finally { n.cleanup(); }
  });

  test('deleting the only root with active=that root → active becomes null', () => {
    const n = makeTempNoggin(buildFixture({
      active: '1',
      roots: [{ title: 'only' }],
    }));
    try {
      const r = runCli(['delete', '/1', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.data.deleted.path, '/1');
      assert.equal(r.json.data.deleted.title, 'only');
      // descendantCount:0 and view:null both pruned (their defaults).
      assert.equal(r.json.data.descendantCount, undefined);
      assert.equal(r.json.data.view, undefined);
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
      const r = runCli(['delete', '/1/1', '--goto', '.', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /--goto is not supported/);
    } finally { n.cleanup(); }
  });
});
