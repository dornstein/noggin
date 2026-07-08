// NogginActions — the verb-dispatch surface UI components consume.
//
// One method per logical user intent. Components and hosts invoke
// the same methods regardless of how the user expressed the intent
// (click, menu pick, keyboard shortcut, drag-drop). The actions
// surface translates intents into one or more engine verb calls and
// returns a typed result describing what happened.
//
// Keys, not paths:
//   Paths shift under structural changes; keys don't. Every method
//   takes a `NogginItemKey` and resolves to a path internally for
//   the engine call. Drag-drop, menu picks, the keyboard handler —
//   all hand the action a key and trust it to survive intermediate
//   re-numbering.
//
// Pure dispatch — no UI state, no React hooks. Components own
// selection / rename-mode state separately as controlled props.
//
// The factory below builds a default `NogginActions` bound to a
// `Noggin`. Hosts decorate the returned object to add pre-flight
// confirmation or wrap individual methods; the `middleware` option
// covers the common error-toast / busy-spinner case in one place.

import type { ItemKey, ItemPath, Noggin } from '@noggin/engine';
import { projectTree, findByPath } from './treeOps.js';
import type { NogginNode } from './types.js';

/**
 * @public
 * Stable identifier for a noggin item. Re-exported from the engine
 * so UI consumers have one consistent name in this layer.
 */
export type NogginItemKey = ItemKey;

// ── Result envelopes ────────────────────────────────────────────────

/** @public Outcome of an `add*` action. `newKey` is null when the
 *  action was a no-op (e.g. add-first against an item that has no
 *  siblings to anchor against; the impl falls back to addChild in
 *  that case but documents the contract conservatively). */
export interface AddResult { newKey: NogginItemKey | null }

/** @public Outcome of a `move*` action. `movedKey` is null when the
 *  move was a no-op (e.g. moveUp on the first sibling). */
export interface MoveResult { movedKey: NogginItemKey | null }

/** @public Outcome of `delete`. `fallbackFocusKey` is the row a host
 *  should focus after the deletion lands — next sibling, then prev,
 *  then parent, then null when the tree is empty. Computed against
 *  the tree state at action time. */
export interface DeleteResult {
  deletedKey: NogginItemKey;
  fallbackFocusKey: NogginItemKey | null;
}

/** @public Outcome of `toggleDone`. */
export interface ToggleDoneResult { key: NogginItemKey; nowDone: boolean }

/** @public Outcome of `rename`. */
export interface RenameResult { key: NogginItemKey; title: string }

/** @public Outcome of `activate`. */
export interface ActivateResult { key: NogginItemKey }

/** @public Outcome of `appendNote`. */
export interface AppendNoteResult { key: NogginItemKey }

// ── Actions interface ───────────────────────────────────────────────

/**
 * @public
 * The verb-dispatch surface every UI component consumes. One method
 * per logical user intent — invoke from a click, a menu pick, a
 * keyboard shortcut, anywhere.
 *
 * Each method returns a typed result so hosts can drive follow-on
 * UI state (rename mode for new rows, focus restoration after
 * delete, etc.) without needing a separate callback channel.
 *
 * Engine-side these turn into one or more verb calls. That
 * translation is the only thing this object does. It holds no
 * React, no UI state, no event listeners.
 */
export interface NogginActions {
  /**
   * The bound noggin. Components and helpers (`buildTreeMenuEntries`)
   * reach through to it for read-only state (current active key,
   * sibling indices, etc.). Read-only by convention \u2014 always mutate
   * via the action methods below so middleware fires uniformly.
   */
  readonly noggin: Noggin;

  // ── Item-local intents ────────────────────────────────────────────

  /** Set an item's title. */
  rename(key: NogginItemKey, newTitle: string): Promise<RenameResult>;

  /** Flip an item's done state. `currentlyDone` is the state at
   *  invocation time so the impl picks the correct verb (done vs
   *  edit-open). */
  toggleDone(key: NogginItemKey, currentlyDone: boolean): Promise<ToggleDoneResult>;

  /** Remove an item. `hasChildren` selects the recursive flag.
   *  The result includes a `fallbackFocusKey` for the host to
   *  focus after the deletion lands. */
  delete(key: NogginItemKey, hasChildren: boolean): Promise<DeleteResult>;

  /** Append a timestamped note. */
  appendNote(key: NogginItemKey, markdown: string): Promise<AppendNoteResult>;

