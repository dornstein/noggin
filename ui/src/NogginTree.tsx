// react-arborist-backed tree, lifted from the VS Code extension and
// parameterized over host bindings (handler props instead of postMessage).
//
// - Single-select. Selection mirrors the active item by default.
// - DnD: arborist's onMove fires with { dragIds, parentId, index } plus a
//   visual cursor type ('line' vs 'highlight'). We disambiguate in two
//   passes: first the visual cursor (set by the Node renderer when
//   willReceiveDrop is true), then index-based before/after when it's a
//   line drop. The host gets a clean {fromPath, kind, anchorPath} intent.
// - Custom node renderer: filled (done) or unfilled (open) circle, plus
//   title, plus an inline note-count decoration, plus a hover-reveal
//   action row (add child, goto, delete) for desktop-style interaction.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  Tree as ArboristTree,
  type CursorProps,
  type NodeApi,
  type NodeRendererProps,
  type TreeApi,
} from 'react-arborist';
import type {
  NogginNode,
  NogginMoveIntent,
  TreeContextMenuEntry,
  TreeContextMenuRenderProps,
  TreeGesture,
} from './types';
import { Icon } from './Icon';
import { cn } from './cn';
import { buildContextMenuItems } from './internal/buildContextMenuItems';
import { TreeRowContextMenu } from './internal/TreeContextMenuView';

/**
 * @public
 * Optional class-name overrides for {@link NogginTree}.
 *
 * Every slot listed here is composed with the built-in class via
 * space-separated concatenation — the consumer's class wins on any
 * conflicting property (last-wins in CSS). Slots not listed are not
 * stable override points and may be renamed in future minor versions;
 * if you need to reach one, target its built-in class name directly
 * in your stylesheet.
 */
export interface NogginTreeClassNames {
  /** The outer scrolling container that hosts the virtualized tree. */
  root?: string;
  /** Every row, regardless of state. Composes with rowSelected /
   *  rowActive / rowDone when applicable. */
  row?: string;
  /** Added to a row when it is the keyboard-selected row. */
  rowSelected?: string;
  /** Added to a row when it is the engine-active row (the persistent
   *  "spotlight"). */
  rowActive?: string;
  /** Added to a row when its item is done. */
  rowDone?: string;
  /** The item title span inside a row. */
  title?: string;
  /** The dotted-path prefix span (e.g. `/1/2`). */
  path?: string;
}

export interface NogginTreeHandlers {
  /** Click on a row or keyboard navigation → selects this row. The host
   *  typically uses this to update its `selectedPath` state. Does NOT
   *  imply the engine's `active` should change — that's a separate
   *  operation (`onActivate`) so users can browse the tree without
   *  disturbing the engine's persistent spotlight. */
  onSelect: (path: string) => void;
  /** Explicit "make this the active item" gesture. Wired to the
   *  Details pane's Goto button today; double-click is reserved for
   *  inline rename. */
  onActivate?: (path: string) => void;
  /** Click the state icon → flip done/open. */
  onToggleDone: (path: string, currentlyDone: boolean) => void;
  /** Drag-drop intent (or null result if same drop). */
  onMove: (intent: NogginMoveIntent) => void;
  /** Double-click → host should set `renamingPath = path` to switch the
   *  row into inline-rename mode. */
  onRequestRename?: (path: string) => void;
  /** Inline rename commit. Called on Enter or input blur with a non-empty
   *  trimmed value that differs from the existing title. */
  onRenameSubmit?: (path: string, newTitle: string) => void;
  /** Inline rename abort. Called on Escape or empty/unchanged blur. */
  onRenameCancel?: () => void;
  /** Keyboard gesture fired by the focused row. Host translates into a verb. */
  onGesture?: (path: string, gesture: TreeGesture) => void;
}

