// Tree view. VS Code-style indentation, expand/collapse, hover
// action buttons, in-place rename, drag-drop, right-click context menu.
//
// Drop zones per row: top 25% = before sibling, bottom 25% = after
// sibling, middle 50% = into (becomes last child). The engine's
// verbs.move handles cycle rejection; we pre-reject only the obvious
// cases (drop on self, drop on descendant) to keep the UX snappy.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { Icon } from './Icon';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';

export interface TreeNode {
  key: string;
  path: string;
  title: string;
  done: boolean;
  notes?: { timestamp: string; text: string }[];
  children?: TreeNode[];
}

export type DropZone = 'before' | 'after' | 'into';

export interface TreeProps {
  nodes: TreeNode[];
  activeKey: string | null;
  selectedPath: string | null;
  expanded: Record<string, boolean>;
  onToggleExpand: (key: string) => void;
  onSelect: (path: string) => void;
  onGoto: (path: string) => void;
  onToggleDone: (path: string, currentlyDone: boolean) => void;
  onAddChild: (path: string) => void;
  onRename: (path: string, newTitle: string) => void;
  onDelete: (path: string, hasChildren: boolean) => void;
  onMove: (fromPath: string, zone: DropZone, anchorPath: string) => void;
  onAddSiblingBefore: (path: string) => void;
  onAddSiblingAfter: (path: string) => void;
  onPushUnder: (path: string) => void;
  onAddNote: (path: string) => void;
}

