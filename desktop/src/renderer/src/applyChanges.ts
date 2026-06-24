// Incremental tree patcher.
//
// Given a NogginNode forest and a list of ItemChanges, produces a new
// forest with the changes applied in-place (well: with structural
// sharing where possible — we don't reuse arrays that were touched).
//
// The contract matches what the engine emits via onDidChange. A
// development-mode parity check in `noggin.ts` verifies the result
// matches a full re-projection of the live document so we catch
// drift between patcher and engine.

import type { ItemChange } from '../../../skills/noggin/noggin-api.mjs';
import type { NogginNode } from '@noggin/ui';

/**
 * Apply a list of `ItemChange`s to a NogginNode forest. Returns a new
 * top-level array; subtrees are reused where untouched, replaced where
 * changed. Paths are renumbered for any sibling list affected by an
 * insertion, deletion, or move.
 *
 * `changesByKey` for `added` events also needs the new item's title /
 * done / noteCount, which the engine knows but doesn't include in the
 * change record (we kept the vocabulary small). Caller supplies a
 * `lookup(key)` to fetch the fresh node data from the live noggin.
 */
export interface PatchContext {
  /** Look up an item's current data by key. Used to materialize newly-added items. */
  lookup(key: string): { title: string; done: boolean; noteCount: number } | null;
}

export function applyChanges(
  nodes: readonly NogginNode[],
  changes: readonly ItemChange[],
  ctx: PatchContext,
): NogginNode[] {
  // Work on a mutable shallow copy. Subtree refs are reused until
  // we touch them.
  let forest = nodes.map(clone);

  for (const ch of changes) {
    switch (ch.kind) {
      case 'added': {
        const data = ctx.lookup(ch.key);
        if (!data) break; // shouldn't happen; bail rather than fabricate
        const newNode: NogginNode = {
          key: ch.key,
          path: '', // will be set by renumber below
          title: data.title,
          done: data.done,
          noteCount: data.noteCount,
          children: [],
        };
        forest = insertAt(forest, ch.parentKey, ch.position, newNode);
        break;
      }
      case 'removed': {
        forest = removeByKey(forest, ch.key);
        break;
      }
      case 'moved': {
        // Pluck and re-insert. Preserve children + metadata.
        const plucked = pluck(forest, ch.key);
        if (!plucked) break;
        forest = plucked.forest;
        forest = insertAt(forest, ch.to.parentKey, ch.to.position, plucked.node);
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
      case 'activeChanged':
        // Active pointer isn't part of the forest shape; the caller
        // tracks it separately.
        break;
    }
  }

  renumberAll(forest, '');
  return forest;
}

// ── Tree mutators (return a new forest with structural sharing) ────────

function clone(n: NogginNode): NogginNode {
  // Shallow clone is sufficient — we only mutate path strings via
  // renumberAll, which produces new objects via spread.
  return { ...n, children: n.children.map(clone) };
}

function insertAt(
  forest: NogginNode[],
  parentKey: string | null,
  position: number,
  newNode: NogginNode,
): NogginNode[] {
  if (parentKey === null) {
    const next = forest.slice();
    const idx = clamp(position, 0, next.length);
    next.splice(idx, 0, newNode);
    return next;
  }
  return mapForest(forest, (n) => {
    if (n.key !== parentKey) return n;
    const kids = n.children.slice();
    const idx = clamp(position, 0, kids.length);
    kids.splice(idx, 0, newNode);
    return { ...n, children: kids };
  });
}

function removeByKey(forest: NogginNode[], key: string): NogginNode[] {
  let out = forest.filter((n) => n.key !== key);
  if (out.length !== forest.length) return out;
  return mapForest(forest, (n) => {
    const kept = n.children.filter((c) => c.key !== key);
    if (kept.length === n.children.length) return n;
    return { ...n, children: kept };
  });
}

function pluck(forest: NogginNode[], key: string): { node: NogginNode; forest: NogginNode[] } | null {
  const topIdx = forest.findIndex((n) => n.key === key);
  if (topIdx >= 0) {
    const node = forest[topIdx];
    const next = forest.slice();
    next.splice(topIdx, 1);
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

function updateByKey(
  forest: NogginNode[],
  key: string,
  patch: (n: NogginNode) => NogginNode,
): NogginNode[] {
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

function mapForest(
  forest: NogginNode[],
  fn: (n: NogginNode) => NogginNode,
): NogginNode[] {
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

/**
 * Recompute `.path` for every node from scratch given the forest
 * structure. Cheap (O(N)); paths are short strings.
 *
 * We always do this after a structural change rather than try to be
 * clever about which sibling lists need renumbering — it's already
 * linear and the constant factor is tiny.
 */
function renumberAll(forest: NogginNode[], prefix: string): void {
  for (let i = 0; i < forest.length; i++) {
    const path = `${prefix}/${i + 1}`;
    const node = forest[i];
    node.path = path;
    renumberAll(node.children, path);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
