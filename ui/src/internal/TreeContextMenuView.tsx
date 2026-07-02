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
      modal={false}
      onOpenChange={(open) => { if (open) onOpen(); }}
    >
      <ContextMenuPrimitive.Trigger asChild>
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          className="ctx-menu"
          collisionPadding={8}
          // Stop arrow / Home / End / character keys from bubbling out
          // of the menu into ancestors. react-arborist (the tree's
          // virtualizer) listens for the same keys to drive tree
          // navigation; without this, opening the menu and pressing
          // ArrowDown moves the tree's selection AND dismisses the
          // menu instead of moving to the next menu item.
          onKeyDown={(e) => { e.stopPropagation(); }}
        >
          {buildEntries().map((e, i, a) => renderRadixContextItem(e, i, a))}
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
          // See TreeRowContextMenu.
          onKeyDown={(e) => { e.stopPropagation(); }}
        >
          {buildEntries().map((e, i, a) => renderRadixDropdownItem(e, i, a))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

/**
 * Generic dropdown-trigger Radix wrapper. Hosts that want the same
 * popup chrome the rest of the app uses pass a custom `trigger`
 * (any focusable element) and a `buildEntries` callback. The result
 * is a click-to-open menu anchored to that trigger.
 *
 * Distinct from `DetailsActionsMenu` because that one hard-codes
 * the kebab button shape; this one lets the host bring its own
 * trigger (an icon button in the sidebar, a header chip, etc.).
 */
export function DropdownActionsMenu({ buildEntries, trigger, align = 'end' }: {
  buildEntries: () => readonly TreeContextMenuEntry[];
  /** The trigger element. Use `asChild`-shaped JSX (a single element
   *  the menu can attach event handlers + ARIA to). Wrap an icon
   *  button here. */
  trigger: ReactNode;
  /** Radix `align` for the popup. Default `'end'` (right edge of the
   *  trigger). Pass `'start'` to anchor at the left edge instead. */
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        {trigger}
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          className="ctx-menu"
          align={align}
          sideOffset={4}
          collisionPadding={8}
          onKeyDown={(e) => { e.stopPropagation(); }}
        >
          {buildEntries().map((e, i, a) => renderRadixDropdownItem(e, i, a))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

function renderRadixContextItem(entry: TreeContextMenuEntry, idx: number, arr: readonly TreeContextMenuEntry[]) {
  if (entry.kind === 'separator') {
    return <ContextMenuPrimitive.Separator key={entry.key} className="ctx-sep" />;
  }
  if (entry.kind === 'header') {
    return <div key={entry.key} className="ctx-header" role="presentation">{entry.label}</div>;
  }
  if (entry.kind === 'checkbox') {
    return (
      <ContextMenuPrimitive.CheckboxItem
        key={entry.key}
        className={cn('ctx-item', 'ctx-item-toggle', entry.disabled && 'disabled')}
        disabled={entry.disabled}
        checked={entry.checked}
        onCheckedChange={(next) => entry.onCheckedChange(next === true)}
        // Toggle items keep the menu open so users can flip several
        // at once. preventDefault on Select.
        onSelect={(e) => e.preventDefault()}
      >
        <ToggleBody label={entry.label} shortcut={entry.shortcut} />
      </ContextMenuPrimitive.CheckboxItem>
    );
  }
  if (entry.kind === 'radio') {
    // Radix's RadioGroup wants to wrap a contiguous block of radios.
    // We render lazily: the FIRST radio in a same-groupKey run wraps
    // the rest in a single RadioGroup; subsequent entries from the
    // same group return null and get pulled in by the wrapper.
    const isFirstInGroup = idx === 0 || arr[idx - 1].kind !== 'radio' || (arr[idx - 1] as { groupKey: string }).groupKey !== entry.groupKey;
    if (!isFirstInGroup) return null;
    const groupEntries: typeof entry[] = [];
    for (let i = idx; i < arr.length; i++) {
      const e = arr[i];
      if (e.kind !== 'radio' || e.groupKey !== entry.groupKey) break;
      groupEntries.push(e);
    }
    return (
      <ContextMenuPrimitive.RadioGroup
        key={entry.key}
        value={entry.groupValue}
        onValueChange={(v) => entry.onSelectValue(v)}
      >
        {groupEntries.map((g) => (
          <ContextMenuPrimitive.RadioItem
            key={g.key}
            value={g.value}
            className={cn('ctx-item', 'ctx-item-toggle', g.disabled && 'disabled')}
            disabled={g.disabled}
            onSelect={(e) => e.preventDefault()}
          >
            <ToggleBody label={g.label} />
          </ContextMenuPrimitive.RadioItem>
        ))}
      </ContextMenuPrimitive.RadioGroup>
    );
  }
  // kind === 'item'
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

function renderRadixDropdownItem(entry: TreeContextMenuEntry, idx: number, arr: readonly TreeContextMenuEntry[]) {
  if (entry.kind === 'separator') {
    return <DropdownMenuPrimitive.Separator key={entry.key} className="ctx-sep" />;
  }
  if (entry.kind === 'header') {
    return <div key={entry.key} className="ctx-header" role="presentation">{entry.label}</div>;
  }
  if (entry.kind === 'checkbox') {
    return (
      <DropdownMenuPrimitive.CheckboxItem
        key={entry.key}
        className={cn('ctx-item', 'ctx-item-toggle', entry.disabled && 'disabled')}
        disabled={entry.disabled}
        checked={entry.checked}
        onCheckedChange={(next) => entry.onCheckedChange(next === true)}
        onSelect={(e) => e.preventDefault()}
      >
        <ToggleBody label={entry.label} shortcut={entry.shortcut} />
      </DropdownMenuPrimitive.CheckboxItem>
    );
  }
  if (entry.kind === 'radio') {
    const isFirstInGroup = idx === 0 || arr[idx - 1].kind !== 'radio' || (arr[idx - 1] as { groupKey: string }).groupKey !== entry.groupKey;
    if (!isFirstInGroup) return null;
    const groupEntries: typeof entry[] = [];
    for (let i = idx; i < arr.length; i++) {
      const e = arr[i];
      if (e.kind !== 'radio' || e.groupKey !== entry.groupKey) break;
      groupEntries.push(e);
    }
    return (
      <DropdownMenuPrimitive.RadioGroup
        key={entry.key}
        value={entry.groupValue}
        onValueChange={(v) => entry.onSelectValue(v)}
      >
        {groupEntries.map((g) => (
          <DropdownMenuPrimitive.RadioItem
            key={g.key}
            value={g.value}
            className={cn('ctx-item', 'ctx-item-toggle', g.disabled && 'disabled')}
            disabled={g.disabled}
            onSelect={(e) => e.preventDefault()}
          >
            <ToggleBody label={g.label} />
          </DropdownMenuPrimitive.RadioItem>
        ))}
      </DropdownMenuPrimitive.RadioGroup>
    );
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

/** Body for checkbox + radio entries. The check mark itself is
 *  painted via CSS on `[data-state="checked"]` so we don't need to
 *  branch on state here. */
function ToggleBody({ label, shortcut }: { label: string; shortcut?: string }) {
  return (
    <>
      <span className="ctx-icon ctx-icon-tick" aria-hidden="true" />
      <span className="ctx-label">{label}</span>
      {shortcut && <span className="ctx-shortcut">{shortcut}</span>}
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
        if (entry.kind === 'header') {
          return <li key={entry.key} className="ctx-header" role="presentation">{entry.label}</li>;
        }
        if (entry.kind === 'checkbox') {
          return (
            <li
              key={entry.key}
              className={cn('ctx-item', 'ctx-item-toggle', entry.disabled && 'disabled')}
              role="menuitemcheckbox"
              aria-checked={entry.checked}
              data-state={entry.checked ? 'checked' : 'unchecked'}
              onClick={() => { if (!entry.disabled) entry.onCheckedChange(!entry.checked); }}
            >
              <span className="ctx-icon ctx-icon-tick" aria-hidden="true" />
              <span className="ctx-label">{entry.label}</span>
              {entry.shortcut && <span className="ctx-shortcut">{entry.shortcut}</span>}
            </li>
          );
        }
        if (entry.kind === 'radio') {
          const checked = entry.value === entry.groupValue;
          return (
            <li
              key={entry.key}
              className={cn('ctx-item', 'ctx-item-toggle', entry.disabled && 'disabled')}
              role="menuitemradio"
              aria-checked={checked}
              data-state={checked ? 'checked' : 'unchecked'}
              onClick={() => { if (!entry.disabled) entry.onSelectValue(entry.value); }}
            >
              <span className="ctx-icon ctx-icon-tick" aria-hidden="true" />
              <span className="ctx-label">{entry.label}</span>
            </li>
          );
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
