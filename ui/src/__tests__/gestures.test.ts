// Integration tests for the gesture executor — the bridge between
// "user pressed Tab" and the engine verbs. Each test runs a single
// gesture against a real in-memory noggin and asserts the resulting
// document state + result envelope (`newKey` / `movedKey`).
//
// The executor under test is imported directly from the real source
// (`../gestures`), not mirrored. Drift is therefore impossible.

import { describe, it, expect } from 'vitest';
import { executeGesture } from '../gestures';
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
 */
async function fixture(): Promise<Noggin> {
  const n = await openMemoryNoggin();
  await verbs.add(n, { title: 'A' });
  await verbs.add(n, { title: 'A.1', placement: { kind: 'into', anchor: '/1' } });
  await verbs.add(n, { title: 'A.2', placement: { kind: 'into', anchor: '/1' } });
  await verbs.add(n, { title: 'A.3', placement: { kind: 'into', anchor: '/1' } });
  await verbs.add(n, { title: 'B' });
  await verbs.add(n, { title: 'C' });
  return n;
}

describe('executeGesture — adds', () => {
  it('addSiblingAfter inserts after the focused row', async () => {
    const n = await fixture();
    const r = await executeGesture(n, projectTree(n), '/1/2', 'addSiblingAfter');
    expect(r.newKey).toBeTruthy();
    expect(lines(n)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/2 A.2', '/1/3 (untitled)', '/1/4 A.3',
      '/2 B', '/3 C',
    ]);
    await n.dispose();
  });

  it('addSiblingBefore inserts before the focused row', async () => {
    const n = await fixture();
    await executeGesture(n, projectTree(n), '/1/2', 'addSiblingBefore');
    expect(lines(n)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/2 (untitled)', '/1/3 A.2', '/1/4 A.3',
      '/2 B', '/3 C',
    ]);
    await n.dispose();
  });

  it('addChild puts new item under the focused row', async () => {
    const n = await fixture();
    await executeGesture(n, projectTree(n), '/1/2', 'addChild');
    expect(lines(n)).toEqual([
      '/1 A',
      '/1/1 A.1',
      '/1/2 A.2', '/1/2/1 (untitled)',
      '/1/3 A.3',
      '/2 B', '/3 C',
    ]);
    await n.dispose();
  });

  it('addFirstSibling/addLastSibling target sibling-group endpoints', async () => {
    const n = await fixture();
    await executeGesture(n, projectTree(n), '/1/2', 'addFirstSibling');
    expect(lines(n)).toEqual([
      '/1 A',
      '/1/1 (untitled)', '/1/2 A.1', '/1/3 A.2', '/1/4 A.3',
      '/2 B', '/3 C',
    ]);
    await executeGesture(n, projectTree(n), '/1/2', 'addLastSibling');
    expect(lines(n)).toEqual([
      '/1 A',
      '/1/1 (untitled)', '/1/2 A.1', '/1/3 A.2', '/1/4 A.3', '/1/5 (untitled)',
      '/2 B', '/3 C',
    ]);
    await n.dispose();
  });
});

describe('executeGesture — moves', () => {
  it('moveUp / moveDown swap with adjacent sibling', async () => {
    const n = await fixture();
    await executeGesture(n, projectTree(n), '/1/2', 'moveUp');
    expect(lines(n)).toEqual([
      '/1 A',
      '/1/1 A.2', '/1/2 A.1', '/1/3 A.3',
      '/2 B', '/3 C',
    ]);
    await executeGesture(n, projectTree(n), '/1/1', 'moveDown');
    expect(lines(n)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/2 A.2', '/1/3 A.3',
      '/2 B', '/3 C',
    ]);
    await n.dispose();
  });

  it('moveUp at first sibling is a silent no-op', async () => {
    const n = await fixture();
    const before = lines(n);
    const r = await executeGesture(n, projectTree(n), '/1/1', 'moveUp');
    expect(r).toEqual({});
    expect(lines(n)).toEqual(before);
    await n.dispose();
  });

  it('moveDown at last sibling is a silent no-op', async () => {
    const n = await fixture();
    const before = lines(n);
    const r = await executeGesture(n, projectTree(n), '/1/3', 'moveDown');
    expect(r).toEqual({});
    expect(lines(n)).toEqual(before);
    await n.dispose();
  });

  it('demote nests under previous sibling', async () => {
    const n = await fixture();
    await executeGesture(n, projectTree(n), '/1/2', 'demote');
    expect(lines(n)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/1/1 A.2',
      '/1/2 A.3',
      '/2 B', '/3 C',
    ]);
    await n.dispose();
  });

  it('demote at first sibling is a no-op (no previous to nest under)', async () => {
    const n = await fixture();
    const before = lines(n);
    const r = await executeGesture(n, projectTree(n), '/1/1', 'demote');
    expect(r).toEqual({});
    expect(lines(n)).toEqual(before);
    await n.dispose();
  });

  it('promote lifts to next-sibling-of-parent', async () => {
    const n = await fixture();
    await executeGesture(n, projectTree(n), '/1/2', 'demote');
    expect(lines(n)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/1/1 A.2',
      '/1/2 A.3',
      '/2 B', '/3 C',
    ]);
    await executeGesture(n, projectTree(n), '/1/1/1', 'promote');
    expect(lines(n)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/2 A.2',
      '/1/3 A.3',
      '/2 B', '/3 C',
    ]);
    await n.dispose();
  });

  it('promote on a root is a no-op', async () => {
    const n = await fixture();
    const before = lines(n);
    const r = await executeGesture(n, projectTree(n), '/1', 'promote');
    expect(r).toEqual({});
    expect(lines(n)).toEqual(before);
    await n.dispose();
  });

  it('moveToFirst / moveToLast jump to sibling-group endpoints', async () => {
    const n = await fixture();
    await executeGesture(n, projectTree(n), '/1/3', 'moveToFirst');
    expect(lines(n)).toEqual([
      '/1 A',
      '/1/1 A.3', '/1/2 A.1', '/1/3 A.2',
      '/2 B', '/3 C',
    ]);
    await executeGesture(n, projectTree(n), '/1/1', 'moveToLast');
    expect(lines(n)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/2 A.2', '/1/3 A.3',
      '/2 B', '/3 C',
    ]);
    await n.dispose();
  });
});

