// react-arborist-backed tree.
//
// - `keyToPath` is rebuilt from each snapshot so click handlers post stable
//   item-path strings (the host translates to items by path).
// - Single-select. Selection mirrors the active item.
// - DnD: arborist's onMove fires with { dragIds, parentId, index }; we forward
//   the raw intent so the host can resolve to handle.move(...) with the live
//   store (avoids stale-path races mid-drag).
// - Custom node renderer: filled (done) or unfilled (open) circle, plus title,
//   plus an inline note-count decoration on the right. Hover reveals the
//   chevron for collapse/expand on internal nodes.

import * as React from 'react';
import { useMemo, useRef, useEffect } from 'react';
import { Tree, type NodeApi, type TreeApi, type NodeRendererProps, type CursorProps } from 'react-arborist';
import type { TreeNodeData, TreeSnapshot } from '../treeBridge';
import { post } from './App';

interface Props {
  snapshot: TreeSnapshot;
  width: number;
  height: number;
}

// Shared between the Cursor/Node renderers and the onMove handler. Arborist
// only renders one cursor at a time; whichever component fires last during
// dragover is what the user sees at the moment of drop.
const lastCursorType: { current: 'line' | 'highlight' } = { current: 'line' };

const ROW_HEIGHT = 22;
const INDENT = 14;

export function NogginTree({ snapshot, width, height }: Props) {
  const treeRef = useRef<TreeApi<TreeNodeData> | null>(null);
  const activeKey = useMemo(() => findActiveKey(snapshot), [snapshot]);

  // Reveal and select the active item whenever it changes externally.
  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    if (activeKey) tree.select(activeKey, { align: 'smart', focus: false });
    else tree.deselectAll();
  }, [activeKey, snapshot.fileId]);

  // Build a Cursor renderer that closes over the tree ref so it can resolve
  // the destination textually from (top, left, indent).
  const Cursor = useMemo<(p: CursorProps) => React.JSX.Element>(() => {
    const Component = (props: CursorProps) => <DropCursor {...props} treeRef={treeRef} />;
    Component.displayName = 'DropCursor';
    return Component;
  }, []);

  return (
    <Tree<TreeNodeData>
      ref={treeRef}
      data={snapshot.roots}
      width={width}
      height={height}
      rowHeight={ROW_HEIGHT}
      indent={INDENT}
      openByDefault
      disableMultiSelection
      renderCursor={Cursor}
      onMove={(args) => {
        post({
          type: 'move',
          dragKeys: args.dragIds,
          parentKey: args.parentId,
          index: args.index,
          cursorType: lastCursorType.current,
        });
      }}
      onSelect={(nodes) => {
        // arborist fires onSelect during the post-snapshot programmatic select;
        // guard against an echo back to the host.
        if (nodes.length !== 1) return;
        const node = nodes[0]!;
        if (node.data.path === snapshot.activePath) return;
        post({ type: 'invoke', command: 'noggin.goto', path: node.data.path });
      }}
    >
      {Node}
    </Tree>
  );
}