export interface NogginTreeProps extends NogginTreeHandlers {
  nodes: NogginNode[];
  /** Stable id for the open noggin; tree state resets when it changes. */
  fileId?: string | null;
  /** Key of the active item, or null. */
  activeKey: string | null;
  /** Path of the path the user has selected, if separate from active. */
  selectedPath?: string | null;
  /** Path of the row currently in inline-rename mode (or null). */
  renamingPath?: string | null;
  /** Fixed row height. Default 22 (VS Code-style). */
  rowHeight?: number;
  /** Indent per level. Default 14. */
  indent?: number;
  /** Optional explicit size for the virtualized list. Defaults to filling parent. */
  width?: number;
  height?: number;
  /** Per-slot class-name overrides. See {@link NogginTreeClassNames}. */
  classNames?: NogginTreeClassNames;
  /**
   * Optional render override for the right-click context menu. The tree
   * always decides the menu's contents — items, labels, shortcuts,
   * enabled/disabled state — but a host can swap the popup
   * implementation (e.g. a VS Code-native menu in the extension) by
   * providing this. Receives the entries the tree built; the host
   * dispatches `entry.onClick()` to fire actions. Item picks auto-dismiss
   * the menu via the bound onClick; outside-click / Escape should call
   * `onClose()`.
   *
   * When omitted, the tree uses its built-in popup.
   */
  renderContextMenu?: (props: TreeContextMenuRenderProps) => ReactNode;
}

// Cursor type the arborist node renderer last requested. Read at drop
// time so we can distinguish "drop on row" (highlight) from "drop
// between rows" (line). Module-scoped because arborist only renders
// one cursor at a time.
const lastCursorType: { current: 'line' | 'highlight' } = { current: 'line' };

