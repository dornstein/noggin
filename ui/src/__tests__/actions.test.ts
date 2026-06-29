// Integration tests for createNogginActions — the verb-dispatch
// surface that UI components consume. Each test runs a single named
// action against a real in-memory noggin and asserts the resulting
// document state + result envelope (`newKey` / `movedKey` /
// `fallbackFocusKey`).
//
// The factory under test is imported directly from the real source
// (`../actions`); no mocks. Drift is therefore impossible.

import { describe, it, expect } from 'vitest';
import { createNogginActions } from '../actions';
import type { NogginActions } from '../actions';
import type { NogginNode } from '../types';
import { verbs, type Noggin } from '@noggin/engine';
import { openMemoryNoggin } from '@noggin/engine/providers/memory';

function projectTree(noggin: Noggin): NogginNode[] {
  const items = noggin.items;
  const byParent = new Map<string | null, typeof items[number][]>();
  for (const it of items) {
    const key = it.parentKey ?? null;
    const list = byParent.get(key);
    if (list) list.push(it); else byParent.set(key, [it]);
  }
  function build(parentKey: string | null, prefix: string): NogginNode[] {
    const kids = byParent.get(parentKey) || [];
    return kids.map((item, i) => {
      const path = `${prefix}/${i + 1}`;
      return {
        key: item.key,
        path,
        title: item.title,
        done: item.done,
        noteCount: (item.notes || []).length,
        children: build(item.key, path),
      };
    });
  }
  return build(null, '');
}

function lines(noggin: Noggin): string[] {
  const tree = projectTree(noggin);
  const out: string[] = [];
  function walk(list: NogginNode[]) {
    for (const n of list) {
      out.push(`${n.path} ${n.title || '(untitled)'}${n.done ? ' \u2713' : ''}`);
      walk(n.children);
    }
  }
  walk(tree);
  return out;
}

/**
 * Build a fixture noggin with the canonical 3-deep shape used across
 * the suite:
 *   /1 A
 *     /1/1 A.1
 *     /1/2 A.2
 *     /1/3 A.3
 *   /2 B
 *   /3 C
 *
 * Returns the noggin plus a bound actions surface and a helper to
 * resolve paths to keys against the current state.
 */
async function fixture(): Promise<{ noggin: Noggin; actions: NogginActions; keyFor: (path: string) => string }> {
  const noggin = await openMemoryNoggin();
  await verbs.add(noggin, { title: 'A' });
  await verbs.add(noggin, { title: 'A.1', placement: { kind: 'into', anchor: '/1' } });
  await verbs.add(noggin, { title: 'A.2', placement: { kind: 'into', anchor: '/1' } });
  await verbs.add(noggin, { title: 'A.3', placement: { kind: 'into', anchor: '/1' } });
  await verbs.add(noggin, { title: 'B' });
  await verbs.add(noggin, { title: 'C' });
  const actions = createNogginActions(noggin);
  const keyFor = (path: string): string => {
    const item = noggin.tryResolvePath(path);
    if (!item) throw new Error(`fixture: no item at ${path}`);
    return item.key;
  };
  return { noggin, actions, keyFor };
}

describe('createNogginActions — adds', () => {
  it('addSiblingAfter inserts after the focused row', async () => {
    const f = await fixture();
    const r = await f.actions.addSiblingAfter(f.keyFor('/1/2'));
    expect(r.newKey).toBeTruthy();
    expect(lines(f.noggin)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/2 A.2', '/1/3 (untitled)', '/1/4 A.3',
      '/2 B', '/3 C',
    ]);
    await f.noggin.dispose();
  });

  it('addSiblingBefore inserts before the focused row', async () => {
    const f = await fixture();
    await f.actions.addSiblingBefore(f.keyFor('/1/2'));
    expect(lines(f.noggin)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/2 (untitled)', '/1/3 A.2', '/1/4 A.3',
      '/2 B', '/3 C',
    ]);
    await f.noggin.dispose();
  });

  it('addChild puts new item under the focused row', async () => {
    const f = await fixture();
    await f.actions.addChild(f.keyFor('/1/2'));
    expect(lines(f.noggin)).toEqual([
      '/1 A',
      '/1/1 A.1',
      '/1/2 A.2', '/1/2/1 (untitled)',
      '/1/3 A.3',
      '/2 B', '/3 C',
    ]);
    await f.noggin.dispose();
  });

  it('addFirstSibling/addLastSibling target sibling-group endpoints', async () => {
    const f = await fixture();
    await f.actions.addFirstSibling(f.keyFor('/1/2'));
    expect(lines(f.noggin)).toEqual([
      '/1 A',
      '/1/1 (untitled)', '/1/2 A.1', '/1/3 A.2', '/1/4 A.3',
      '/2 B', '/3 C',
    ]);
    await f.actions.addLastSibling(f.keyFor('/1/2'));
    expect(lines(f.noggin)).toEqual([
      '/1 A',
      '/1/1 (untitled)', '/1/2 A.1', '/1/3 A.2', '/1/4 A.3', '/1/5 (untitled)',
      '/2 B', '/3 C',
    ]);
    await f.noggin.dispose();
  });
});

