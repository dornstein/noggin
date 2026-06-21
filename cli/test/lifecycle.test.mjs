// CLI golden tests — goto, done, pop, set.

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

describe('goto', () => {
  test('absolute path sets active', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['goto', '/1/2', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.data.activePath, '/1/2');
      assert.equal(summarize(n.read()).active, '/1/2');
    } finally { n.cleanup(); }
  });

  test('relative path resolves from current active', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['goto', './2/1', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.data.activePath, '/1/2/1');
    } finally { n.cleanup(); }
  });

  test('missing path → exit 2', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['goto', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /path required/);
    } finally { n.cleanup(); }
  });

  test('bad path → exit 1', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['goto', '/9/9', '--json'], { file: n.file });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /path not found/);
    } finally { n.cleanup(); }
  });
});

describe('done', () => {
  test('marks active done and parent becomes active', () => {
    const n = makeTempNoggin(buildFixture({
      active: '1/1',
      roots: [{ title: 'parent', children: [{ title: 'kid' }] }],
    }));
    try {
      const r = runCli(['done', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.equal(sum.active, '/1');
      assert.equal(sum.roots[0].children[0].done, true);
    } finally { n.cleanup(); }
  });

  test('mark by path', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['done', '/1/1', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.equal(sum.roots[0].children[0].done, true);
      // parent becomes active (was already active)
      assert.equal(sum.active, '/1');
    } finally { n.cleanup(); }
  });

  test('refuses when target has open descendants', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['done', '/1/2', '--json'], { file: n.file });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /open descendant/);
    } finally { n.cleanup(); }
  });

  test('--force closes the target leaving open descendants alone', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['done', '/1/2', '--force', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const items = n.read().items;
      const beta = items.find((i) => i.title === 'beta');
      const betaKid = items.find((i) => i.title === 'beta-kid');
      assert.equal(beta.done, true, 'target closed');
      assert.equal(betaKid.done, false, 'descendant left open');
    } finally { n.cleanup(); }
  });

  test('--closeall closes every open descendant first, then the target', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['done', '/1/2', '--closeall', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const items = n.read().items;
      const beta = items.find((i) => i.title === 'beta');
      const betaKid = items.find((i) => i.title === 'beta-kid');
      assert.equal(betaKid.done, true, 'descendant closed');
      assert.equal(beta.done, true, 'target closed');
      // Each got its own system close note.
      assert.equal(beta.notes[beta.notes.length - 1].text, 'closed');
      assert.equal(betaKid.notes[betaKid.notes.length - 1].text, 'closed');
    } finally { n.cleanup(); }
  });

  test('done on an already-done item is idempotent (no error)', () => {
    const n = makeTempNoggin(buildFixture({
      active: '1',
      roots: [{ title: 'root', children: [{ title: 'kid', done: true }] }],
    }));
    try {
      const r = runCli(['done', '/1/1', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      // No duplicate close note (it was never explicitly closed via the CLI
      // either, but more importantly: idempotent means no new note added).
      const kid = n.read().items.find((i) => i.title === 'kid');
      assert.equal(kid.done, true);
      assert.deepEqual(kid.notes ?? [], [], 'already-done idempotent: no extra notes');
    } finally { n.cleanup(); }
  });

  test('refuses when no active and no path', () => {
    const n = makeTempNoggin(buildFixture({ roots: [{ title: 'x' }] }));
    try {
      const r = runCli(['done', '--json'], { file: n.file });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /no active item/);
    } finally { n.cleanup(); }
  });

  test('--goto rejected', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['done', '--goto', '.', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /--goto is not supported/);
    } finally { n.cleanup(); }
  });

  test('done on root sets active to null', () => {
    const n = makeTempNoggin(buildFixture({ active: '1', roots: [{ title: 'only' }] }));
    try {
      const r = runCli(['done', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(summarize(n.read()).active, null);
    } finally { n.cleanup(); }
  });

  test('appends system close note on close', () => {
    const n = makeTempNoggin(buildFixture({
      active: '1',
      roots: [{ title: 'x' }],
    }));
    try {
      runCli(['done', '--json'], { file: n.file });
      const item = n.read().items[0];
      assert.equal(item.done, true);
      assert.equal(item.closedAt, undefined, 'closedAt should not exist');
      assert.ok(Array.isArray(item.notes), 'notes array exists');
      const closeNote = item.notes[item.notes.length - 1];
      assert.equal(closeNote.text, 'closed');
      assert.match(closeNote.timestamp, /\d{4}-\d{2}-\d{2}T/);
    } finally { n.cleanup(); }
  });
});