export function NogginTree(props: NogginTreeProps) {
  const {
    nodes, fileId, activeKey, selectedPath, rowHeight = 22, indent = 14, width, height,
  } = props;

  const treeRef = useRef<TreeApi<NogginNode> | null>(null);

  // ── Context menu state ────────────────────────────────────────────
  // The tree owns the right-click menu end-to-end. Hosts can swap the
  // popup chrome via `renderContextMenu`, but the menu's contents,
  // ordering, labels, and shortcuts are always the tree's call.
  //
  // Default path (no `renderContextMenu`): each row wraps itself in
  // `<TreeRowContextMenu>` (Radix). Radix owns open/close, positioning,
  // focus, keyboard nav, ARIA — we never call the imperative
  // `menuState` below in this case.
  //
  // Override path: the host wants to draw the popup themselves
  // (different theme, different anchoring, native menu, etc.). We
  // track open state imperatively so we can hand them
  // `{ position, entries, onClose }` and stay out of the way.
  const usingHostMenu = !!props.renderContextMenu;
  const [menuState, setMenuState] = useState<{
    position: { x: number; y: number };
    node: NogginNode;
  } | null>(null);
  const closeMenu = () => setMenuState(null);
  const openHostMenu = (x: number, y: number, node: NogginNode) => {
    // Right-click also selects the row — ensures a follow-up keyboard
    // gesture targets the row the menu is anchored to.
    if (node.path !== selectedPath) props.onSelect(node.path);
    setMenuState({ position: { x, y }, node });
  };
  const onRowMenuOpen = (_node: NogginNode) => {
    // Intentionally no-op. Right-click used to ALSO dispatch
    // props.onSelect to mirror the row into host selection, but that
    // state update caused React to re-render the Row mid-Radix-open
    // animation, sometimes destroying Radix's internal open state.
    // The Radix menu knows which row it belongs to via its <Trigger>;
    // the menu's actions take a `node` argument computed at trigger
    // time, so selection sync isn't required for correctness.
    //
    // If a host needs the row visually highlighted while its menu is
    // open, target `.noggin-row[data-state="open"]` in CSS — Radix
    // sets the attribute automatically on the trigger element.
  };

  // Build canonical entries for a given row. Used by both paths:
  // - Radix path: Row calls this via its TreeRowContextMenu's buildEntries
  //   prop, so it only runs when the user actually opens the menu.
  // - Host-override path: computed from menuState here and handed to
  //   props.renderContextMenu.
  const buildEntriesFor = (node: NogginNode, onAfterClick: () => void): readonly TreeContextMenuEntry[] => {
    const raw = buildContextMenuItems({
      node,
      nodes,
      activeKey,
      onActivate: (p) => props.onActivate?.(p),
      onGesture: (p, g) => props.onGesture?.(p, g),
    });
    return raw.map((entry) => entry.kind === 'item'
      ? { ...entry, onClick: () => { entry.onClick(); onAfterClick(); } }
      : entry);
  };

  const hostMenuEntries = useMemo<readonly TreeContextMenuEntry[] | null>(() => {
    if (!menuState) return null;
    return buildEntriesFor(menuState.node, closeMenu);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuState, nodes, activeKey, props.onActivate, props.onGesture]);

  // Auto-size to parent when no explicit width/height is given.
  // Defensive: skip 0×0 measurements. They mean an ancestor has no
  // box (e.g. `display: none`) and the value is uninformative — if
  // we wrote it back the virtualizer would render zero rows until
  // the next ResizeObserver tick caught up. Preserving the previous
  // size keeps the tree usable through display:none → visible
  // transitions.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [autoSize, setAutoSize] = useState({ w: 320, h: 480 });
  useLayoutEffect(() => {
    if (width != null && height != null) return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return;
      setAutoSize({ w, h });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  // Reveal and select the active row when it changes externally.
  // Active is the engine's persistent spotlight; we keep it visible
  // by scrolling it into view, but we don't touch arborist's focus or
  // selection — those track keyboard navigation separately.
  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    if (activeKey) tree.scrollTo(activeKey, 'smart');
  }, [activeKey, fileId]);

  // Drive arborist's keyboard focus + selection from `selectedPath`.
  // We only push when arborist's current state disagrees — otherwise
  // we'd fight the user's arrow keys.
  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    if (!selectedPath) return;
    const node = findNodeByPath(nodes, selectedPath);
    if (!node) return;
    if (tree.focusedNode?.id === node.key) return; // already there
    const renameInput = (typeof document !== 'undefined')
      ? document.querySelector('.noggin-row-rename')
      : null;
    if (renameInput) return;
    // If a Radix popup is open in the document (context menu on a tree
    // row, dropdown on the details kebab, etc.), don't yank focus back
    // to the tree. The user is interacting with the popup; stealing
    // focus would dismiss it.
    const popupOpen = typeof document !== 'undefined'
      && document.querySelector('[role="menu"][data-state="open"]');
    if (popupOpen) return;
    try { tree.focus(node.key, { scroll: false }); } catch { /* ignore */ }
    // If DOM focus is on body or already inside our tree, also pull
    // it onto the tree root so keystrokes actually reach the keydown
    // handler. (See rename-end effect for the longer explanation \u2014
    // arborist's `tree.focus()` is select-only under
    // `selectionFollowsFocus`.) Don't steal focus if it lives on
    // some other interactive element (e.g. a Details-pane input).
    const container = containerRef.current;
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    const focusBelongsElsewhere = active
      && active !== document.body
      && container
      && !container.contains(active);
    if (!focusBelongsElsewhere) {
      const root = container?.querySelector<HTMLElement>('[role="tree"]');
      root?.focus({ preventScroll: true });
    }
  }, [selectedPath, nodes]);

  // The Cursor renderer closes over the tree ref so it can derive a
  // human-readable destination label from the live drag state.
  const Cursor = useMemo(() => {
    const Component = (cp: CursorProps) => <DropCursor {...cp} treeRef={treeRef} />;
    Component.displayName = 'DropCursor';
    return Component;
  }, []);

  // The Node renderer needs access to the handlers; close over props.
  const NodeRow = useMemo(() => {
    const Component = (np: NodeRendererProps<NogginNode>) => (
      <Row
        np={np}
        p={props}
        treeRef={treeRef}
        usingHostMenu={usingHostMenu}
        openHostMenu={openHostMenu}
        onRowMenuOpen={onRowMenuOpen}
        buildEntries={buildEntriesFor}
      />
    );
    Component.displayName = 'NogginTreeRow';
    return Component;
    // openHostMenu / onRowMenuOpen / buildEntriesFor are stable closures
    // over setMenuState + props; safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props, usingHostMenu]);

  const treeW = width ?? autoSize.w;
  const treeH = height ?? autoSize.h;

  // When inline rename ends (renamingPath: string → null), put keyboard
  // focus back on the row that was being renamed. Without this, the
  // user-favourite chord "Enter type Enter Enter type Enter ..." breaks
  // after the first commit because focus would otherwise fall to body.
  //
  // Subtle: with `selectionFollowsFocus`, arborist's `tree.focus()` just
  // calls `select` \u2014 it dispatches the selection action but does NOT
  // move DOM focus to the tree container. After the rename input
  // blurs, the actual focused element is `<body>`, so our keydown
  // handler on the tree never fires. We must explicitly DOM-focus
  // the `[role="tree"]` element ourselves.
  const prevRenamingRef = useRef<string | null>(null);
  useEffect(() => {
    const before = prevRenamingRef.current;
    const after = props.renamingPath ?? null;
    if (before && !after) {
      const node = findNodeByPath(nodes, before);
      if (node) {
        try { treeRef.current?.focus(node.key, { scroll: false }); } catch { /* ignore */ }
        // Schedule after the current task so the rename input's own
        // blur/cleanup completes first.
        queueMicrotask(() => {
          const root = containerRef.current?.querySelector<HTMLElement>('[role="tree"]');
          root?.focus({ preventScroll: true });
        });
      }
    }
    prevRenamingRef.current = after;
  }, [props.renamingPath, nodes]);

  // True from the moment we dispatch an add gesture until the new
  // row's rename input mounts. While set, the keydown handler swallows
  // every key so a fast typist's next keystroke doesn't fire a second
  // gesture (or leak as a plain key into the tree) before the input
  // is ready to receive it.
  const addingRow = useRef(false);
  useEffect(() => {
    if (props.renamingPath) addingRow.current = false;
  }, [props.renamingPath]);

  // Capture-phase native keydown listener. Mandatory \u2014 react-arborist's
  // default container has a bubble-phase onKeyDown on its
  // `[role="tree"]` div that handles Tab/Shift+Tab by imperatively
  // calling `focusNextElement(e.currentTarget)` to move browser focus
  // OUT of the tree. By then it's too late: a later preventDefault
  // can't undo an imperative focus change. We must run BEFORE
  // arborist's handler and stop the event entirely.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      // Swallow keystrokes during an in-flight add (engine round-trip
      // + React re-render). See `addingRow` comment above.
      if (addingRow.current) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
      const gesture = gestureForKey(e);
      if (!gesture) return;
      e.preventDefault();
      e.stopPropagation();
      // stopImmediatePropagation prevents both arborist's bubble-phase
      // listener AND React's delegated synthetic dispatch at the root.
      e.stopImmediatePropagation();

      const tree = treeRef.current;
      if (!tree) return;
      let focusedPath: string | null = tree.focusedNode?.data.path ?? null;
      if (!focusedPath && props.selectedPath) {
        const node = findNodeByPath(nodes, props.selectedPath);
        if (node) focusedPath = node.path;
      }
      if (!focusedPath && tree.selectedNodes[0]) {
        focusedPath = tree.selectedNodes[0].data.path;
      }
      if (!focusedPath) return;
      // Any gesture that creates a new row drops the tree into the
      // blocked state. The renamingPath effect above clears it; a
      // 250ms safety timeout clears it too, in case the gesture
      // failed to produce a renamed row (e.g. engine error).
      if (gesture.startsWith('add')) {
        addingRow.current = true;
        window.setTimeout(() => { addingRow.current = false; }, 250);
      }
      props.onGesture?.(focusedPath, gesture);
    };
    el.addEventListener('keydown', handler, true);
    return () => el.removeEventListener('keydown', handler, true);
  }, [nodes, props.selectedPath, props.onGesture]);

  return (
    <div
      ref={containerRef}
      className={cn('noggin-tree-root', props.classNames?.root)}
    >
      <ArboristTree<NogginNode>
        ref={treeRef}
        data={nodes}
        width={treeW}
        height={treeH}
        rowHeight={rowHeight}
        indent={indent}
        openByDefault
        disableMultiSelection
        // Arrow keys move focus AND selection in lock-step. Without
        // this flag, arborist treats focus and selection as separate
        // (WAI-ARIA pattern) and arrow nav doesn't update aria-selected,
        // which our focus ring + host's selectedPath both depend on.
        selectionFollowsFocus
        renderCursor={Cursor}
        idAccessor="key"
        onFocus={(node) => {
          // Arborist's focused node → host selectedPath. With
          // `selectionFollowsFocus`, this fires for arrow nav, clicks,
          // and programmatic focus changes. Skip the echo when path
          // already matches.
          if (node && node.data.path !== selectedPath) {
            props.onSelect(node.data.path);
          }
        }}
        onMove={(args) => {
          const intent = resolveMoveIntent(treeRef.current, args, lastCursorType.current);
          if (!intent) return;
          props.onMove(intent);
        }}
        onSelect={(selected) => {
          // Redundant with onFocus when selectionFollowsFocus is on,
          // but click-only-no-focus paths (e.g. drag selection) still
          // come through here. Mirror to host.
          if (selected.length !== 1) return;
          const node = selected[0]!;
          if (node.data.path !== selectedPath) {
            props.onSelect(node.data.path);
          }
        }}
      >
        {NodeRow}
      </ArboristTree>
      {/* Host-override path only. The Radix default mounts its menu
          inline per row via TreeRowContextMenu and doesn't reach here. */}
      {usingHostMenu && hostMenuEntries && menuState && props.renderContextMenu?.({
        position: menuState.position,
        entries: hostMenuEntries,
        onClose: closeMenu,
      })}
    </div>
  );
}