  /** Make this item the engine's active item. */
  activate(key: NogginItemKey): Promise<ActivateResult>;

  // ── Structural intents (anchor computed from tree state) ─────────

  /** Create a new sibling immediately after this item. */
  addSiblingAfter(key: NogginItemKey): Promise<AddResult>;

  /** Create a new sibling immediately before this item. */
  addSiblingBefore(key: NogginItemKey): Promise<AddResult>;

  /** Create a new child of this item (last position). */
  addChild(key: NogginItemKey): Promise<AddResult>;

  /** Create a new sibling at the start of this item's sibling list. */
  addFirstSibling(key: NogginItemKey): Promise<AddResult>;

  /** Create a new sibling at the end of this item's sibling list. */
  addLastSibling(key: NogginItemKey): Promise<AddResult>;

  /** Swap this item with its previous sibling. */
  moveUp(key: NogginItemKey): Promise<MoveResult>;

  /** Swap this item with its next sibling. */
  moveDown(key: NogginItemKey): Promise<MoveResult>;

  /** Move this item to the first position in its sibling list. */
  moveToFirst(key: NogginItemKey): Promise<MoveResult>;

  /** Move this item to the last position in its sibling list. */
  moveToLast(key: NogginItemKey): Promise<MoveResult>;

  /** Nest this item as the last child of its previous sibling. */
  demote(key: NogginItemKey): Promise<MoveResult>;

  /** Pop this item out to its grandparent's level (immediately after
   *  its current parent). */
  promote(key: NogginItemKey): Promise<MoveResult>;

  // ── Explicit placement ───────────────────────────────────────────

  /** Move an item to an explicit anchor. Used by drag-drop, batch
   *  reorder, programmatic moves — anything that already knows
   *  exactly where the item should go. */
  move(
    key: NogginItemKey,
    placement: { kind: 'before' | 'after' | 'into'; anchor: NogginItemKey },
  ): Promise<MoveResult>;
}

// ── Factory ────────────────────────────────────────────────────────

/** @public Optional knobs for {@link createNogginActions}. */
export interface CreateNogginActionsOptions {
  /**
   * Wraps every action dispatch. Hosts use this for cross-cutting
   * concerns — error toasts, busy indicators, telemetry. Errors
   * thrown inside `fn` should be re-thrown unless the middleware
   * handles them (e.g. converts to a UI message and resolves to a
   * fallback value).
   */
  middleware?: <T>(fn: () => Promise<T>) => Promise<T>;
}

/**
 * @public
 * Default factory: bind every action to a {@link Noggin}. Hosts call
 * this once per open noggin and pass the result into
 * `<NogginTree actions={…}>` and `<NogginDetails actions={…}>`.
 *
 * The bound noggin is accessible via the returned object — components
 * and helpers (`buildTreeMenuEntries`) reach through to it for
 * read-only state (current active key, sibling indices, etc.).
 */