describe('executeGesture — edits', () => {
  it('toggleDone closes an open item, reopens a closed one', async () => {
    const n = await fixture();
    await executeGesture(n, projectTree(n), '/1/2', 'toggleDone');
    let item = projectTree(n).find((r) => r.path === '/1')!.children.find((c) => c.path === '/1/2');
    expect(item?.done).toBe(true);
    await executeGesture(n, projectTree(n), '/1/2', 'toggleDone');
    item = projectTree(n).find((r) => r.path === '/1')!.children.find((c) => c.path === '/1/2');
    expect(item?.done).toBe(false);
    await n.dispose();
  });

  it('delete removes the focused row (and renumbers)', async () => {
    const n = await fixture();
    await executeGesture(n, projectTree(n), '/1/2', 'delete');
    expect(lines(n)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/2 A.3',
      '/2 B', '/3 C',
    ]);
    await n.dispose();
  });

  it('delete on a subtree drops the whole subtree (recursive)', async () => {
    const n = await fixture();
    await executeGesture(n, projectTree(n), '/1/2', 'addChild');
    expect(lines(n)).toEqual([
      '/1 A',
      '/1/1 A.1',
      '/1/2 A.2', '/1/2/1 (untitled)',
      '/1/3 A.3',
      '/2 B', '/3 C',
    ]);
    await executeGesture(n, projectTree(n), '/1/2', 'delete');
    expect(lines(n)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/2 A.3',
      '/2 B', '/3 C',
    ]);
    await n.dispose();
  });
});

describe('executeGesture — focus targets', () => {
  // The executor returns a `newKey` (for adds) or `movedKey` (for
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

  it('all add gestures return a newKey that resolves to a tree node', async () => {
    const adds = ['addSiblingAfter', 'addSiblingBefore', 'addChild', 'addFirstSibling', 'addLastSibling'] as const;
    for (const gesture of adds) {
      const n = await fixture();
      const r = await executeGesture(n, projectTree(n), '/1/2', gesture);
      expect(r.newKey, `${gesture}: expected a newKey`).toBeTruthy();
      const found = findInTree(projectTree(n), (x) => x.key === r.newKey);
      expect(found, `${gesture}: newKey ${r.newKey} not present in projected tree`).not.toBeNull();
      await n.dispose();
    }
  });

  it('all move gestures return a movedKey matching the original item', async () => {
    const moves = ['moveUp', 'moveDown', 'demote', 'moveToFirst', 'moveToLast'] as const;
    for (const gesture of moves) {
      const n = await fixture();
      const original = findInTree(projectTree(n), (x) => x.path === '/1/2');
      const r = await executeGesture(n, projectTree(n), '/1/2', gesture);
      if (r.movedKey) {
        expect(r.movedKey, `${gesture}: movedKey should be the original item's key`).toBe(original!.key);
      }
      await n.dispose();
    }
  });

  it('promote returns movedKey for the lifted item', async () => {
    const n = await fixture();
    await executeGesture(n, projectTree(n), '/1/2', 'demote');
    const grandchild = findInTree(projectTree(n), (x) => x.path === '/1/1/1');
    const r = await executeGesture(n, projectTree(n), '/1/1/1', 'promote');
    expect(r.movedKey).toBe(grandchild!.key);
    await n.dispose();
  });
});

describe('executeGesture — chained authoring', () => {
  it('repeated addSiblingAfter on the just-added row appends a sequence', async () => {
    const n = await openMemoryNoggin();
    await verbs.add(n, { title: 'Parent' });
    let r = await executeGesture(n, projectTree(n), '/1', 'addSiblingAfter');
    let newPath = findInTreeLocal(projectTree(n), (x) => x.key === r.newKey)!.path;
    await verbs.edit(n, { path: newPath, title: 'B' });
    r = await executeGesture(n, projectTree(n), newPath, 'addSiblingAfter');
    newPath = findInTreeLocal(projectTree(n), (x) => x.key === r.newKey)!.path;
    await verbs.edit(n, { path: newPath, title: 'C' });
    r = await executeGesture(n, projectTree(n), newPath, 'addSiblingAfter');
    newPath = findInTreeLocal(projectTree(n), (x) => x.key === r.newKey)!.path;
    await verbs.edit(n, { path: newPath, title: 'D' });
    expect(lines(n)).toEqual(['/1 Parent', '/2 B', '/3 C', '/4 D']);
    await n.dispose();
  });

  it('Tab Tab indents twice to grandchild depth', async () => {
    const n = await fixture();
    await executeGesture(n, projectTree(n), '/1/3', 'demote');
    expect(lines(n)).toEqual([
      '/1 A',
      '/1/1 A.1', '/1/2 A.2', '/1/2/1 A.3',
      '/2 B', '/3 C',
    ]);
    await n.dispose();
  });

  function findInTreeLocal(nodes: NogginNode[], pred: (n: NogginNode) => boolean): NogginNode | null {
    for (const x of nodes) {
      if (pred(x)) return x;
      const f = findInTreeLocal(x.children, pred);
      if (f) return f;
    }
    return null;
  }
});