/**
 * Map a KeyboardEvent to a TreeGesture, or null if no gesture matches.
 * Exported only for testing — components don't call this directly.
 *
 * Modifier discipline:
 *   - `mod` = Ctrl on Win/Linux, Cmd on macOS (`ctrlKey || metaKey`).
 *   - `alt` = Alt on Win/Linux, Option on macOS.
 * Conventions chosen to match outliner standards (Workflowy / Roam /
 * Logseq) for add+promote/demote, and VS Code's `Alt+arrows` for move.
 */
export function gestureForKey(e: KeyboardEvent): TreeGesture | null {
  const mod = e.ctrlKey || e.metaKey;
  const alt = e.altKey;
  const shift = e.shiftKey;

  // MOVE — Alt + direction.
  if (alt && !mod && !shift) {
    switch (e.key) {
      case 'ArrowUp':   return 'moveUp';
      case 'ArrowDown': return 'moveDown';
      case 'Home':      return 'moveToFirst';
      case 'End':       return 'moveToLast';
    }
  }

  // ADD — mod (Ctrl/Cmd) + key.
  if (mod && !alt && !shift) {
    if (e.key === 'Enter') return 'addChild';
    if (e.key === 'Home')  return 'addFirstSibling';
    if (e.key === 'End')   return 'addLastSibling';
  }

  // Outliner conventions — no modifier or Shift only.
  if (!mod && !alt) {
    if (e.key === 'Enter' && !shift) return 'addSiblingAfter';
    if (e.key === 'Enter' && shift)  return 'addSiblingBefore';
    if (e.key === 'Tab'   && !shift) return 'demote';
    if (e.key === 'Tab'   && shift)  return 'promote';
    if (e.key === 'F2')              return 'rename';
    if (e.key === ' ')               return 'toggleDone';
    if (e.key === 'Delete')          return 'delete';
  }

  return null;
}

