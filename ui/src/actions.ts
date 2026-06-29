// Tree actions — the single verb-dispatch surface that NogginTree
// and NogginDetails consume.
//
// Both components used to take a fanout of per-verb callbacks
// (`onToggleDone`, `onActivate`, `onMove`, `onAppendNote`,
// `onRetitle`, `onGesture`, ...) which every host then wired to the
// same set of noggin verb calls. That meant ~30 lines of identical
// boilerplate in every host, plus a fragile contract: forget one
// callback and a UI control silently no-ops.
//
// `NogginTreeActions` collapses the lot into one object. The default
// factory `createTreeActions(noggin)` builds it from a `Noggin`; a
// `middleware` option lets hosts wrap every verb call with their
// own busy indicator / error handling. Hosts can also construct the
// object by hand or decorate the default for fancier control (e.g.
// "confirm before delete" in the VS Code extension).
//
// Pure dispatch — no UI state, no React hooks. Components own
// selection and rename-mode state separately and continue to expose
// those as controlled props.

import type { Noggin } from '@noggin/engine';
import type {
  NogginMoveIntent,
  TreeContextMenuEntry,
  TreeGesture,
} from './types.js';
import { executeGesture, type GestureResult } from './gestures.js';
import { buildContextMenuItems } from './internal/buildContextMenuItems.js';
import { projectTree, findByPath } from './treeOps.js';

/**
 * @public
 * Optional knobs for {@link createTreeActions}.
 */
export interface CreateTreeActionsOptions {
  /**
   * Wraps every verb dispatch. Hosts use this for cross-cutting
   * concerns — surfacing errors to a toast, showing a busy spinner,
   * confirming destructive actions. The wrapped call's value (if
   * any) is propagated back to the original caller.
   *
   * Errors thrown inside `fn` should be re-thrown unless the
   * middleware handles them (e.g. converts to a UI message and
   * silently resolves). Callers see whatever the middleware
   * resolves with.
   */
  middleware?: <T>(fn: () => Promise<T>) => Promise<T>;
}

/**
 * @public
 * The single action surface tree + details consume. Every method is
 * an "intent" — a logical user gesture — rather than a verb call:
 * `toggleDone` flips between `done` and `edit({ open: true })`,
 * `delete` includes the `recursive` flag based on whether the item
 * has children, etc.
 *
 * One method exists per gesture the UI can produce; methods are
 * declarative ("rename this item to X") rather than imperative
 * ("run the edit verb with these options"). That separation means
 * the default {@link createTreeActions} can decide HOW to translate
 * the intent into engine verbs, while hosts that need different
 * semantics (e.g. soft delete via a different verb) can swap the
 * whole object out.
 */
export interface NogginTreeActions {
  /** Set an item's title. */
  rename(path: string, newTitle: string): Promise<void>;
  /** Flip an item's done state. `currentlyDone` is the state at the
   *  time of the click so the impl knows which direction to flip. */
  toggleDone(path: string, currentlyDone: boolean): Promise<void>;
  /** Remove an item. `hasChildren` selects the recursive flag. */
  delete(path: string, hasChildren: boolean): Promise<void>;
  /** Append a timestamped note. */
  appendNote(path: string, markdown: string): Promise<void>;
  /** Make this item the engine's active item. */
  activate(path: string): Promise<void>;
  /** Apply a drag-drop intent. The tree emits these from arborist
   *  via its `onMove` after disambiguating cursor position. */
  move(intent: NogginMoveIntent): Promise<void>;
  /** Run a keyboard tree gesture (Enter, Tab, Alt+arrows, etc.).
   *  Returns the gesture's outcome so the caller can keep selection
   *  / focus on the right row afterwards. */
  runGesture(path: string, gesture: TreeGesture): Promise<GestureResult>;
  /**
   * Build the canonical context-menu entries for a row. Disabled
   * flags are computed against the bound noggin's current state.
   * `onClick` on each entry is already wired to the corresponding
   * action method.
   */
  getMenuEntries(path: string): readonly TreeContextMenuEntry[];
}

/**
 * @public
 * Default factory: bind every action to a {@link Noggin}'s verb
 * methods. Hosts call this once per open noggin and pass the result
 * into `<NogginTree actions={…}>` and `<NogginDetails actions={…}>`.
 *
 * The `middleware` option lets a host wrap every dispatch — typical
 * use is "show a toast on error":
 *
 * ```ts
 * const actions = useMemo(() => createTreeActions(noggin, {
 *   middleware: async (fn) => {
 *     try { return await fn(); }
 *     catch (err) { setError(uiErrorMessage(err)); throw err; }
 *   },
 * }), [noggin, setError]);
 * ```
 *
 * Hosts that need pre-flight confirmation (e.g. confirm before
 * delete) can decorate the returned object:
 *
 * ```ts
 * const base = createTreeActions(noggin);
 * const actions = {
 *   ...base,
 *   delete: async (path, hasKids) => {
 *     if (hasKids && !(await confirm('Delete subtree?'))) return;
 *     await base.delete(path, hasKids);
 *   },
 * };
 * ```
 */
export function createTreeActions(
  noggin: Noggin,
  opts: CreateTreeActionsOptions = {},
): NogginTreeActions {
  const wrap = opts.middleware ?? (<T>(fn: () => Promise<T>) => fn());

  const actions: NogginTreeActions = {
    rename: (path, title) => wrap(async () => { await noggin.edit({ path, title }); }),

    toggleDone: (path, done) => wrap(async () => {
      if (done) await noggin.edit({ path, done: false });
      else await noggin.done({ path });
    }),

    delete: (path, recursive) => wrap(async () => {
      await noggin.delete({ path, recursive });
    }),

    appendNote: (path, text) => wrap(async () => { await noggin.note({ path, text }); }),

    activate: (path) => wrap(async () => { await noggin.goto({ path }); }),

    move: (intent) => wrap(async () => {
      await noggin.move({
        path: intent.fromPath,
        placement: { kind: intent.kind, anchor: intent.anchorPath },
      });
    }),

    runGesture: (path, gesture) => wrap(() => {
      // executeGesture takes a nodes snapshot for sibling resolution;
      // project on demand from the noggin's current items. Cheap (O(N))
      // for the sizes a noggin typically reaches.
      const nodes = projectTree(noggin);
      return executeGesture(noggin, nodes, path, gesture);
    }),

    getMenuEntries: (path) => {
      const nodes = projectTree(noggin);
      const node = findByPath(nodes, path);
      if (!node) return [];
      const activeKey = noggin.active?.key ?? null;
      return buildContextMenuItems({
        node,
        nodes,
        activeKey,
        onActivate: (p) => { void actions.activate(p); },
        // Route gesture-shaped menu entries through the right action.
        // toggleDone / delete need the current item state; others fall
        // through to runGesture so the executor handles sibling
        // resolution etc.
        onGesture: (p, g) => {
          if (g === 'toggleDone') { void actions.toggleDone(p, node.done); return; }
          if (g === 'delete') { void actions.delete(p, node.children.length > 0); return; }
          if (g === 'rename') {
            // The menu can't know how the host wants to enter rename
            // mode (inline input, modal, etc.). The builder's caller
            // dispatches via a separate "user requested rename" sink
            // — typically NogginTree intercepts the 'rename' gesture
            // before it ever reaches this branch.
            void actions.runGesture(p, g);
            return;
          }
          void actions.runGesture(p, g);
        },
      });
    },
  };

  return actions;
}