export function createNogginActions(
  noggin: Noggin,
  opts: CreateNogginActionsOptions = {},
): NogginActions {
  const wrap = opts.middleware ?? (<T>(fn: () => Promise<T>) => fn());

  // Read-only gate. When the underlying noggin's provider declared
  // itself read-only (`http://`, `vscode-todo://`, …), every mutating
  // action short-circuits to a resolved-null result envelope BEFORE
  // touching the noggin. Attempting the verb would only surface a
  // `read-only` `NogginError` and — with an optimistic client like
  // `RemoteNoggin` — trigger a predict → RPC → reject → rebuild
  // cycle that can whipsaw the UI into a paint loop.
  //
  // Hosts SHOULD ALSO gate mutation affordances (menus, drag
  // targets) on `noggin.readOnly`; this guard is the safety net for
  // keyboard gestures and anything the host missed.
  const isReadOnly = noggin.readOnly === true;
  const skip = <T,>(fallback: T): Promise<T> => Promise.resolve(fallback);

  // ── Resolution helpers ───────────────────────────────────────────
  // Every action takes a key. We project the tree at call time to
  // resolve keys → paths and to compute sibling neighbours for the
  // structural actions. The projection is O(N); for typical noggin
  // sizes it's cheap. RemoteNoggin's local mirror serves accessor
  // reads synchronously so this is safe inside optimistic-apply
  // sequences.

  const NEW_ITEM_TITLE = '';

  function pathOf(key: NogginItemKey): ItemPath | null {
    const item = noggin.findByKey(key);
    if (!item) return null;
    return noggin.pathOf(item);
  }

  function nodeOf(key: NogginItemKey): { node: NogginNode; nodes: NogginNode[] } | null {
    const nodes = projectTree(noggin);
    const item = noggin.findByKey(key);
    if (!item) return null;
    const path = noggin.pathOf(item);
    if (!path) return null;
    const node = findByPath(nodes, path);
    if (!node) return null;
    return { node, nodes };
  }

  function siblingsOf(nodes: readonly NogginNode[], path: string): {
    siblings: readonly NogginNode[];
    parent: NogginNode | null;
    idx: number;
  } {
    const parent = findParent(nodes, path);
    const siblings = parent?.children ?? nodes;
    const idx = siblings.findIndex((s) => s.path === path);
    return { siblings, parent, idx };
  }

  // ── Method implementations ───────────────────────────────────────

  const actions: NogginActions = {

    noggin,

    rename: (key, newTitle) => isReadOnly ? skip({ key, title: newTitle }) : wrap(async () => {
      const path = pathOf(key);
      if (!path) return { key, title: newTitle };
      await noggin.edit({ path, title: newTitle });
      return { key, title: newTitle };
    }),

    toggleDone: (key, currentlyDone) => isReadOnly ? skip({ key, nowDone: currentlyDone }) : wrap(async () => {
      const path = pathOf(key);
      if (!path) return { key, nowDone: !currentlyDone };
      if (currentlyDone) await noggin.edit({ path, done: false });
      else await noggin.done({ path });
      return { key, nowDone: !currentlyDone };
    }),

    delete: (key, hasChildren) => isReadOnly ? skip({ deletedKey: key, fallbackFocusKey: null }) : wrap(async () => {
      const resolved = nodeOf(key);
      let fallbackFocusKey: NogginItemKey | null = null;
      if (resolved) {
        const { nodes, node } = resolved;
        const { siblings, parent, idx } = siblingsOf(nodes, node.path);
        const fallback = siblings[idx + 1] ?? siblings[idx - 1] ?? parent ?? null;
        fallbackFocusKey = fallback?.key ?? null;
        await noggin.delete({ path: node.path, recursive: hasChildren });
      }
      return { deletedKey: key, fallbackFocusKey };
    }),

    appendNote: (key, text) => isReadOnly ? skip({ key }) : wrap(async () => {
      const path = pathOf(key);
      if (!path) return { key };
      await noggin.note({ path, text });
      return { key };
    }),

    activate: (key) => isReadOnly ? skip({ key }) : wrap(async () => {
      const path = pathOf(key);
      if (!path) return { key };
      await noggin.goto({ path });
      return { key };
    }),

    addSiblingAfter: (key) => isReadOnly ? skip({ newKey: null }) : wrap(async () => {
      const path = pathOf(key);
      if (!path) return { newKey: null };
      const r = await noggin.add({ title: NEW_ITEM_TITLE, placement: { kind: 'after', anchor: path } });
      return { newKey: r.targetKey };
    }),

    addSiblingBefore: (key) => isReadOnly ? skip({ newKey: null }) : wrap(async () => {
      const path = pathOf(key);
      if (!path) return { newKey: null };
      const r = await noggin.add({ title: NEW_ITEM_TITLE, placement: { kind: 'before', anchor: path } });
      return { newKey: r.targetKey };
    }),

    addChild: (key) => isReadOnly ? skip({ newKey: null }) : wrap(async () => {
      const path = pathOf(key);
      if (!path) return { newKey: null };
      const r = await noggin.add({ title: NEW_ITEM_TITLE, placement: { kind: 'into', anchor: path } });
      return { newKey: r.targetKey };
    }),

    addFirstSibling: (key) => isReadOnly ? skip({ newKey: null }) : wrap(async () => {
      const resolved = nodeOf(key);
      if (!resolved) return { newKey: null };
      const { nodes, node } = resolved;
      const { siblings } = siblingsOf(nodes, node.path);
      const first = siblings[0];
      if (!first) return { newKey: null };
      const r = await noggin.add({ title: NEW_ITEM_TITLE, placement: { kind: 'before', anchor: first.path } });
      return { newKey: r.targetKey };
    }),

    addLastSibling: (key) => isReadOnly ? skip({ newKey: null }) : wrap(async () => {
      const resolved = nodeOf(key);
      if (!resolved) return { newKey: null };
      const { nodes, node } = resolved;
      const { siblings } = siblingsOf(nodes, node.path);
      const last = siblings[siblings.length - 1];
      if (!last) return { newKey: null };
      const r = await noggin.add({ title: NEW_ITEM_TITLE, placement: { kind: 'after', anchor: last.path } });
      return { newKey: r.targetKey };
    }),

    moveUp: (key) => isReadOnly ? skip({ movedKey: null }) : wrap(async () => {
      const resolved = nodeOf(key);
      if (!resolved) return { movedKey: null };
      const { nodes, node } = resolved;
      const { siblings, idx } = siblingsOf(nodes, node.path);
      if (idx <= 0) return { movedKey: null };
      const prev = siblings[idx - 1]!;
      await noggin.move({ path: node.path, placement: { kind: 'before', anchor: prev.path } });
      return { movedKey: key };
    }),

    moveDown: (key) => isReadOnly ? skip({ movedKey: null }) : wrap(async () => {
      const resolved = nodeOf(key);
      if (!resolved) return { movedKey: null };
      const { nodes, node } = resolved;
      const { siblings, idx } = siblingsOf(nodes, node.path);
      if (idx < 0 || idx >= siblings.length - 1) return { movedKey: null };
      const next = siblings[idx + 1]!;
      await noggin.move({ path: node.path, placement: { kind: 'after', anchor: next.path } });
      return { movedKey: key };
    }),

    moveToFirst: (key) => isReadOnly ? skip({ movedKey: null }) : wrap(async () => {
      const resolved = nodeOf(key);
      if (!resolved) return { movedKey: null };
      const { nodes, node } = resolved;
      const { siblings, idx } = siblingsOf(nodes, node.path);
      if (idx <= 0) return { movedKey: null };
      const first = siblings[0]!;
      await noggin.move({ path: node.path, placement: { kind: 'before', anchor: first.path } });
      return { movedKey: key };
    }),

    moveToLast: (key) => isReadOnly ? skip({ movedKey: null }) : wrap(async () => {
      const resolved = nodeOf(key);
      if (!resolved) return { movedKey: null };
      const { nodes, node } = resolved;
      const { siblings, idx } = siblingsOf(nodes, node.path);
      if (idx < 0 || idx >= siblings.length - 1) return { movedKey: null };
      const last = siblings[siblings.length - 1]!;
      await noggin.move({ path: node.path, placement: { kind: 'after', anchor: last.path } });
      return { movedKey: key };
    }),

    demote: (key) => isReadOnly ? skip({ movedKey: null }) : wrap(async () => {
      // Become last child of previous sibling.
      const resolved = nodeOf(key);
      if (!resolved) return { movedKey: null };
      const { nodes, node } = resolved;
      const { siblings, idx } = siblingsOf(nodes, node.path);
      if (idx <= 0) return { movedKey: null };
      const prev = siblings[idx - 1]!;
      await noggin.move({ path: node.path, placement: { kind: 'into', anchor: prev.path } });
      return { movedKey: key };
    }),

    promote: (key) => isReadOnly ? skip({ movedKey: null }) : wrap(async () => {
      // Become next sibling of parent.
      const resolved = nodeOf(key);
      if (!resolved) return { movedKey: null };
      const { nodes, node } = resolved;
      const parent = findParent(nodes, node.path);
      if (!parent) return { movedKey: null };
      await noggin.move({ path: node.path, placement: { kind: 'after', anchor: parent.path } });
      return { movedKey: key };
    }),

    move: (key, placement) => wrap(async () => {
      const fromPath = pathOf(key);
      const anchorPath = pathOf(placement.anchor);
      if (!fromPath || !anchorPath) return { movedKey: null };
      await noggin.move({ path: fromPath, placement: { kind: placement.kind, anchor: anchorPath } });
      return { movedKey: key };
    }),
  };

  return actions;
}

// ── Local tree helpers ─────────────────────────────────────────────

/** Find the parent node of the node at `path`, or null for roots. */
function findParent(
  nodes: readonly NogginNode[],
  childPath: string,
  parent: NogginNode | null = null,
): NogginNode | null {
  for (const n of nodes) {
    if (n.path === childPath) return parent;
    const f = findParent(n.children, childPath, n);
    if (f) return f;
  }
  return null;
}