/**
 * True for gestures that should be auto-committed-and-dispatched if the
 * user fires them while the inline rename input has focus. The rule:
 * any gesture that creates, moves, or re-parents a row \u2014 i.e. add /
 * move / demote / promote. Excluded:
 *   - `rename`     \u2014 already in rename mode, pointless
 *   - `toggleDone` \u2014 Space must reach the input as a normal character
 *   - `delete`     \u2014 Delete is a normal text-editing key
 *
 * Everything else (Home, End, Left/Right, plain Up/Down, plain
 * characters) is handled either by our explicit shortcuts (Enter,
 * Escape, plain Up/Down) or by the input itself with no
 * interference (we `stopPropagation()` on every key so arborist's
 * container handler never sees it).
 */
export function shouldInterceptFromRename(g: TreeGesture | null): boolean {
  if (!g) return false;
  return g.startsWith('add') || g.startsWith('move') || g === 'demote' || g === 'promote';
}

function findNodeByPath(nodes: readonly NogginNode[], path: string): NogginNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    const f = findNodeByPath(n.children, path);
    if (f) return f;
  }
  return null;
}

function Row({ np, p, treeRef, usingHostMenu, openHostMenu, onRowMenuOpen, buildEntries }: {
  np: NodeRendererProps<NogginNode>;
  p: NogginTreeProps;
  treeRef: React.RefObject<TreeApi<NogginNode> | null>;
  usingHostMenu: boolean;
  openHostMenu: (x: number, y: number, node: NogginNode) => void;
  onRowMenuOpen: (node: NogginNode) => void;
  buildEntries: (node: NogginNode, onAfterClick: () => void) => readonly TreeContextMenuEntry[];
}) {
  const { node, style, dragHandle } = np;
  const d = node.data;
  const isActive = d.key === p.activeKey;
  const isSelected = d.path === p.selectedPath;
  const isFocused = node.isFocused;
  const hasKids = node.children && node.children.length > 0;

  // When arborist would drop INTO this node, ask the Cursor to render as
  // highlight (and remember that on drop).
  if (node.willReceiveDrop) lastCursorType.current = 'highlight';

  // Arborist passes the depth indent as inline `style.paddingLeft`. We
  // peel it off and re-apply it after a fixed-width pin gutter, so
  // pins always live in a single column at the row's left edge
  // regardless of depth.
  const indent = typeof style?.paddingLeft === 'number' ? style.paddingLeft : 0;
  const PIN_GUTTER = 22;
  const rowStyle = { ...style, paddingLeft: PIN_GUTTER + indent, position: 'relative' as const };

  const rowInner = (
    <div
      ref={dragHandle}
      style={rowStyle}
      className={cn(
        'noggin-row',
        isActive && 'active',
        isSelected && 'selected',
        isFocused && 'focused',
        node.willReceiveDrop && 'drop-into',
        d.done && 'done',
        p.classNames?.row,
        isSelected && p.classNames?.rowSelected,
        isActive && p.classNames?.rowActive,
        d.done && p.classNames?.rowDone,
      )}
      onContextMenu={usingHostMenu
        ? (e) => { e.preventDefault(); openHostMenu(e.clientX, e.clientY, d); }
        : undefined /* Radix's ContextMenu.Trigger handles it */}
      onDoubleClick={(e) => {
        if (!p.onRequestRename) return;
        e.stopPropagation();
        p.onRequestRename(d.path);
      }}
    >
      <PinIcon
        active={isActive}
        canActivate={!!p.onActivate}
        onClick={(e) => {
          e.stopPropagation();
          if (!p.onActivate) return;
          if (isActive) return; // clicking the already-active pin is a no-op
          p.onActivate(d.path);
        }}
      />
      <Twisty open={node.isOpen} hasKids={!!hasKids} onToggle={() => node.toggle()} />
      <DoneIcon
        done={d.done}
        onClick={(e) => {
          e.stopPropagation();
          p.onToggleDone(d.path, d.done);
        }}
      />
      <span className={cn('position', p.classNames?.path)}>{d.path}</span>
      {p.renamingPath === d.path && p.onRenameSubmit ? (
        <input
          ref={(el) => {
            // Replace `autoFocus`. arborist's row-container useEffect
            // fires `el.focus()` on the row's outer div whenever
            // `node.isFocused && !node.isEditing` \u2014 which races our
            // autoFocus and (sometimes) wins, leaving the input
            // mounted but unfocused. Schedule the input focus on a
            // microtask so it runs AFTER arborist's effect.
            if (!el) return;
            queueMicrotask(() => {
              if (document.body.contains(el)) {
                el.focus();
                el.select();
              }
            });
          }}
          className="noggin-row-rename"
          defaultValue={d.title}
          placeholder={d.title ? '' : 'New item title\u2026'}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            // Stop every key from bubbling to arborist's
            // `[role="tree"]` onKeyDown. Arborist hijacks Home, End,
            // Tab, Space, *, ArrowLeft/Right, ArrowUp/Down as
            // tree-navigation keys without checking the event
            // target. If we let them bubble, pressing Home in the
            // rename input would jump focus to the first tree row
            // instead of moving the caret to the start of the title.
            //
            // We still process our own explicit shortcuts below;
            // everything else falls through to the input's default
            // behaviour (which is what a text field should do for
            // Home/End/arrows/Space/etc).
            e.stopPropagation();

            // Plain Enter (no modifiers) is the "commit" key. We
            // deliberately don't match Ctrl/Meta/Alt/Shift here \u2014
            // those combos are tree gestures (Ctrl+Enter = addChild,
            // Shift+Enter = addSiblingBefore) and need to fall
            // through to the intercept logic below.
            if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
              e.preventDefault();
              const v = e.currentTarget.value.trim();
              if (v && v !== d.title) p.onRenameSubmit!(d.path, v);
              else p.onRenameCancel?.();
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              p.onRenameCancel?.();
              return;
            }
            // Bare ArrowUp / ArrowDown: commit (or cancel if empty /
            // unchanged) then move keyboard focus to the prev / next
            // visible row.
            if (
              (e.key === 'ArrowUp' || e.key === 'ArrowDown')
              && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
            ) {
              e.preventDefault();
              const v = e.currentTarget.value.trim();
              if (v && v !== d.title) p.onRenameSubmit!(d.path, v);
              else p.onRenameCancel?.();
              const dir = e.key;
              // Move arborist focus on the next microtask, after the
              // host's renamingPath state-change has been queued.
              // tree.focus() under selectionFollowsFocus selects the
              // target row too, which propagates back as onSelect \u2014
              // host's selectedPath update then pulls DOM focus to
              // the tree root via the existing effect.
              queueMicrotask(() => {
                const tree = treeRef.current;
                if (!tree) return;
                const target = dir === 'ArrowUp' ? tree.prevNode : tree.nextNode;
                if (target) tree.focus(target);
              });
              return;
            }
            // Tree gesture intercept: the user typed a title and
            // then hit an add/move shortcut without pressing Enter
            // first. Auto-commit the partly-typed title and dispatch
            // the gesture so it lands on the just-saved row. Without
            // this, arborist's container would steal focus away on
            // some of these keys, the input would blur with onBlur
            // possibly racing with React's unmount, and the newly
            // added row would vanish.
            const gesture = gestureForKey(e.nativeEvent);
            if (shouldInterceptFromRename(gesture)) {
              e.preventDefault();
              e.stopPropagation();
              const v = e.currentTarget.value.trim();
              const path = d.path;
              if (!v) {
                // No title typed yet \u2014 don't save garbage, but also
                // don't dispatch a gesture against a row that may
                // get auto-deleted (cancel-of-fresh deletes empty
                // new rows). Cancel and bail.
                p.onRenameCancel?.();
                return;
              }
              if (v !== d.title) {
                p.onRenameSubmit!(path, v);
              } else {
                // Unchanged existing title: nothing to save, but we
                // MUST clear the host's `renamingPath` before
                // dispatching a structural gesture. Otherwise the
                // gesture re-numbers rows and the stale `renamingPath`
                // suddenly matches a different item, dropping it
                // into rename mode. Cancel is the right verb here \u2014
                // it clears state without saving (and without
                // deleting, since `renamingIsNew` is false for an
                // existing-item edit).
                p.onRenameCancel?.();
              }
              // Engine queue serializes the edit + the gesture's
              // verb in order; dispatch immediately.
              p.onGesture?.(path, gesture!);
            }
          }}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (v && v !== d.title) p.onRenameSubmit!(d.path, v);
            else p.onRenameCancel?.();
          }}
        />
      ) : (
        <span className={cn('title', p.classNames?.title)} title={d.title}>{d.title || '(untitled)'}</span>
      )}
      {d.noteCount > 0 && (
        <span className="note-badge" title={`${d.noteCount} note${d.noteCount === 1 ? '' : 's'}`}>
          <Icon name="note" /> {d.noteCount}
        </span>
      )}
      {node.willReceiveDrop && (
        <span className="noggin-drop-label">→ Inside &ldquo;{truncate(d.title || '(untitled)')}&rdquo;</span>
      )}
    </div>
  );

  if (usingHostMenu) return rowInner;
  return (
    <TreeRowContextMenu
      buildEntries={() => buildEntries(d, () => { /* Radix dismisses; nothing extra needed */ })}
      onOpen={() => onRowMenuOpen(d)}
    >
      {rowInner}
    </TreeRowContextMenu>
  );
}

