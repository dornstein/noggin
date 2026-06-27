// Gesture-to-verb mapping. Decodes a `TreeGesture` against a focused
// row path + a live `Noggin` into the appropriate verb call.
//
// Pure with respect to React — no hooks, no state. The host owns
// focus/rename bookkeeping; this module just runs the verb and returns
// what it would do next (e.g. "newly-created item's key", "moved
// item's key" so the host can re-focus it after the refresh lands).
//
// Lives in @noggin/ui because gestures are a UI concept and we want
// the same dispatcher (and its tests) shared across every host that
// renders the tree.

import type { Noggin } from '@noggin/engine';
import type { NogginVerbs } from './remote/verbs.ts';
import { bindEngineVerbs } from './remote/verbs.ts';
import type { NogginNode, TreeGesture } from './types';
import {
  findByPath,
  parentOf,
  prevSibling,
  nextSibling,
  firstSibling,
  lastSibling,
} from './treeOps';

export interface GestureResult {
  /** Key of a newly-created item (add gestures only). Host uses this to
   *  start inline-rename on the new row once it appears in the tree. */
  newKey?: string;
  /** Key of an item that just moved. Host uses this to keep selection
   *  pinned through the path change. */
  movedKey?: string;
}

const NEW_ITEM_TITLE = '';

/**
 * Run the appropriate verb for `gesture` against `path`. The `nodes`
 * forest is the same one rendered in the tree — we use it to resolve
 * relative anchors (prev sibling, parent, etc.) without round-tripping
 * through the engine's path resolver.
 *
 * `noggin` may be an engine `Noggin` (in-process callers) or any
 * `NogginVerbs` implementation (e.g. a `RemoteNoggin`). Engine nogins
 * are adapted transparently.
 *
 * Edge-of-tree gestures (e.g. promote on a root, move-up on the first
 * sibling) are silent no-ops — they return `{}`.
 */
export async function executeGesture(
  noggin: NogginVerbs | Noggin,
  nodes: readonly NogginNode[],
  path: string,
  gesture: TreeGesture,
): Promise<GestureResult> {
  const verbs = isVerbs(noggin) ? noggin : bindEngineVerbs(noggin);
  const node = findByPath(nodes, path);
  if (!node) return {};
  const hasChildren = node.children.length > 0;

  switch (gesture) {
    case 'addSiblingAfter': {
      const r = await verbs.add({ title: NEW_ITEM_TITLE, placement: { kind: 'after', anchor: path } });
      return { newKey: r.targetKey };
    }
    case 'addSiblingBefore': {
      const r = await verbs.add({ title: NEW_ITEM_TITLE, placement: { kind: 'before', anchor: path } });
      return { newKey: r.targetKey };
    }
    case 'addChild': {
      const r = await verbs.add({ title: NEW_ITEM_TITLE, placement: { kind: 'into', anchor: path } });
      return { newKey: r.targetKey };
    }
    case 'addFirstSibling': {
      const first = firstSibling(nodes, path);
      if (!first) return {};
      const r = await verbs.add({ title: NEW_ITEM_TITLE, placement: { kind: 'before', anchor: first.path } });
      return { newKey: r.targetKey };
    }
    case 'addLastSibling': {
      const last = lastSibling(nodes, path);
      if (!last) return {};
      const r = await verbs.add({ title: NEW_ITEM_TITLE, placement: { kind: 'after', anchor: last.path } });
      return { newKey: r.targetKey };
    }

    case 'moveUp': {
      const prev = prevSibling(nodes, path);
      if (!prev) return {};
      await verbs.move({ path, placement: { kind: 'before', anchor: prev.path } });
      return { movedKey: node.key };
    }
    case 'moveDown': {
      const next = nextSibling(nodes, path);
      if (!next) return {};
      await verbs.move({ path, placement: { kind: 'after', anchor: next.path } });
      return { movedKey: node.key };
    }
    case 'demote': {
      // Become last child of previous sibling.
      const prev = prevSibling(nodes, path);
      if (!prev) return {};
      await verbs.move({ path, placement: { kind: 'into', anchor: prev.path } });
      return { movedKey: node.key };
    }
    case 'promote': {
      // Become next sibling of parent.
      const parent = parentOf(nodes, path);
      if (!parent) return {};
      await verbs.move({ path, placement: { kind: 'after', anchor: parent.path } });
      return { movedKey: node.key };
    }
    case 'moveToFirst': {
      const first = firstSibling(nodes, path);
      if (!first || first.path === path) return {};
      await verbs.move({ path, placement: { kind: 'before', anchor: first.path } });
      return { movedKey: node.key };
    }
    case 'moveToLast': {
      const last = lastSibling(nodes, path);
      if (!last || last.path === path) return {};
      await verbs.move({ path, placement: { kind: 'after', anchor: last.path } });
      return { movedKey: node.key };
    }

    case 'toggleDone':
      if (node.done) await verbs.edit({ path, done: false });
      else await verbs.done({ path });
      return {};

    case 'delete':
      await verbs.delete({ path, recursive: hasChildren });
      return {};

    case 'rename':
      // Pure UI signal — host opens the inline-rename input.
      return {};
  }
}

/** Cheap structural test: anything with a callable `push` is a NogginVerbs. */
function isVerbs(noggin: NogginVerbs | Noggin): noggin is NogginVerbs {
  // Engine `Noggin` doesn't expose verb methods on its surface — verbs
  // are external functions (`engineVerbs.push(noggin, opts)`). Anything
  // that DOES expose `.push` as a function is a NogginVerbs implementation.
  return typeof (noggin as { push?: unknown }).push === 'function';
}