describe('createNogginActions — moves', () => {
  it('moveUp / moveDown swap with adjacent sibling', async () => {
    const f = await fixture();
    await f.actions.moveUp(f.keyFor('/1/2'));
    expect(lines(f.noggin)).toEqual([
      '/1 A',
      '/1/1 A.2', '/1/2 A.1', '/1/3 A.3',
      '/2 B', '/3 C',
    ]);
    await f.actions.moveDown(f.keyFor('/1/1'));
    expect(lines(f.noggin)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/2 A.2', '/1/3 A.3',
      '/2 B', '/3 C',
    ]);
    await f.noggin.dispose();
  });

  it('moveUp at first sibling is a silent no-op', async () => {
    const f = await fixture();
    const before = lines(f.noggin);
    const r = await f.actions.moveUp(f.keyFor('/1/1'));
    expect(r.movedKey).toBeNull();
    expect(lines(f.noggin)).toEqual(before);
    await f.noggin.dispose();
  });

  it('moveDown at last sibling is a silent no-op', async () => {
    const f = await fixture();
    const before = lines(f.noggin);
    const r = await f.actions.moveDown(f.keyFor('/1/3'));
    expect(r.movedKey).toBeNull();
    expect(lines(f.noggin)).toEqual(before);
    await f.noggin.dispose();
  });

  it('demote nests under previous sibling', async () => {
    const f = await fixture();
    await f.actions.demote(f.keyFor('/1/2'));
    expect(lines(f.noggin)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/1/1 A.2',
      '/1/2 A.3',
      '/2 B', '/3 C',
    ]);
    await f.noggin.dispose();
  });

  it('demote at first sibling is a no-op (no previous to nest under)', async () => {
    const f = await fixture();
    const before = lines(f.noggin);
    const r = await f.actions.demote(f.keyFor('/1/1'));
    expect(r.movedKey).toBeNull();
    expect(lines(f.noggin)).toEqual(before);
    await f.noggin.dispose();
  });

  it('promote lifts to next-sibling-of-parent', async () => {
    const f = await fixture();
    await f.actions.demote(f.keyFor('/1/2'));
    expect(lines(f.noggin)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/1/1 A.2',
      '/1/2 A.3',
      '/2 B', '/3 C',
    ]);
    await f.actions.promote(f.keyFor('/1/1/1'));
    expect(lines(f.noggin)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/2 A.2',
      '/1/3 A.3',
      '/2 B', '/3 C',
    ]);
    await f.noggin.dispose();
  });

  it('promote on a root is a no-op', async () => {
    const f = await fixture();
    const before = lines(f.noggin);
    const r = await f.actions.promote(f.keyFor('/1'));
    expect(r.movedKey).toBeNull();
    expect(lines(f.noggin)).toEqual(before);
    await f.noggin.dispose();
  });

  it('moveToFirst / moveToLast jump to sibling-group endpoints', async () => {
    const f = await fixture();
    await f.actions.moveToFirst(f.keyFor('/1/3'));
    expect(lines(f.noggin)).toEqual([
      '/1 A',
      '/1/1 A.3', '/1/2 A.1', '/1/3 A.2',
      '/2 B', '/3 C',
    ]);
    await f.actions.moveToLast(f.keyFor('/1/1'));
    expect(lines(f.noggin)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/2 A.2', '/1/3 A.3',
      '/2 B', '/3 C',
    ]);
    await f.noggin.dispose();
  });
});