function Twisty({ open, hasKids, onToggle }: { open: boolean; hasKids: boolean; onToggle: () => void }) {
  if (!hasKids) return <span className="twisty placeholder" />;
  return (
    <button
      className="twisty"
      aria-label={open ? 'Collapse' : 'Expand'}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
    >
      <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0)' }}>
        <path d="M5 3l6 5-6 5z" fill="currentColor" />
      </svg>
    </button>
  );
}

function DoneIcon({ done, onClick }: { done: boolean; onClick: React.MouseEventHandler }) {
  const label = done ? 'Reopen' : 'Mark done';
  return (
    <button
      className={'done-icon ' + (done ? 'done' : 'open')}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={done}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        {done ? (
          <>
            <circle cx="8" cy="8" r="7" fill="currentColor" />
            <path d="M11.78 5.72a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L4.22 8.78a.75.75 0 1 1 1.06-1.06L7 9.44l3.72-3.72a.75.75 0 0 1 1.06 0Z" fill="var(--noggin-canvas-bg)" />
          </>
        ) : (
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none" />
        )}
      </svg>
    </button>
  );
}

/**
 * Pin slot at the head of each row. Reserved (same width) even when
 * empty so titles align. Solid when the row is the engine's active
 * item; on hover of a non-active row, shows a dimmed pin that
 * activates that row when clicked.
 */
