// buildTreeMenuEntries — canonical right-click / kebab menu builder.
//
// Both NogginTree and NogginDetails call this for their built-in
// menus; it's also exported publicly so hosts that render the menu
// in a native popup (e.g. VS Code's `showQuickPick`) get exactly
// the same entries the components would have shown.
//
// Pure builder — no React, no menu chrome. The caller passes the
// action surface (so each entry's `onClick` is pre-wired) and the
// item the menu anchors to (by key). Disabled state and labels are
// derived against the action's bound noggin at call time.

import type { NogginActions, NogginItemKey } from './actions.js';
import type { NogginNode, TreeContextMenuEntry } from './types.js';
import { projectTree, findByPath } from './treeOps.js';

/**
 * @public
 * Options for {@link buildTreeMenuEntries}.
 */
export interface BuildTreeMenuEntriesOptions {
  /** The action surface to fire from each entry. */
  readonly actions: NogginActions;
  /** The item the menu anchors to. */
  readonly key: NogginItemKey;
  /**
   * Optional callback for the "Rename" entry. Renaming is a UI
   * state change (flip the row into inline-rename mode), not a
   * verb call \u2014 components hook this to their own renamingPath
   * sink. Omit if the menu shouldn't fire any callback for rename
   * (the entry still renders, it's just inert).
   */
  readonly onRequestRename?: (key: NogginItemKey) => void;
}

/**
 * @public
 * Build the canonical context-menu entries for an item.
 *
 * Returns an empty array when the item isn't present in the bound
 * noggin (e.g. the menu was opened on a row that's since been
 * removed).
 */
export function buildTreeMenuEntries(
  opts: BuildTreeMenuEntriesOptions,
): readonly TreeContextMenuEntry[] {
  const { actions, key, onRequestRename } = opts;
  const noggin = actions.noggin;
  const item = noggin.findByKey(key);
  if (!item) return [];

  const nodes = projectTree(noggin);
  const path = noggin.pathOf(item);
  if (!path) return [];
  const node = findByPath(nodes, path);
  if (!node) return [];

  const activeItem = noggin.active;
  const activeKey: NogginItemKey | null = activeItem ? activeItem.key : null;

  const isActive = key === activeKey;
  const hasKids = node.children.length > 0;
  const parent = findParent(nodes, node.path);
  const siblings = parent?.children ?? nodes;
  const idx = siblings.findIndex((s) => s.path === node.path);
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < siblings.length - 1;
  const hasParent = !!parent;

  return [
    entry('activate', isActive ? 'Already active' : 'Make active', 'pinned',
      { shortcut: 'Alt+Enter', disabled: isActive }, () => { void actions.activate(key); }),
    sep('sep-after-activate'),

    entry('add-after', 'Add sibling after', 'add',
      { shortcut: 'Enter' }, () => { void actions.addSiblingAfter(key); }),
    entry('add-before', 'Add sibling before', 'add',
      { shortcut: 'Shift+Enter' }, () => { void actions.addSiblingBefore(key); }),
    entry('add-child', 'Add child', 'add',
      { shortcut: 'Ctrl+Enter' }, () => { void actions.addChild(key); }),
    entry('add-first', 'Add as first sibling', 'add',
      { shortcut: 'Ctrl+Home' }, () => { void actions.addFirstSibling(key); }),
    entry('add-last', 'Add as last sibling', 'add',
      { shortcut: 'Ctrl+End' }, () => { void actions.addLastSibling(key); }),
    sep('sep-after-add'),

    entry('move-up', 'Move up', 'arrow-up',
      { shortcut: 'Alt+\u2191', disabled: !hasPrev }, () => { void actions.moveUp(key); }),
    entry('move-down', 'Move down', 'arrow-down',
      { shortcut: 'Alt+\u2193', disabled: !hasNext }, () => { void actions.moveDown(key); }),
    entry('move-first', 'Move to first', 'arrow-up',
      { shortcut: 'Alt+Home', disabled: !hasPrev }, () => { void actions.moveToFirst(key); }),
    entry('move-last', 'Move to last', 'arrow-down',
      { shortcut: 'Alt+End', disabled: !hasNext }, () => { void actions.moveToLast(key); }),
    entry('demote', 'Demote (indent)', 'arrow-right',
      { shortcut: 'Tab', disabled: !hasPrev }, () => { void actions.demote(key); }),
    entry('promote', 'Promote (outdent)', 'arrow-left',
      { shortcut: 'Shift+Tab', disabled: !hasParent }, () => { void actions.promote(key); }),
    sep('sep-after-move'),

    entry('rename', 'Rename', 'edit',
      { shortcut: 'F2' }, () => { onRequestRename?.(key); }),
    entry('toggle-done', node.done ? 'Reopen' : 'Mark done',
      node.done ? 'circle-outline' : 'check',
      { shortcut: 'Space' }, () => { void actions.toggleDone(key, node.done); }),
    sep('sep-before-delete'),

    entry('delete', hasKids ? 'Delete (with children)\u2026' : 'Delete', 'trash',
      { shortcut: 'Delete', danger: true }, () => { void actions.delete(key, hasKids); }),
  ];
}

// ── Helpers ────────────────────────────────────────────────────────

function entry(
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