describe('pop', () => {
  test('equivalent to done() on active', () => {
    const n = makeTempNoggin(buildFixture({
      active: '1/1',
      roots: [{ title: 'parent', children: [{ title: 'kid' }] }],
    }));
    try {
      const r = runCli(['pop', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.equal(sum.active, '/1');
      assert.equal(sum.roots[0].children[0].done, true);
    } finally { n.cleanup(); }
  });

  test('refuses any positional', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['pop', '/1/1', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /takes no path/);
    } finally { n.cleanup(); }
  });

  test('refuses --goto', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['pop', '--goto', '.', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /--goto is not supported/);
    } finally { n.cleanup(); }
  });

  test('refuses when no active item', () => {
    const n = makeTempNoggin(buildFixture({ roots: [{ title: 'x' }] }));
    try {
      const r = runCli(['pop', '--json'], { file: n.file });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /no active item/);
    } finally { n.cleanup(); }
  });

  test('--closeall closes the whole subtree under active, then surfaces', () => {
    const n = makeTempNoggin(buildFixture({
      active: '1',
      roots: [{ title: 'root', children: [{ title: 'kid', children: [{ title: 'grandkid' }] }] }],
    }));
    try {
      const r = runCli(['pop', '--closeall', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const items = n.read().items;
      assert.ok(items.every((i) => i.done === true), 'every item closed');
      // root was active; after pop, active becomes its parent (null).
      assert.equal(summarize(n.read()).active, null);
    } finally { n.cleanup(); }
  });
});

describe('set', () => {
  test('--done marks target done; active unchanged', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['set', '/1/1', '--done', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.equal(sum.roots[0].children[0].done, true);
      assert.equal(sum.active, '/1');
    } finally { n.cleanup(); }
  });

  test('--undone reopens without adding a note', () => {
    const n = makeTempNoggin(buildFixture({
      active: '1',
      roots: [{ title: 'root', children: [{ title: 'kid', done: true }] }],
    }));
    try {
      const r = runCli(['set', '/1/1', '--undone', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const item = n.read().items.find((i) => i.title === 'kid');
      assert.equal(item.done, false);
      assert.deepEqual(item.notes ?? [], [], 'undone does not add or modify notes');
    } finally { n.cleanup(); }
  });

  test('--done is idempotent (no second close note on a done item)', () => {
    const n = makeTempNoggin(buildFixture({
      active: '1',
      roots: [{ title: 'root', children: [{ title: 'kid', done: true, notes: ['closed'] }] }],
    }));
    try {
      const r = runCli(['set', '/1/1', '--done', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const item = n.read().items.find((i) => i.title === 'kid');
      assert.equal(item.done, true);
      assert.equal(item.notes.length, 1, 'no extra close note');
    } finally { n.cleanup(); }
  });

  test('--undone is idempotent on an already-open item', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['set', '/1/1', '--undone', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(summarize(n.read()).roots[0].children[0].done, false);
    } finally { n.cleanup(); }
  });

  test('--done and --undone together → exit 2', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['set', '/1/1', '--done', '--undone', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /mutually exclusive/);
    } finally { n.cleanup(); }
  });

  test('no state and no title → exit 2', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['set', '/1/1', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /nothing to set/);
    } finally { n.cleanup(); }
  });

  test('--done refused on item with open descendants (no --force/--closeall)', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['set', '/1/2', '--done', '--json'], { file: n.file });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /open descendant/);
    } finally { n.cleanup(); }
  });

  test('--done --force closes the target and leaves descendants open', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['set', '/1/2', '--done', '--force', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const items = n.read().items;
      assert.equal(items.find((i) => i.title === 'beta').done, true);
      assert.equal(items.find((i) => i.title === 'beta-kid').done, false);
    } finally { n.cleanup(); }
  });

  test('--done --closeall closes descendants too', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['set', '/1/2', '--done', '--closeall', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const items = n.read().items;
      assert.equal(items.find((i) => i.title === 'beta').done, true);
      assert.equal(items.find((i) => i.title === 'beta-kid').done, true);
    } finally { n.cleanup(); }
  });

  test('--force without --done → exit 2', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['set', '/1/1', '--undone', '--force', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /--force only applies when closing/);
    } finally { n.cleanup(); }
  });

  test('--closeall without --done → exit 2', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['set', '/1/1', '--title', 'X', '--closeall', '--json'], { file: n.file });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /--closeall only applies when closing/);
    } finally { n.cleanup(); }
  });

  test('--title alone renames without touching state', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['set', '/1/1', '--title', 'renamed', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const sum = summarize(n.read());
      assert.equal(sum.roots[0].children[0].title, 'renamed');
      assert.equal(sum.roots[0].children[0].done, false);
    } finally { n.cleanup(); }
  });

  test('--done + --title in one call', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['set', '/1/1', '--done', '--title', 'finished', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      const items = n.read().items;
      const it = items.find((i) => i.title === 'finished');
      assert.ok(it, 'renamed');
      assert.equal(it.done, true, 'closed');
    } finally { n.cleanup(); }
  });

  test('--goto . changes active', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['set', '/1/1', '--done', '--goto', '.', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(summarize(n.read()).active, '/1/1');
    } finally { n.cleanup(); }
  });

  test('default target is active when no path given', () => {
    const n = makeTempNoggin(tree());
    try {
      const r = runCli(['set', '--undone', '--json'], { file: n.file });
      assert.equal(r.code, 0, r.stderr);
      // root1 was not done, no error; remains not done
      assert.equal(summarize(n.read()).roots[0].done, false);
    } finally { n.cleanup(); }
  });
});
