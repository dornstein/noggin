// Build the canonical tree-context-menu items for a given node.
//
// Both NogginTree (right-click on a row) and NogginDetails (actions
// button click) call this so the menu vocabulary is identical across
// every entry point. Pure: no React, no side effects.
//
// The items returned here are the *raw* canonical entries — their
// onClick dispatches the verb but does not dismiss the menu. The
// component that owns the menu state wraps each onClick to also
// close itself before passing entries to the renderer (default or
// host-supplied via `renderContextMenu`).

import type { NogginNode, TreeContextMenuEntry, TreeGesture } from '../types';

export interface BuildContextMenuItemsOpts {
  node: NogginNode;
  nodes: readonly NogginNode[];
  activeKey: string | null;
  onActivate: (path: string) => void;
  onGesture: (path: string, gesture: TreeGesture) => void;
}

export function buildContextMenuItems(opts: BuildContextMenuItemsOpts): TreeContextMenuEntry[] {
  const { node, nodes, activeKey, onActivate, onGesture } = opts;
  const path = node.path;
  const isActive = node.key === activeKey;
  const hasKids = node.children.length > 0;
  const parent = findParent(nodes, path);
  const siblings = parent?.children ?? nodes;
  const idx = siblings.findIndex((s) => s.path === path);
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < siblings.length - 1;
  const hasParent = !!parent;

  return [
    item('activate', isActive ? 'Already active' : 'Make active', 'pinned',
      { disabled: isActive }, () => onActivate(path)),
    sep('sep-after-activate'),

    item('add-after', 'Add sibling after', 'add',
      { shortcut: 'Enter' }, () => onGesture(path, 'addSiblingAfter')),
    item('add-before', 'Add sibling before', 'add',
      { shortcut: 'Shift+Enter' }, () => onGesture(path, 'addSiblingBefore')),
    item('add-child', 'Add child', 'add',
      { shortcut: 'Ctrl+Enter' }, () => onGesture(path, 'addChild')),
    item('add-first', 'Add as first sibling', 'add',
      { shortcut: 'Ctrl+Home' }, () => onGesture(path, 'addFirstSibling')),
    item('add-last', 'Add as last sibling', 'add',
      { shortcut: 'Ctrl+End' }, () => onGesture(path, 'addLastSibling')),
    sep('sep-after-add'),

    item('move-up', 'Move up', 'arrow-up',
      { shortcut: 'Alt+\u2191', disabled: !hasPrev }, () => onGesture(path, 'moveUp')),
    item('move-down', 'Move down', 'arrow-down',
      { shortcut: 'Alt+\u2193', disabled: !hasNext }, () => onGesture(path, 'moveDown')),
    item('move-first', 'Move to first', 'arrow-up',
      { shortcut: 'Alt+Home', disabled: !hasPrev }, () => onGesture(path, 'moveToFirst')),
    item('move-last', 'Move to last', 'arrow-down',
      { shortcut: 'Alt+End', disabled: !hasNext }, () => onGesture(path, 'moveToLast')),
    item('demote', 'Demote (indent)', 'arrow-right',
      { shortcut: 'Tab', disabled: !hasPrev }, () => onGesture(path, 'demote')),
    item('promote', 'Promote (outdent)', 'arrow-left',
      { shortcut: 'Shift+Tab', disabled: !hasParent }, () => onGesture(path, 'promote')),
    sep('sep-after-move'),

    item('rename', 'Rename', 'edit',
      { shortcut: 'F2' }, () => onGesture(path, 'rename')),
    item('toggle-done', node.done ? 'Reopen' : 'Mark done', node.done ? 'circle-outline' : 'check',
      { shortcut: 'Space' }, () => onGesture(path, 'toggleDone')),
    sep('sep-before-delete'),

    item('delete', hasKids ? 'Delete (with children)\u2026' : 'Delete', 'trash',
      { shortcut: 'Delete', danger: true }, () => onGesture(path, 'delete')),
  ];
}

function item(
  key: string,
  label: string,
  icon: string,
  opts: { shortcut?: string; disabled?: boolean; danger?: boolean },
  onClick: () => void,
): TreeContextMenuEntry {
  return {
    kind: 'item',
    key,
    label,
    icon,
    shortcut: opts.shortcut,
    disabled: opts.disabled,
    danger: opts.danger,
    onClick,
  };
}

function sep(key: string): TreeContextMenuEntry {
  return { kind: 'separator', key };
}

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