export function Tree(props: TreeProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  // Lifted so the context menu can trigger rename on the right row.
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  const closeMenu = useCallback(() => setContextMenu(null), []);

  return (
    <>
      <ul className="tree" role="tree" aria-label="Noggin tree">
        {props.nodes.map((n) => (
          <TreeRow
            key={n.key}
            node={n}
            depth={0}
            renamingPath={renamingPath}
            setRenamingPath={setRenamingPath}
            onOpenContextMenu={(x, y, node) => setContextMenu({ x, y, node })}
            {...props}
          />
        ))}
      </ul>

      <ContextMenu
        open={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        onClose={closeMenu}
        items={contextMenu ? rowContextMenu(contextMenu.node, props, setRenamingPath) : []}
      />
    </>
  );
}

interface RowProps extends TreeProps {
  node: TreeNode;
  depth: number;
  renamingPath: string | null;
  setRenamingPath: (p: string | null) => void;
  onOpenContextMenu: (x: number, y: number, node: TreeNode) => void;
}

function TreeRow(props: RowProps) {
  const {
    node, depth, activeKey, selectedPath, expanded,
    onToggleExpand, onSelect, onGoto, onToggleDone, onAddChild,
    onRename, onDelete, onMove, onOpenContextMenu,
    renamingPath, setRenamingPath,
  } = props;

  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const renameRef = useRef<HTMLInputElement | null>(null);

  const isActive = node.key === activeKey;
  const isSelected = node.path === selectedPath;
  const isRenaming = renamingPath === node.path;
  const hasChildren = !!node.children && node.children.length > 0;
  const isExpanded = expanded[node.key] ?? true;
  const indent: CSSProperties = { paddingLeft: 8 + depth * 14 };

  const commitRename = useCallback((newTitle: string) => {
    setRenamingPath(null);
    const t = newTitle.trim();
    if (!t || t === node.title) return;
    onRename(node.path, t);
  }, [node.path, node.title, onRename, setRenamingPath]);

  // Focus + select the rename input when it appears. Effect-driven
  // (not during render) so React doesn't warn about side-effects.
  const wasRenamingRef = useRef(false);
  useEffect(() => {
    if (isRenaming && !wasRenamingRef.current) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
    wasRenamingRef.current = isRenaming;
  }, [isRenaming]);

  // ── Drag-drop ──
  const onDragStart = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.setData('application/x-noggin-path', node.path);
    e.dataTransfer.effectAllowed = 'move';
    const chip = document.createElement('div');
    chip.className = 'drag-chip';
    chip.textContent = node.title;
    document.body.appendChild(chip);
    e.dataTransfer.setDragImage(chip, 12, 12);
    requestAnimationFrame(() => chip.remove());
  }, [node.path, node.title]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-noggin-path')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    let zone: DropZone;
    if (y < h * 0.25) zone = 'before';
    else if (y > h * 0.75) zone = 'after';
    else zone = 'into';
    setDropZone(zone);
  }, []);

  const onDragLeave = useCallback(() => setDropZone(null), []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropZone(null);
    const fromPath = e.dataTransfer.getData('application/x-noggin-path');
    if (!fromPath || fromPath === node.path) return;
    // Pre-reject obvious cycle: dest is a descendant of source.
    if (node.path === fromPath || node.path.startsWith(fromPath + '/')) return;
    if (!dropZone) return;
    onMove(fromPath, dropZone, node.path);
  }, [node.path, dropZone, onMove]);

  return (
    <li className="tree-li" role="treeitem" aria-selected={isSelected}>
      <div
        className={`row${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}${node.done ? ' done' : ''}${dropZone ? ' drop-' + dropZone : ''}`}
        style={indent}
        draggable={!isRenaming}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => onSelect(node.path)}
        onDoubleClick={(e) => { e.stopPropagation(); setRenamingPath(node.path); }}
        onContextMenu={(e) => {
          e.preventDefault();
          onSelect(node.path);
          onOpenContextMenu(e.clientX, e.clientY, node);
        }}
      >
        <span
          className={`twisty${hasChildren ? '' : ' twisty-leaf'}`}
          onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggleExpand(node.key); }}
        >
          {hasChildren ? (
            <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} />
          ) : (
            <span className="twisty-dot" />
          )}
        </span>

        <button
          className={`check${node.done ? ' check-done' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleDone(node.path, node.done); }}
          title={node.done ? 'Reopen' : 'Mark done'}
        >
          {node.done ? <Icon name="check" /> : null}
        </button>

        <span className="path-chip">{node.path}</span>

        {isActive && <Icon name="pinned" className="badge-active" title="Active item" />}

        {isRenaming ? (
          <input
            ref={renameRef}
            className="rename-input"
            defaultValue={node.title}
            onBlur={(e) => commitRename(e.currentTarget.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(e.currentTarget.value); }
              if (e.key === 'Escape') { e.preventDefault(); setRenamingPath(null); }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="title">{node.title}</span>
        )}

        {node.notes && node.notes.length > 0 && (
          <Icon name="note" className="badge-notes" title={`${node.notes.length} note(s)`} />
        )}

        <span className="row-actions">
          <button
            className="iconbtn"
            onClick={(e) => { e.stopPropagation(); onAddChild(node.path); }}
            title="Add child"
          >
            <Icon name="add" />
          </button>
          <button
            className="iconbtn"
            onClick={(e) => { e.stopPropagation(); onGoto(node.path); }}
            title="Make active (goto)"
          >
            <Icon name="target" />
          </button>
          <button
            className="iconbtn iconbtn-danger"
            onClick={(e) => { e.stopPropagation(); onDelete(node.path, hasChildren); }}
            title="Delete"
          >
            <Icon name="trash" />
          </button>
        </span>
      </div>

      {hasChildren && isExpanded && (
        <ul className="tree-children" role="group">
          {node.children!.map((c) => (
            <TreeRow key={c.key} {...props} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function rowContextMenu(
  node: TreeNode,
  p: TreeProps,
  setRenamingPath: (path: string | null) => void,
): ContextMenuEntry[] {
  const hasChildren = !!node.children && node.children.length > 0;
  return [
    { key: 'goto', label: 'Make active', icon: 'target', onClick: () => p.onGoto(node.path) },
    { key: 'rename', label: 'Rename…', icon: 'edit', shortcut: 'F2',
      onClick: () => setRenamingPath(node.path) },
    { key: 'note', label: 'Add note…', icon: 'note', onClick: () => p.onAddNote(node.path) },
    { separator: true },
    { key: 'toggleDone', label: node.done ? 'Reopen' : 'Mark done',
      icon: node.done ? 'circle-outline' : 'check',
      shortcut: 'Ctrl+Enter',
      onClick: () => p.onToggleDone(node.path, node.done) },
    { separator: true },
    { key: 'push-under', label: 'Push side-quest under', icon: 'arrow-down',
      onClick: () => p.onPushUnder(node.path) },
    { key: 'add-child', label: 'Add child', icon: 'add', onClick: () => p.onAddChild(node.path) },
    { key: 'add-before', label: 'Add sibling above', icon: 'arrow-up',
      onClick: () => p.onAddSiblingBefore(node.path) },
    { key: 'add-after', label: 'Add sibling below', icon: 'arrow-down',
      onClick: () => p.onAddSiblingAfter(node.path) },
    { separator: true },
    { key: 'delete', label: hasChildren ? 'Delete subtree…' : 'Delete', icon: 'trash',
      shortcut: 'Del', danger: true,
      onClick: () => p.onDelete(node.path, hasChildren) },
  ];
}