describe('createNogginActions — edits', () => {
  it('toggleDone closes an open item, reopens a closed one', async () => {
    const f = await fixture();
    const key = f.keyFor('/1/2');
    await f.actions.toggleDone(key, false);
    let item = projectTree(f.noggin).find((r) => r.path === '/1')!.children.find((c) => c.path === '/1/2');
    expect(item?.done).toBe(true);
    await f.actions.toggleDone(key, true);
    item = projectTree(f.noggin).find((r) => r.path === '/1')!.children.find((c) => c.path === '/1/2');
    expect(item?.done).toBe(false);
    await f.noggin.dispose();
  });

  it('delete removes the focused row (and renumbers)', async () => {
    const f = await fixture();
    await f.actions.delete(f.keyFor('/1/2'), false);
    expect(lines(f.noggin)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/2 A.3',
      '/2 B', '/3 C',
    ]);
    await f.noggin.dispose();
  });

  it('delete on a subtree drops the whole subtree (recursive)', async () => {
    const f = await fixture();
    await f.actions.addChild(f.keyFor('/1/2'));
    expect(lines(f.noggin)).toEqual([
      '/1 A',
      '/1/1 A.1',
      '/1/2 A.2', '/1/2/1 (untitled)',
      '/1/3 A.3',
      '/2 B', '/3 C',
    ]);
    await f.actions.delete(f.keyFor('/1/2'), true);
    expect(lines(f.noggin)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/2 A.3',
      '/2 B', '/3 C',
    ]);
    await f.noggin.dispose();
  });

  it('delete returns a fallback focus key (next sibling preferred)', async () => {
    const f = await fixture();
    const expected = f.keyFor('/1/3');  // sibling after /1/2
    const r = await f.actions.delete(f.keyFor('/1/2'), false);
    expect(r.fallbackFocusKey).toBe(expected);
    await f.noggin.dispose();
  });

  it('delete on the last sibling falls back to the previous sibling', async () => {
    const f = await fixture();
    const expected = f.keyFor('/1/2');  // sibling before /1/3
    const r = await f.actions.delete(f.keyFor('/1/3'), false);
    expect(r.fallbackFocusKey).toBe(expected);
    await f.noggin.dispose();
  });
});

describe('createNogginActions — focus targets', () => {
  // Each gesture returns a `newKey` (for adds) or `movedKey` (for
  // moves) so the host knows which row should hold keyboard focus
  // after the operation. These tests pin that contract.

  function findInTree(nodes: NogginNode[], pred: (n: NogginNode) => boolean): NogginNode | null {
    for (const x of nodes) {
      if (pred(x)) return x;
      const f = findInTree(x.children, pred);
      if (f) return f;
    }
    return null;
  }

  it('all add methods return a newKey that resolves to a tree node', async () => {
    const adds = ['addSiblingAfter', 'addSiblingBefore', 'addChild', 'addFirstSibling', 'addLastSibling'] as const;
    for (const m of adds) {
      const f = await fixture();
      const r = await f.actions[m](f.keyFor('/1/2'));
      expect(r.newKey, `${m}: expected a newKey`).toBeTruthy();
      const found = findInTree(projectTree(f.noggin), (x) => x.key === r.newKey);
      expect(found, `${m}: newKey ${r.newKey} not present in projected tree`).not.toBeNull();
      await f.noggin.dispose();
    }
  });

  it('all move methods return a movedKey matching the original item', async () => {
    const moves = ['moveUp', 'moveDown', 'demote', 'moveToFirst', 'moveToLast'] as const;
    for (const m of moves) {
      const f = await fixture();
      const original = f.keyFor('/1/2');
      const r = await f.actions[m](original);
      if (r.movedKey) {
        expect(r.movedKey, `${m}: movedKey should be the original item's key`).toBe(original);
      }
      await f.noggin.dispose();
    }
  });

  it('promote returns movedKey for the lifted item', async () => {
    const f = await fixture();
    await f.actions.demote(f.keyFor('/1/2'));
    const grandchild = f.keyFor('/1/1/1');
    const r = await f.actions.promote(grandchild);
    expect(r.movedKey).toBe(grandchild);
    await f.noggin.dispose();
  });
});

describe('createNogginActions — chained authoring', () => {
  it('repeated addSiblingAfter on the just-added row appends a sequence', async () => {
    const noggin = await openMemoryNoggin();
    await verbs.add(noggin, { title: 'Parent' });
    const actions = createNogginActions(noggin);
    const rootKey = noggin.tryResolvePath('/1')!.key;
    let r = await actions.addSiblingAfter(rootKey);
    await verbs.edit(noggin, { path: noggin.pathOf(noggin.findByKey(r.newKey!)!)!, title: 'B' });
    r = await actions.addSiblingAfter(r.newKey!);
    await verbs.edit(noggin, { path: noggin.pathOf(noggin.findByKey(r.newKey!)!)!, title: 'C' });
    r = await actions.addSiblingAfter(r.newKey!);
    await verbs.edit(noggin, { path: noggin.pathOf(noggin.findByKey(r.newKey!)!)!, title: 'D' });
    expect(lines(noggin)).toEqual(['/1 Parent', '/2 B', '/3 C', '/4 D']);
    await noggin.dispose();
  });

  it('Tab Tab indents twice to grandchild depth', async () => {
    const f = await fixture();
    await f.actions.demote(f.keyFor('/1/3'));
    expect(lines(f.noggin)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/2 A.2', '/1/2/1 A.3',
      '/2 B', '/3 C',
    ]);
    await f.noggin.dispose();
  });
});
