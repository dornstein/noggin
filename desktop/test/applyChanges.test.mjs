// applyChanges patcher tests.
//
// Run via `npm test` (vitest). The patcher under test lives in TS;
// the test inlines a JS copy mirroring it. This file documents the
// contract; the dev-mode parity assertion in the renderer is the
// day-to-day safety net.

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { diffDocuments } from '@noggin/engine';

// Minimal NogginNode patcher mirroring desktop/src/renderer/src/applyChanges.ts.
// Kept here so the test can run without a TS build step. If the TS
// version changes, this copy must change too — failure mode is the
// dev-mode parity assertion in the renderer catches drift on first run.

function applyChanges(nodes, changes, ctx) {
  let forest = nodes.map(clone);
  for (const ch of changes) {
    switch (ch.kind) {
      case 'added': {
        const data = ctx.lookup(ch.key);
        if (!data) break;
        const newNode = { key: ch.key, path: '', title: data.title, done: data.done, noteCount: data.noteCount, children: [] };
        forest = insertAt(forest, ch.parentKey, ch.position, newNode);
        break;
      }
      case 'removed': forest = removeByKey(forest, ch.key); break;
      case 'moved': {
        const p = pluck(forest, ch.key);
        if (!p) break;
        forest = p.forest;
        forest = insertAt(forest, ch.to.parentKey, ch.to.position, p.node);
        break;
      }
      case 'updated': {
        const data = ctx.lookup(ch.key);
        if (!data) break;
        forest = updateByKey(forest, ch.key, (n) => ({
          ...n,
          title: ch.fields.includes('title') ? data.title : n.title,
          done: ch.fields.includes('done') ? data.done : n.done,
          noteCount: ch.fields.includes('notes') ? data.noteCount : n.noteCount,
        }));
        break;
      }
      case 'activeChanged': break;
    }
  }
  renumberAll(forest, '');
  return forest;
}
function clone(n) { return { ...n, children: n.children.map(clone) }; }
function insertAt(forest, parentKey, position, newNode) {
  if (parentKey === null) {
    const next = forest.slice();
    next.splice(clamp(position, 0, next.length), 0, newNode);
    return next;
  }
  return mapForest(forest, (n) => {
    if (n.key !== parentKey) return n;
    const kids = n.children.slice();
    kids.splice(clamp(position, 0, kids.length), 0, newNode);
    return { ...n, children: kids };
  });
}
function removeByKey(forest, key) {
  const out = forest.filter((n) => n.key !== key);
  if (out.length !== forest.length) return out;
  return mapForest(forest, (n) => {
    const kept = n.children.filter((c) => c.key !== key);
    if (kept.length === n.children.length) return n;
    return { ...n, children: kept };
  });
}
function pluck(forest, key) {
  const topIdx = forest.findIndex((n) => n.key === key);
  if (topIdx >= 0) {
    const node = forest[topIdx];
    const next = forest.slice(); next.splice(topIdx, 1);
    return { node, forest: next };
  }
  for (let i = 0; i < forest.length; i++) {
    const n = forest[i];
    const inner = pluck(n.children, key);
    if (!inner) continue;
    const nextForest = forest.slice();
    nextForest[i] = { ...n, children: inner.forest };
    return { node: inner.node, forest: nextForest };
  }
  return null;
}
function updateByKey(forest, key, patch) {
  let touched = false;
  const out = forest.map((n) => {
    if (n.key === key) { touched = true; return patch(n); }
    const inner = updateByKey(n.children, key, patch);
    if (inner === n.children) return n;
    touched = true;
    return { ...n, children: inner };
  });
  return touched ? out : forest;
}
function mapForest(forest, fn) {
  let changed = false;
  const out = forest.map((n) => {
    const next = fn(n);
    if (next !== n) { changed = true; return next; }
    const innerKids = mapForest(n.children, fn);
    if (innerKids !== n.children) { changed = true; return { ...n, children: innerKids }; }
    return n;
  });
  return changed ? out : forest;
}
function renumberAll(forest, prefix) {
  for (let i = 0; i < forest.length; i++) {
    const path = `${prefix}/${i + 1}`;
    forest[i].path = path;
    renumberAll(forest[i].children, path);
  }
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── Test helpers ──────────────────────────────────────────────────

function node(key, title, children = []) {
  return { key, path: '', title, done: false, noteCount: 0, children };
}
function freshContext(items) {
  return {
    lookup: (key) => {
      function find(list) {
        for (const it of list) {
          if (it.key === key) return { title: it.title, done: it.done, noteCount: it.noteCount };
          const f = find(it.children); if (f) return f;
        }
        return null;
      }
      return find(items);
    },
  };
}
function paths(forest) {
  const out = [];
  function walk(list) {
    for (const n of list) { out.push(`${n.path} ${n.title}`); walk(n.children); }
  }
  walk(forest);
  return out;
}

describe('applyChanges patcher', () => {
  it('adds a sibling and renumbers correctly', () => {
    const before = [node('a', 'A'), node('b', 'B')];
    const ctx = freshContext([...before, node('c', 'C')]);
    const after = applyChanges(before, [
      { kind: 'added', key: 'c', parentKey: null, position: 1 },
    ], ctx);
    assert.deepEqual(paths(after), ['/1 A', '/2 C', '/3 B']);
  });

  it('removes a middle item and renumbers siblings', () => {
    const before = [node('a', 'A'), node('b', 'B'), node('c', 'C')];
    const after = applyChanges(before, [{ kind: 'removed', key: 'b' }], freshContext(before));
    assert.deepEqual(paths(after), ['/1 A', '/2 C']);
  });

  it('moves a node across parents', () => {
    const before = [
      node('a', 'A', [node('a1', 'A1')]),
      node('b', 'B'),
    ];
    const after = applyChanges(before, [
      { kind: 'moved', key: 'a1', from: { parentKey: 'a', position: 0 }, to: { parentKey: 'b', position: 0 } },
    ], freshContext(before));
    assert.deepEqual(paths(after), ['/1 A', '/2 B', '/2/1 A1']);
  });

  it('updates title in place', () => {
    const before = [node('a', 'old')];
    const refreshed = [{ key: 'a', title: 'new', done: false, noteCount: 0, children: [] }];
    const ctx = { lookup: (k) => k === 'a' ? { title: 'new', done: false, noteCount: 0 } : null };
    const after = applyChanges(before, [
      { kind: 'updated', key: 'a', fields: ['title'] },
    ], ctx);
    assert.equal(after[0].title, 'new');
    void refreshed;
  });

  it('matches a full re-projection after a complex sequence', () => {
    // Simulate building a tree via verbs and verify the patcher result
    // matches what `diffDocuments` produced and a fresh projection would
    // produce. (We use diffDocuments to produce real changes from two
    // document snapshots so the test exercises the same payload shape
    // the engine emits at runtime.)
    function doc(items, active = null) { return { schemaVersion: 1, active, items }; }
    function dItem(key, parentKey, title, done = false, notes = []) {
      return { key, parentKey, title, done, notes, createdAt: '2026-06-01T00:00:00.000Z' };
    }
    const before = doc([
      dItem('a', null, 'A'),
      dItem('b', null, 'B'),
      dItem('b1', 'b', 'B1'),
    ]);
    const after = doc([
      dItem('a', null, 'A!'),               // updated title
      dItem('c', null, 'C'),                // added
      dItem('b', null, 'B'),                // moved (now at pos 2)
      dItem('b1', 'b', 'B1', true),         // updated done
    ]);

    const changes = diffDocuments(before, after);

    // Build the starting forest from `before`.
    function project(items) {
      const byParent = new Map();
      for (const it of items) {
        const key = it.parentKey ?? null;
        const list = byParent.get(key);
        if (list) list.push(it); else byParent.set(key, [it]);
      }
      function build(parentKey, prefix) {
        const kids = byParent.get(parentKey) || [];
        return kids.map((it, i) => {
          const p = `${prefix}/${i + 1}`;
          return { key: it.key, path: p, title: it.title, done: it.done, noteCount: (it.notes || []).length, children: build(it.key, p) };
        });
      }
      return build(null, '');
    }
    const beforeForest = project(before.items);
    const ctx = {
      lookup: (key) => {
        const it = after.items.find((x) => x.key === key);
        if (!it) return null;
        return { title: it.title, done: it.done, noteCount: (it.notes || []).length };
      },
    };
    const patched = applyChanges(beforeForest, changes, ctx);
    const fresh = project(after.items);

    assert.deepEqual(patched, fresh, `incremental forest must equal fresh projection.\npatched:\n${JSON.stringify(patched, null, 2)}\nfresh:\n${JSON.stringify(fresh, null, 2)}`);
  });
});
