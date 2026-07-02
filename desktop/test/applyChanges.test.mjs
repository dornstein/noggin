// applyChanges patcher tests (tier 1 · logic).
//
// Tests the REAL patcher imported from the renderer module — no inlined
// copy. `diffDocuments` produces real `ItemChange` payloads from two
// document snapshots so the test exercises the same shape the engine
// emits at runtime.

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { diffDocuments } from '@noggin/engine';
import { applyChanges } from '../src/renderer/src/applyChanges.ts';

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
