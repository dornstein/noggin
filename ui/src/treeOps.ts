// Pure path / sibling helpers over a NogginNode forest. Used by the
// tree keymap dispatcher and by hosts that need to derive placement
// targets from a focused row.

import type { Noggin } from '@noggin/engine';
import type { NogginNode } from './types.js';

/**
 * @public
 * Project a noggin's flat `items` accessor into the nested
 * `NogginNode` forest the tree renders. The forest mirrors document
 * order; paths (`/1/2/3`) are computed from sibling indices.
 *
 * Pure — runs in O(N). Hosts (and the actions layer) call this on
 * every change event; for very large nogins consider memoising or
 * applying incremental patches via `applyChanges` (see desktop).
 */
export function projectTree(noggin: Noggin): NogginNode[] {
  const items = noggin.items;
  const byParent = new Map<string | null, typeof items[number][]>();
  for (const it of items) {
    const key = it.parentKey ?? null;
    const list = byParent.get(key);
    if (list) list.push(it);
    else byParent.set(key, [it]);
  }
  function build(parentKey: string | null, prefix: string): NogginNode[] {
    const kids = byParent.get(parentKey) ?? [];
    return kids.map((item, i) => {
      const path = `${prefix}/${i + 1}`;
      return {
        key: item.key,
        path,
        title: item.title,
        done: item.done,
        noteCount: Array.isArray(item.notes) ? item.notes.length : 0,
        children: build(item.key, path),
      };
    });
  }
  return build(null, '');
}

/** Find a node by its `/N/M/...` path. */
export function findByPath(nodes: readonly NogginNode[], path: string): NogginNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    const f = findByPath(n.children, path);
    if (f) return f;
  }
  return null;
}

/** The sibling list that contains `path`, including `path` itself. */
export function siblingsOf(nodes: readonly NogginNode[], path: string): readonly NogginNode[] {
  const segments = path.split('/').filter(Boolean).map((s) => Number(s) - 1);
  if (segments.length === 0) return [];
  let level: readonly NogginNode[] = nodes;
  for (let i = 0; i < segments.length - 1; i++) {
    const at = level[segments[i]];
    if (!at) return [];
    level = at.children;
  }
  return level;
}

/** Parent of `path`, or null if `path` is a root. */
export function parentOf(nodes: readonly NogginNode[], path: string): NogginNode | null {
  const segments = path.split('/').filter(Boolean);
  if (segments.length <= 1) return null;
  const parentPath = '/' + segments.slice(0, -1).join('/');
  return findByPath(nodes, parentPath);
}

/** Previous sibling, or null if at start. */
export function prevSibling(nodes: readonly NogginNode[], path: string): NogginNode | null {
  const sibs = siblingsOf(nodes, path);
  const idx = sibs.findIndex((s) => s.path === path);
  return idx > 0 ? sibs[idx - 1] : null;
}

/** Next sibling, or null if at end. */
export function nextSibling(nodes: readonly NogginNode[], path: string): NogginNode | null {
  const sibs = siblingsOf(nodes, path);
  const idx = sibs.findIndex((s) => s.path === path);
  return idx >= 0 && idx < sibs.length - 1 ? sibs[idx + 1] : null;
}

/** First sibling in the group containing `path`, or null. */
export function firstSibling(nodes: readonly NogginNode[], path: string): NogginNode | null {
  const sibs = siblingsOf(nodes, path);
  return sibs[0] ?? null;
}

/** Last sibling in the group containing `path`, or null. */
export function lastSibling(nodes: readonly NogginNode[], path: string): NogginNode | null {
  const sibs = siblingsOf(nodes, path);
  return sibs[sibs.length - 1] ?? null;
}