function PinIcon({ active, canActivate, onClick }: { active: boolean; canActivate: boolean; onClick: React.MouseEventHandler }) {
  if (!canActivate && !active) {
    return <span className="pin-icon placeholder" aria-hidden="true" />;
  }
  const label = active ? 'Active item' : 'Pin as active';
  return (
    <button
      className={'pin-icon' + (active ? ' active' : '')}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      tabIndex={-1}
    >
      <span className="pin-emoji" aria-hidden="true">📍</span>
    </button>
  );
}

/**
 * Insertion-line cursor with a textual destination badge. Lifted
 * straight from the extension; computes its label from arborist's
 * live drag state (tree.state.dnd) so it always matches what onMove
 * will receive.
 */
function DropCursor({ top, left, indent, treeRef }: CursorProps & { treeRef: React.RefObject<TreeApi<NogginNode> | null> }) {
  lastCursorType.current = 'line';

  const tree = treeRef.current;
  const label = describeLineDrop(tree);

  const style: CSSProperties = { top: top - 1, left, right: indent };
  return (
    <div className="noggin-cursor" style={style}>
      <span className="noggin-cursor-dot" />
      {label && <span className="noggin-cursor-label">{label}</span>}
    </div>
  );
}

function describeLineDrop(tree: TreeApi<NogginNode> | null): string | null {
  if (!tree) return null;
  const { parentId, index } = tree.state.dnd;
  const parent = parentId ? tree.get(parentId) : null;
  const siblings = parent ? (parent.children ?? []) : tree.root.children ?? [];

  if (typeof index !== 'number') {
    return parent ? `Inside "${truncate(parent.data.title)}"` : null;
  }
  if (siblings.length === 0) {
    return parent ? `First child of "${truncate(parent.data.title)}"` : 'New root';
  }
  if (index === 0) {
    if (parent) return `First child of "${truncate(parent.data.title)}"`;
    return `Before "${truncate(siblings[0]!.data.title)}"`;
  }
  if (index >= siblings.length) {
    return `After "${truncate(siblings[siblings.length - 1]!.data.title)}"`;
  }
  const after = siblings[index - 1];
  if (after) return `After "${truncate(after.data.title)}"`;
  return `Before "${truncate(siblings[index]!.data.title)}"`;
}

