// Internal context-menu chrome.
//
// Three components live here, all consumed only by NogginTree /
// NogginDetails; nothing in this file is part of @noggin/ui's public
// surface.
//
//   - `TreeRowContextMenu` (default) — Radix-backed right-click menu
//     wrapping a tree row. Used when the host did NOT pass a
//     `renderContextMenu` override on NogginTree.
//
//   - `DetailsActionsMenu` (default) — Radix DropdownMenu for the
//     details-pane kebab button. Used when the host did NOT pass a
//     `renderContextMenu` override on NogginDetails.
//
//   - `TreeContextMenuView` (override path) — the legacy hand-rolled
//     popup. Kept so the `renderContextMenu` override contract
//     (`{ position, entries, onClose }`) still has a primitive a host
//     can mount if it doesn't want to bring its own popup.
//
// Why two code paths? Radix's context-menu / dropdown-menu primitives
// own their own open/close state and anchor placement — the natural
// path is to wrap each row in `<ContextMenu.Root>` and let Radix
// handle right-click, position, focus management, ARIA, and keyboard
// nav. That's the default. When a host wants to render something
// platform-specific (a real VS Code menu, a mobile sheet, etc.), the
// imperative API gives them position + items and gets out of the
// way; we mount `TreeContextMenuView` for that flow if they want our
// chrome, but they're free to render whatever.

import { useEffect, useRef, type ReactNode } from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Icon } from '../Icon';
import { cn } from '../cn';
import type { TreeContextMenuEntry, TreeContextMenuRenderProps } from '../types';

// ── Radix-backed default: tree-row right-click ─────────────────────────

/**
 * Wraps a single tree row. The row's children act as the trigger; the
 * popup is mounted lazily by Radix when the user right-clicks.
 *
 * The `entries` array is recomputed lazily via the `buildEntries`
 * callback on every open, so we don't pay the cost of building every
 * row's menu items on every render.
 */
export function TreeRowContextMenu({ buildEntries, onOpen, children }: {
  buildEntries: () => readonly TreeContextMenuEntry[];
  /** Called the first moment the user opens this row's menu. Hosts use
   *  this to also push the row into selection. */
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <ContextMenuPrimitive.Root
      onOpenChange={(open) => { if (open) onOpen(); }}
    >
      <ContextMenuPrimitive.Trigger asChild>
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content className="ctx-menu" collisionPadding={8}>
          {buildEntries().map(renderRadixContextItem)}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}

// ── Radix-backed default: details-pane kebab ───────────────────────────

/**
 * The actions-button on NogginDetails. Trigger is the kebab button
 * itself; Radix anchors the popup to that button automatically and
 * handles dismiss / keyboard nav.
 */
export function DetailsActionsMenu({ buildEntries, triggerProps }: {
  buildEntries: () => readonly TreeContextMenuEntry[];
  triggerProps?: { title?: string; ariaLabel?: string };
}) {
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger
        type="button"
        className="noggin-details-iconbtn noggin-details-menu-btn"
        title={triggerProps?.title ?? 'Actions'}
        aria-label={triggerProps?.ariaLabel ?? 'Item actions'}
      >
        <Icon name="kebab-vertical" />
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          className="ctx-menu"
          align="end"
          sideOffset={2}
          collisionPadding={8}
        >
          {buildEntries().map(renderRadixDropdownItem)}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

function renderRadixContextItem(entry: TreeContextMenuEntry) {
  if (entry.kind === 'separator') {
    return <ContextMenuPrimitive.Separator key={entry.key} className="ctx-sep" />;
  }
  return (
    <ContextMenuPrimitive.Item
      key={entry.key}
      className={cn('ctx-item', entry.danger && 'danger', entry.disabled && 'disabled')}
      disabled={entry.disabled}
      onSelect={(e) => {
        if (entry.disabled) { e.preventDefault(); return; }
        entry.onClick();
      }}
    >
      <ItemBody entry={entry} />
    </ContextMenuPrimitive.Item>
  );
}

function renderRadixDropdownItem(entry: TreeContextMenuEntry) {
  if (entry.kind === 'separator') {
    return <DropdownMenuPrimitive.Separator key={entry.key} className="ctx-sep" />;
  }
  return (
    <DropdownMenuPrimitive.Item
      key={entry.key}
      className={cn('ctx-item', entry.danger && 'danger', entry.disabled && 'disabled')}
      disabled={entry.disabled}
      onSelect={(e) => {
        if (entry.disabled) { e.preventDefault(); return; }
        entry.onClick();
      }}
    >
      <ItemBody entry={entry} />
    </DropdownMenuPrimitive.Item>
  );
}

function ItemBody({ entry }: { entry: Extract<TreeContextMenuEntry, { kind: 'item' }> }) {
  return (
    <>
      <span className="ctx-icon">
        {entry.icon ? <Icon name={entry.icon} /> : null}
      </span>
      <span className="ctx-label">{entry.label}</span>
      {entry.shortcut && <span className="ctx-shortcut">{entry.shortcut}</span>}
    </>
  );
}

// ── Imperative override path: legacy hand-rolled popup ─────────────────
//
// Only used when a host passes `renderContextMenu` to NogginTree or
// NogginDetails AND chooses to render this chrome (instead of their
// own native popup). The tree/details component still tracks open
// state imperatively in this path; Radix is bypassed.

export function TreeContextMenuView({ position, entries, onClose }: TreeContextMenuRenderProps) {
  const ref = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Defer to avoid swallowing the click that opened the menu.
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onDocClick);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Clamp to viewport so the menu doesn't render off-screen.
  const viewportW = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const viewportH = typeof window === 'undefined' ? 768 : window.innerHeight;
  const estimatedW = 220;
  const estimatedH = entries.length * 26 + 8;
  const left = Math.min(position.x, viewportW - estimatedW - 8);
  const top = Math.min(position.y, viewportH - estimatedH - 8);

  return (
    <ul className="ctx-menu" ref={ref} role="menu" style={{ left, top, position: 'fixed' }}>
      {entries.map((entry) => {
        if (entry.kind === 'separator') {
          return <li key={entry.key} className="ctx-sep" role="separator" />;
        }
        return (
          <li
            key={entry.key}
            className={cn('ctx-item', entry.danger && 'danger', entry.disabled && 'disabled')}
            role="menuitem"
            onClick={() => {
              if (entry.disabled) return;
              entry.onClick();
            }}
          >
            <span className="ctx-icon">
              {entry.icon ? <Icon name={entry.icon} /> : null}
            </span>
            <span className="ctx-label">{entry.label}</span>
            {entry.shortcut && <span className="ctx-shortcut">{entry.shortcut}</span>}
          </li>
        );
      })}
    </ul>
  );
}