function findActiveKey(snapshot: TreeSnapshot): string | null {
  if (!snapshot.activePath) return null;
  function walk(n: TreeNodeData): string | null {
    if (n.path === snapshot.activePath) return n.id;
    for (const c of n.children) {
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  }
  for (const r of snapshot.roots) {
    const hit = walk(r);
    if (hit) return hit;
  }
  return null;
}

function Node({ node, style, dragHandle }: NodeRendererProps<TreeNodeData>) {
  const d = node.data;
  const isActive = node.isSelected;
  const hasKids = node.children && node.children.length > 0;

  // When arborist is showing the highlight cursor ("drop into this node"),
  // willReceiveDrop is true on that node. Capture it so onMove can tell
  // line-drops apart from highlight-drops.
  if (node.willReceiveDrop) lastCursorType.current = 'highlight';

  return (
    <div
      ref={dragHandle}
      style={style}
      className={
        'noggin-row'
        + (isActive ? ' active' : '')
        + (node.willReceiveDrop ? ' drop-into' : '')
      }
      onContextMenu={(e) => {
        e.preventDefault();
        // VS Code's webview can't show a native menu; defer to host commands
        // via the inline buttons + the global noggin.* commands.
      }}
    >
      <Twisty open={node.isOpen} hasKids={!!hasKids} onToggle={() => node.toggle()} />
      <DoneIcon
        done={d.done}
        onClick={(e) => {
          e.stopPropagation();
          post({ type: 'invoke', command: 'noggin.toggleDone', path: d.path });
        }}
      />
      <span className="position">{d.path.replace(/\//g, '.')}.</span>
      <span className="title" title={d.title}>{d.title || '(untitled)'}</span>
      {d.noteCount > 0 && (
        <span className="note-badge" title={`${d.noteCount} note${d.noteCount === 1 ? '' : 's'}`}>
          ✏️{d.noteCount}
        </span>
      )}
      {node.willReceiveDrop && (
        <span className="noggin-drop-label">→ Inside "{truncate(d.title || '(untitled)')}"</span>
      )}
    </div>
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
  const label = done ? 'Mark undone' : 'Mark done';
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
            <path d="M11.78 5.72a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L4.22 8.78a.75.75 0 1 1 1.06-1.06L7 9.44l3.72-3.72a.75.75 0 0 1 1.06 0Z" fill="var(--vscode-editor-background)" />
          </>
        ) : (
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none" />
        )}
      </svg>
    </button>
  );
}

function Cursor(_props: CursorProps): null { return null; } // unused; replaced by DropCursor closure

/**
 * Insertion-line cursor with a textual destination badge.
 *
 * `top` is the y of the line; arborist places the line just above the row
 * whose visible index is `top/ROW_HEIGHT`. So the row visually *above* the
 * cursor is at index `top/ROW_HEIGHT - 1`, and that row's NodeApi tells us
 * the destination once we know the requested level (derived from `left`).
 *
 * Three textual outcomes are possible:
 *   1. "First child of <X>" — cursor is in the gap immediately below an
 *      open folder X; level > X.level.
 *   2. "After <Y>"           — cursor is in the gap below a leaf or in the
 *      gap below an open folder where the hover-x pulled the level back up
 *      to some ancestor Y.
 *   3. "Before <Z>"          — only used for the first row (above === null).
 */
function DropCursor({ top, left, indent, treeRef }: CursorProps & { treeRef: React.RefObject<TreeApi<TreeNodeData> | null> }): React.JSX.Element {
  lastCursorType.current = 'line';

  const tree = treeRef.current;
  const label = describeLineDrop(tree);

  // Match arborist's DefaultCursor positioning contract: `left` is the indent-
  // aware absolute left; `right: indent` keeps a single indent's worth of
  // padding on the right. Don't add indent as marginLeft — that double-indents.
  return (
    <div
      className="noggin-cursor"
      style={{ top: top - 1, left, right: indent }}
    >
      <span className="noggin-cursor-dot" />
      {label && <span className="noggin-cursor-label">{label}</span>}
    </div>
  );
}

function describeLineDrop(tree: TreeApi<TreeNodeData> | null): string | null {
  if (!tree) return null;

  // Source of truth: arborist's live drop intent, written into its redux
  // store on every hover. Reading this matches exactly what `onMove` will
  // be called with — no need to reverse-engineer from (top, left, indent).
  const { parentId, index } = tree.state.dnd;
  const parent = parentId ? tree.get(parentId) : null;
  const parentSiblings = parent ? (parent.children ?? []) : tree.root.children ?? [];

  // index === null means "drop directly into parent" (highlight cursor case).
  // For the line cursor branch index is always a number.
  if (typeof index !== 'number') {
    return parent ? `Inside "${truncate(parent.data.title)}"` : null;
  }

  // Empty parent (or no parent at root with 0 roots): we'll create the
  // first child of parent.
  if (parentSiblings.length === 0) {
    return parent ? `First child of "${truncate(parent.data.title)}"` : 'New root';
  }

  // index === 0: before the first sibling, which for an open folder header
  // looks like "first child of folder". For the root case, it's "before X".
  if (index === 0) {
    if (parent) return `First child of "${truncate(parent.data.title)}"`;
    return `Before "${truncate(parentSiblings[0]!.data.title)}"`;
  }

  // index === N (past the last): "after last sibling".
  if (index >= parentSiblings.length) {
    return `After "${truncate(parentSiblings[parentSiblings.length - 1]!.data.title)}"`;
  }

  // Between two siblings: "before the one at index" (which == "after the
  // one at index-1"). Show "after" since that's the row visually above the
  // cursor and easier to reason about during a drag.
  const after = parentSiblings[index - 1];
  if (after) return `After "${truncate(after.data.title)}"`;
  return `Before "${parentSiblings[index]!.data.title}"`;
}

function truncate(s: string, max = 36): string {
  const t = s || '(untitled)';
  return t.length <= max ? t : t.slice(0, max - 1) + '…';
}