/**
 * Translate arborist's (parentId, index, cursorType) into a
 * {fromPath, kind, anchorPath} intent the host can map to verbs.move().
 *
 * - cursorType 'highlight' → drop ONTO a row → kind 'into', anchor = that row.
 * - cursorType 'line' → drop BETWEEN rows:
 *     - index === 0 and parent exists → "first child of parent" → into parent.
 *     - index === 0 and no parent (root) → before first root sibling.
 *     - index > 0 → after sibling[index - 1].
 *     - index >= siblings.length → after last sibling.
 *     - empty parent → into parent (treat the empty gap as "first child").
 */
function resolveMoveIntent(
  tree: TreeApi<NogginNode> | null,
  args: { dragIds: string[]; parentId: string | null; index: number },
  cursorType: 'line' | 'highlight',
): NogginMoveIntent | null {
  if (!tree) return null;
  const dragKey = args.dragIds[0];
  if (!dragKey) return null;
  const source = tree.get(dragKey);
  if (!source) return null;
  const fromPath = source.data.path;

  // Highlight cursor → drop into the parent row directly.
  if (cursorType === 'highlight') {
    if (!args.parentId) return null; // can't drop INTO the root
    const parent = tree.get(args.parentId);
    if (!parent) return null;
    return { fromPath, kind: 'into', anchorPath: parent.data.path };
  }

  // Line cursor: between two rows, or at the boundary of a sibling list.
  const parent = args.parentId ? tree.get(args.parentId) : null;
  const siblings: NodeApi<NogginNode>[] = parent
    ? (parent.children ?? [])
    : (tree.root.children ?? []);

  // Empty parent (or no roots) — treat as "first child of parent".
  if (siblings.length === 0) {
    if (!parent) return null;
    return { fromPath, kind: 'into', anchorPath: parent.data.path };
  }

  // Index === 0 with a parent: "first child of parent".
  if (args.index === 0 && parent) {
    return { fromPath, kind: 'into', anchorPath: parent.data.path };
  }
  // Index === 0 at the root: "before sibling[0]".
  if (args.index === 0) {
    return { fromPath, kind: 'before', anchorPath: siblings[0]!.data.path };
  }
  // Index past the last sibling: "after last sibling".
  if (args.index >= siblings.length) {
    return { fromPath, kind: 'after', anchorPath: siblings[siblings.length - 1]!.data.path };
  }
  // Between two siblings: anchor on the previous sibling, kind 'after'.
  return { fromPath, kind: 'after', anchorPath: siblings[args.index - 1]!.data.path };
}

function truncate(s: string, max = 36): string {
  const t = s || '(untitled)';
  return t.length <= max ? t : t.slice(0, max - 1) + '…';
}
