// NogginList — the public React component for rendering a
// multi-noggin browser (recents, bookmarks, "these are open").
//
// Layout:
//   ┌────────────────────────────────────────────────┐
//   │ NOGGINS                                  +  ⋮  │
//   ├────────────────────────────────────────────────┤
//   │ ● mynoggin.yaml      [FILE]  ◐ 3h  📋 ×        │
//   │    /1/3  📋                                    │
//   │    abc123  📋                                  │
//   │    the active item                             │
//   │ ○ sample.yaml        [URL]   ◐ 1h              │
//   └────────────────────────────────────────────────┘
//
// Controlled by a {@link NogginListStore} (the controller), a
// {@link NogginProviderTypeReader} (the catalog), and a controlled
// {@link NogginListPrefs} pair. Persistence is the host's job.
//
// The component is internally responsible for:
//   - drag-reorder (when prefs.sortMode === 'manual')
//   - keyboard navigation (↑/↓/Home/End/Enter/Delete/Esc)
//   - per-row copy-to-clipboard chips
//   - per-row remove chip (× button on hover)
//   - the `+` button's add menu (with a Recent submenu)
//   - the `⋮` kebab menu (show toggles + sort + filter +
//     close-active-entry + host-supplied extras)
//   - the empty state (no entries vs. all-filtered-out)
//
// What the host wires:
//   - `store.add(uri)` + `store.setSelectedIds([uri])` when a
//     noggin opens
//   - `store.observe(uri, noggin).dispose` to bridge live state
//   - `onActivate(uri)` to do whatever "open this row" means
//   - persistence of `store.entries` (via `onStateChange`) + prefs
//
// Browser-pure: the component imports types from `@noggin/engine`
// only (the store API does the runtime work), so adding the
// component to a host's bundle graph does NOT pull engine code in.

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Icon } from './Icon.js';
import { cn } from './cn.js';
import { DropdownActionsMenu } from './internal/TreeContextMenuView.js';
import { applyListPrefs, completionStatusOf } from './applyListPrefs.js';
import type {
  NogginListEntry,
  NogginListPrefs,
  NogginListStore,
} from './nogginListStore.js';
import type {
  NogginProviderType,
  NogginProviderTypeReader,
} from './nogginProviderRegistry.js';
import type { MRUReader } from './mruManager.js';
import type { TreeContextMenuEntry } from './types.js';

/**
 * @public
 * Per-slot class-name overrides for {@link NogginList}.
 *
 * Each listed slot is composed with the built-in class via
 * space-separated concatenation — the consumer's class wins on any
 * conflicting property. Slots not listed are not stable override
 * points; target their built-in class name directly in CSS.
 *
 * Mirrors the {@link NogginTreeClassNames} pattern.
 */
export interface NogginListClassNames {
  /** The outer `<aside>` wrapper. */
  root?: string;
  /** Every row, regardless of state. Composes with rowSelected /
   *  rowMissing when applicable. */
  row?: string;
  /** Added to a row in `store.selectedIds`. */
  rowSelected?: string;
  /** Added to a row whose entry has `exists === false`. */
  rowMissing?: string;
  /** The label text element. */
  label?: string;
  /** The provider-type badge. */
  badge?: string;
  /** The completion gauge wrapper. */
  gauge?: string;
  /** Each copy-to-clipboard button. */
  copyButton?: string;
  /** The per-row remove (×) button. */
  removeButton?: string;
  /** The list's empty-state container. */
  emptyState?: string;
}

/**
 * @public
 * Props for {@link NogginList}.
 */
export interface NogginListProps {
  store: NogginListStore;

  /** Provider catalog. Read-only — the component never registers. */
  providers: NogginProviderTypeReader;

  /** Controlled prefs. The component never mutates these directly;
   *  toggles + radios fire `onPrefsChange` with the next value. */
  prefs: NogginListPrefs;
  onPrefsChange: (next: NogginListPrefs) => void;

  /** Fires when the user clicks (or Enter-activates) a row. The
   *  host should open the noggin and call
   *  `store.setSelectedIds([uri])` if it wants the row highlighted
   *  (the open-state convention in v1). */
  onActivate: (uri: string) => void;

  /** Wired into the kebab as "Close active noggin" — only shown
   *  when at least one row is selected AND this handler is
   *  provided. Named "Entry" to disambiguate from closing the
   *  active *item* inside a noggin. */
  onCloseActiveEntry?: () => void;

  /** Optional extra entries appended to the kebab menu's footer.
   *  Uses the same {@link TreeContextMenuEntry} vocabulary as the
   *  tree (items, checkboxes, radios, headers, separators). */
  extraMenuEntries?: readonly TreeContextMenuEntry[];

  /**
   * Optional MRU reader. When supplied, drives:
   *   - the "Recent ▸" submenu under the `+` button (top N URIs
   *     by last-touched time).
   *   - `'newest'` / `'oldest'` sort modes in `prefs.sortMode`.
   *   - the per-row "3h" relative-time chip.
   *
   * Without it, the submenu and relative-time chip are hidden,
   * and `'newest'`/`'oldest'` fall back to manual order. Hosts
   * still control the sort radios in the kebab menu via their
   * own prefs — the component never mutates the MRU.
   *
   * The reader is intentionally narrower than {@link MRUManager}:
   * the component never `touch()`es. The recommended wiring is a
   * single bridge from the store's `onUriActivity` option into
   * `mru.touch(uri)` \u2014 that way MRU stamps track actual noggin
   * changes only, and pure open/focus does not shift the timeline.
   */
  recent?: MRUReader;

  classNames?: NogginListClassNames;
  /** Override the "no entries" copy. */
  emptyState?: ReactNode;
  /** Override the header title (default: "Noggins"). */
  headerTitle?: ReactNode;
}

const MAX_RECENT_SUBMENU = 5;

/**
 * @public
 * The public list component. See module header for the visual
 * contract and ownership rules.
 */
export function NogginList(props: NogginListProps): ReactElement {
  const {
    store, providers, prefs, onPrefsChange, onActivate, onCloseActiveEntry,
    extraMenuEntries, classNames, emptyState, headerTitle = 'Noggins',
    recent: mru,
  } = props;

  // Re-render on any store / provider-registry / mru change. We keep
  // the subscription out of `useSyncExternalStore` because the
  // natural snapshot (entries) doesn't change reference on
  // selection-only updates and would miss those renders.
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => store.onDidChange(bump).dispose, [store]);
  useEffect(() => providers.onDidChange(bump).dispose, [providers]);
  useEffect(() => (mru ? mru.onDidChange(bump).dispose : undefined), [mru]);

  // Refresh relative-time labels ("now" / "4m" / "1h") on their own
  // heartbeat so they age in-place without an external nudge.
  useEffect(() => {
    const id = window.setInterval(bump, 5_000);
    return () => window.clearInterval(id);
  }, []);

  const entries = store.entries;
  const selected = new Set(store.selectedIds);

  // ── Undo-remove (deferred commit) ──────────────────────────────
  // Clicking × on a row doesn't call `store.remove` immediately —
  // instead we hide the row from the visible list, drop it from
  // selection if it was active, and schedule the real `store.remove`
  // for 10 s later. That interval is what the toast counts down.
  //
  // Why deferred: hosts can (and do — see the playground) wrap
  // `store.remove` with destructive cleanup like "purge the backing
  // storage slot". If we called `store.remove` immediately, undo
  // could restore only the list row while its underlying data was
  // already gone. Deferring means the host's remove hook fires only
  // when the user has actually committed to the deletion.
  //
  // Single-slot: a second × supersedes the first (the first pending
  // entry is committed permanently at that point).
  const undoTimerRef = useRef<number | null>(null);
  const [pendingUndo, setPendingUndo] = useState<{
    entry: NogginListEntry;
    /** Whether this URI was in `selectedIds` when × was pressed —
     *  used to restore selection on undo. */
    wasSelected: boolean;
  } | null>(null);

  const visible = useMemo(
    () => {
      const rows = applyListPrefs(entries, prefs, providers, mru);
      if (!pendingUndo) return rows;
      const hide = pendingUndo.entry.uri;
      return rows.filter((r) => r.uri !== hide);
    },
    [entries, prefs, providers, mru, pendingUndo],
  );

  // Type filter math — applied to every registered type, so adding
  // a new provider type the user hasn't seen always defaults to
  // visible (the `null` collapse below).
  const allSchemes = providers.types.map((t) => t.scheme);

  // Pickable providers drive the `+` menu. A provider with no
  // pickers (or an empty array) is omitted (e.g. memory://).
  const pickableProviders = providers.types.filter((t) => (t.pickers?.length ?? 0) > 0);

  // ── Drag-reorder state ─────────────────────────────────────────
  const [draggingUri, setDraggingUri] = useState<string | null>(null);
  // `undefined` = no drop target hovered yet; `null` = drop to end.
  const [dropBefore, setDropBefore] = useState<string | null | undefined>(undefined);

  const dragEnabled = prefs.sortMode === 'manual';

  // ── Undo-remove wiring ─────────────────────────────────────────
  // The state slot and the visible-list filter are declared above
  // (they need to be in scope before `visible` is memoised). The
  // rest of the machinery — timer, commit callback, unmount cleanup,
  // and the handlers wired into the row × / toast buttons — lives
  // here. Committing the previous pending removal before scheduling
  // a new one preserves the single-slot invariant.
  const commitPendingRef = useRef<() => void>(() => {});
  commitPendingRef.current = () => {
    const cur = pendingUndo;
    if (!cur) return;
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setPendingUndo(null);
    store.remove(cur.entry.uri);
  };
  useEffect(() => () => {
    // Component unmount: honour any pending remove by committing it,
    // so a hidden row doesn't reappear on remount.
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      commitPendingRef.current();
    }
  }, []);
  const handleRemove = useCallback((uri: string) => {
    const list = store.entries;
    const snapshot = list.find((e) => e.uri === uri);
    if (!snapshot) return;
    // Commit any previous pending removal first — the user is
    // moving on and we can only track one at a time.
    if (pendingUndo && pendingUndo.entry.uri !== uri) {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
        undoTimerRef.current = null;
      }
      store.remove(pendingUndo.entry.uri);
    }
    const wasSelected = store.selectedIds.includes(uri);
    if (wasSelected) {
      // Drop selection immediately so downstream views stop
      // targeting the noggin the user just tried to remove.
      const rest = store.selectedIds.filter((id) => id !== uri);
      store.setSelectedIds(rest);
    }
    setPendingUndo({ entry: snapshot, wasSelected });
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => {
      undoTimerRef.current = null;
      commitPendingRef.current();
    }, 10_000);
  }, [pendingUndo, store]);
  const undoRemove = useCallback(() => {
    if (!pendingUndo) return;
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    const { entry, wasSelected } = pendingUndo;
    setPendingUndo(null);
    if (wasSelected) store.setSelectedIds([entry.uri]);
  }, [pendingUndo, store]);
  const dismissUndo = useCallback(() => {
    commitPendingRef.current();
  }, []);

  // ── Keyboard navigation ────────────────────────────────────────
  const ulRef = useRef<HTMLUListElement | null>(null);

  const onUlKeyDown = useCallback((e: React.KeyboardEvent<HTMLUListElement>) => {
    if (visible.length === 0) return;
    const curUri = store.selectedIds[0] ?? null;
    const curIdx = curUri ? visible.findIndex((v) => v.uri === curUri) : -1;

    const moveTo = (idx: number): void => {
      const next = visible[Math.max(0, Math.min(visible.length - 1, idx))];
      if (next) store.setSelectedIds([next.uri]);
    };

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (curIdx < 0) moveTo(0);
        else moveTo((curIdx + 1) % visible.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (curIdx < 0) moveTo(visible.length - 1);
        else moveTo((curIdx - 1 + visible.length) % visible.length);
        break;
      case 'Home':
        e.preventDefault();
        moveTo(0);
        break;
      case 'End':
        e.preventDefault();
        moveTo(visible.length - 1);
        break;
      case 'Enter':
        if (curUri) {
          e.preventDefault();
          onActivate(curUri);
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (curUri) {
          e.preventDefault();
          store.remove(curUri);
        }
        break;
      case 'Escape':
        if (store.selectedIds.length > 0) {
          e.preventDefault();
          store.setSelectedIds([]);
        }
        break;
      default:
        break;
    }
  }, [visible, store, onActivate]);

  // ── `+` menu (add) ─────────────────────────────────────────────
  // The submenu is driven by the MRU reader (not the entry list)
  // so the user can re-open noggins they've previously removed
  // from the list. When no MRU is supplied, the submenu is
  // suppressed entirely.
  //
  // We deliberately don't memoize — `mru.recent()` is a cheap
  // computation and memoizing on the `mru` reference alone would
  // cache stale results when MRU contents change via touch() (the
  // useReducer(bump) above forces a re-render, but a useMemo on
  // [mru] would still hand back the stale array).
  const recentUris: readonly string[] = mru ? mru.recent(MAX_RECENT_SUBMENU) : [];

  // ── `⋮` kebab menu ─────────────────────────────────────────────
  const buildKebabEntries = useCallback((): readonly TreeContextMenuEntry[] => {
    const out: TreeContextMenuEntry[] = [];

    // Show / hide toggles.
    out.push({ kind: 'header', key: 'h-show', label: 'Show' });
    const showToggle = (
      k: 'showTitle' | 'showPath' | 'showKey' | 'showType' | 'wrapTitles',
      label: string,
    ): TreeContextMenuEntry => ({
      kind: 'checkbox',
      key: `show-${k}`,
      label,
      checked: prefs[k],
      onCheckedChange: () => onPrefsChange({ ...prefs, [k]: !prefs[k] }),
    });
    out.push(showToggle('showTitle', 'Active item title'));
    out.push(showToggle('showPath', 'Active item path'));
    out.push(showToggle('showKey', 'Active item key'));
    out.push(showToggle('showType', 'Item type'));
    out.push(showToggle('wrapTitles', 'Wrap long titles'));
    out.push({ kind: 'separator', key: 'sep-1' });

    // Sort. The newest/oldest modes only make sense when a MRU
    // reader is wired; otherwise the radios silently fall back to
    // manual, which is confusing. Hide them.
    out.push({ kind: 'header', key: 'h-sort', label: 'Sort' });
    const sortRadio = (value: NogginListPrefs['sortMode'], label: string): TreeContextMenuEntry => ({
      kind: 'radio',
      key: `sort-${value}`,
      groupKey: 'sort',
      groupValue: prefs.sortMode,
      value,
      label,
      onSelectValue: (v) => onPrefsChange({ ...prefs, sortMode: v as NogginListPrefs['sortMode'] }),
    });
    out.push(sortRadio('manual', 'Manual (drag to reorder)'));
    if (mru) {
      out.push(sortRadio('newest', 'Newest first'));
      out.push(sortRadio('oldest', 'Oldest first'));
    }
    out.push({ kind: 'separator', key: 'sep-2' });

    // Filter by type — only if there are types registered.
    if (providers.types.length > 0) {
      out.push({ kind: 'header', key: 'h-type', label: 'Filter by type' });
      const allowed = prefs.typeFilter ?? allSchemes;
      const allowedSet = new Set(allowed.map((s) => s.toLowerCase()));
      for (const p of providers.types) {
        const scheme = p.scheme.toLowerCase();
        const checked = prefs.typeFilter === null || allowedSet.has(scheme);
        out.push({
          kind: 'checkbox',
          key: `type-${scheme}`,
          label: p.label,
          checked,
          onCheckedChange: () => {
            // Apply the toggle against the explicit set (the current
            // visible-types snapshot). When every scheme ends up
            // checked, collapse back to null so future registrations
            // auto-show. When every scheme ends up unchecked, leave
            // the empty array (it's explicit "show nothing").
            const cur = prefs.typeFilter ?? allSchemes;
            const visible = new Set(cur.map((s) => s.toLowerCase()));
            if (visible.has(scheme)) visible.delete(scheme);
            else visible.add(scheme);
            const full = allSchemes.every((s) => visible.has(s.toLowerCase()))
              && visible.size === allSchemes.length;
            onPrefsChange({
              ...prefs,
              typeFilter: full ? null : Array.from(visible),
            });
          },
        });
      }
      out.push({ kind: 'separator', key: 'sep-3' });
    }

    // Filter by completion.
    out.push({ kind: 'header', key: 'h-completion', label: 'Filter by completion' });
    const completionRadio = (
      value: NogginListPrefs['completionFilter'],
      label: string,
    ): TreeContextMenuEntry => ({
      kind: 'radio',
      key: `completion-${value}`,
      groupKey: 'completion',
      groupValue: prefs.completionFilter,
      value,
      label,
      onSelectValue: (v) => onPrefsChange({
        ...prefs,
        completionFilter: v as NogginListPrefs['completionFilter'],
      }),
    });
    out.push(completionRadio('all', 'All noggins'));
    out.push(completionRadio('incomplete', 'In progress only'));
    out.push(completionRadio('complete', 'Complete only'));

    // Close-active-entry footer item.
    if (onCloseActiveEntry && store.selectedIds.length > 0) {
      out.push({ kind: 'separator', key: 'sep-close' });
      out.push({
        kind: 'item',
        key: 'close-active',
        label: 'Close open noggin',
        icon: 'close',
        shortcut: 'Ctrl+W',
        onClick: onCloseActiveEntry,
      });
    }

    // Host-supplied extras.
    if (extraMenuEntries && extraMenuEntries.length > 0) {
      out.push({ kind: 'separator', key: 'sep-extras' });
      for (const e of extraMenuEntries) out.push(e);
    }

    return out;
  }, [
    prefs, onPrefsChange, providers, allSchemes,
    onCloseActiveEntry, store.selectedIds.length, extraMenuEntries,
  ]);

  // ── Render ─────────────────────────────────────────────────────
  return (
    <aside
      className={cn(
        'noggin-list',
        prefs.wrapTitles && 'noggin-list--wrap-titles',
        classNames?.root,
      )}
    >
      <div className="noggin-list-header">
        <span className="noggin-list-header-title">{headerTitle}</span>
        <div className="noggin-list-header-actions">
          <AddMenu
            pickableProviders={pickableProviders}
            recentUris={recentUris}
            store={store}
            providers={providers}
            mru={mru ?? null}
            onActivate={onActivate}
          />
          <DropdownActionsMenu
            buildEntries={buildKebabEntries}
            trigger={
              <button
                type="button"
                className="iconbtn noggin-list-iconbtn"
                title="View options"
                aria-label="View options"
                aria-haspopup="menu"
              >
                <Icon name="kebab-vertical" />
              </button>
            }
          />
        </div>
      </div>

      {pendingUndo && (
        <div className="noggin-list-undo-toast" role="status" aria-live="polite">
          <span className="noggin-list-undo-toast-msg">
            Removed <strong>{pendingUndo.entry.label ?? labelFor(pendingUndo.entry.uri)}</strong>
          </span>
          <button
            type="button"
            className="noggin-list-undo-toast-btn"
            onClick={undoRemove}
          >
            Undo
          </button>
          <button
            type="button"
            className="noggin-list-undo-toast-dismiss iconbtn"
            title="Dismiss"
            aria-label="Dismiss"
            onClick={dismissUndo}
          >
            <Icon name="close" />
          </button>
        </div>
      )}

      <ul
        ref={ulRef}
        className="noggin-list-rows"
        tabIndex={0}
        role="listbox"
        aria-multiselectable={false}
        onKeyDown={onUlKeyDown}
        onDragOver={(e) => {
          if (!draggingUri || !dragEnabled) return;
          e.preventDefault();
          if (e.target === e.currentTarget) setDropBefore(null);
        }}
        onDrop={(e) => {
          if (!draggingUri || !dragEnabled) return;
          e.preventDefault();
          if (dropBefore !== undefined) store.reorder(draggingUri, dropBefore);
          setDraggingUri(null);
          setDropBefore(undefined);
        }}
      >
        {visible.length === 0 && (
          <li className={cn('noggin-list-empty', classNames?.emptyState)}>
            {entries.length === 0 ? (
              emptyState ?? <>No entries.<br />Click <strong>+</strong> to add one.</>
            ) : (
              <>No entries match the current filters.<br />Adjust them from the <strong>⋮</strong> menu.</>
            )}
          </li>
        )}
        {visible.map((entry) => (
          <Row
            key={entry.uri}
            entry={entry}
            isSelected={selected.has(entry.uri)}
            provider={providers.forUri(entry.uri)}
            prefs={prefs}
            classNames={classNames}
            mruLastUsedAt={mru ? mru.lastUsedAt(entry.uri) : null}
            dragEnabled={dragEnabled}
            isDragging={draggingUri === entry.uri}
            isDropBefore={
              dragEnabled
              && !!draggingUri
              && draggingUri !== entry.uri
              && dropBefore === entry.uri
            }
            onActivate={() => onActivate(entry.uri)}
            onRemove={() => handleRemove(entry.uri)}
            onDragStart={(e) => {
              if (!dragEnabled) { e.preventDefault(); return; }
              setDraggingUri(entry.uri);
              setDropBefore(undefined);
              e.dataTransfer.effectAllowed = 'move';
              try { e.dataTransfer.setData('text/plain', entry.uri); } catch { /* ignore */ }
            }}
            onDragEnd={() => {
              setDraggingUri(null);
              setDropBefore(undefined);
            }}
            onDragOver={(e) => {
              if (!draggingUri || draggingUri === entry.uri || !dragEnabled) return;
              e.preventDefault();
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              const inUpperHalf = (e.clientY - rect.top) < rect.height / 2;
              if (inUpperHalf) {
                setDropBefore(entry.uri);
              } else {
                const idx = visible.findIndex((x) => x.uri === entry.uri);
                const next = visible[idx + 1];
                setDropBefore(next ? next.uri : null);
              }
            }}
          />
        ))}
      </ul>
    </aside>
  );
}

// ── Internal subcomponents ───────────────────────────────────────────

interface RowProps {
  entry: NogginListEntry;
  isSelected: boolean;
  provider: NogginProviderType | null;
  prefs: NogginListPrefs;
  classNames?: NogginListClassNames;
  /** ISO-8601 UTC timestamp of last MRU touch for this entry, or
   *  null. When null, the row's relative-time chip is suppressed. */
  mruLastUsedAt: string | null;
  dragEnabled: boolean;
  isDragging: boolean;
  isDropBefore: boolean;
  onActivate: () => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent<HTMLLIElement>) => void;
}

function Row(props: RowProps): ReactElement {
  const {
    entry, isSelected, provider, prefs, classNames, mruLastUsedAt,
    dragEnabled, isDragging, isDropBefore,
    onActivate, onRemove, onDragStart, onDragEnd, onDragOver,
  } = props;

  const exists = entry.exists !== false;
  const label = entry.label ?? labelFor(entry.uri);
  const completion = completionStatusOf(entry);
  void completion;
  // Show the active-detail block when at least one detail pref is
  // on AND we have at least one piece of cached active data.
  const hasActiveData = entry.activeKey !== undefined
    || entry.activeTitle !== undefined
    || entry.activePath !== undefined;
  const showDetail = (prefs.showPath || prefs.showKey || prefs.showTitle) && hasActiveData;

  const badgeLabel = provider ? provider.scheme : '?';
  const badgeTone = provider?.badgeTone ?? 'neutral';

  return (
    <li
      draggable={dragEnabled}
      className={cn(
        'noggin-list-row',
        isSelected && 'noggin-list-row--selected',
        isSelected && classNames?.rowSelected,
        !exists && 'noggin-list-row--missing',
        !exists && classNames?.rowMissing,
        isDragging && 'noggin-list-row--dragging',
        isDropBefore && 'noggin-list-row--drop-before',
        classNames?.row,
      )}
      role="option"
      aria-selected={isSelected}
      onClick={onActivate}
      title={
        exists
          ? (dragEnabled ? entry.uri : `${entry.uri}\n(drag-reorder disabled in non-manual sort)`)
          : `${entry.uri} (missing)`
      }
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
    >
      <div className="noggin-list-row-top">
        <span
          className={cn('noggin-list-gauge', classNames?.gauge)}
          title={gaugeTooltip(entry.itemsTotal ?? null, entry.itemsDone ?? null)}
        >
          <CompletionGauge
            total={entry.itemsTotal ?? null}
            done={entry.itemsDone ?? null}
            size={14}
          />
        </span>
        <span className="noggin-list-name-cell">
          <span className={cn('noggin-list-label', classNames?.label)}>{label}</span>
          <CopyButton
            value={entry.uri}
            label="Copy URI"
            classNames={classNames}
          />
        </span>
        {prefs.showType && (
          <span
            className={cn(
              'noggin-list-badge',
              `noggin-list-badge--${badgeTone}`,
              classNames?.badge,
            )}
            title={
              provider
                ? `${provider.label}${provider.readOnly ? ' — read-only' : ''}`
                : `Unknown provider scheme: ${schemeOf(entry.uri)}`
            }
          >
            {badgeLabel}
          </span>
        )}
        {mruLastUsedAt && (
          <span className="noggin-list-meta">{relativeTime(mruLastUsedAt)}</span>
        )}
        <button
          type="button"
          className={cn('iconbtn', 'noggin-list-remove', classNames?.removeButton)}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove from list"
          aria-label="Remove from list"
          tabIndex={-1}
        >
          <Icon name="close" />
        </button>
      </div>
      {showDetail && (
        <div className="noggin-list-row-active">
          {prefs.showPath && entry.activePath && (
            <span className="noggin-list-row-active-row">
              <span className="noggin-list-active-path">{entry.activePath}</span>
              <CopyButton value={entry.activePath} label="Copy path" classNames={classNames} />
            </span>
          )}
          {prefs.showKey && (
            <span className="noggin-list-row-active-row">
              <span className="noggin-list-active-key">
                {entry.activeKey ?? <em className="noggin-list-active-key-missing">key not cached</em>}
              </span>
              {entry.activeKey && (
                <CopyButton value={entry.activeKey} label="Copy key" classNames={classNames} />
              )}
            </span>
          )}
          {prefs.showTitle && (
            <span className="noggin-list-active-title">
              {entry.activeTitle || <em className="noggin-list-active-title-missing">(no active item)</em>}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

interface AddMenuProps {
  pickableProviders: readonly NogginProviderType[];
  /** Top N URIs from the MRU. May contain URIs that are no longer
   *  in the store (deleted, never-added) — the submenu still
   *  surfaces them so the user can re-open. */
  recentUris: readonly string[];
  store: NogginListStore;
  providers: NogginProviderTypeReader;
  mru: MRUReader | null;
  onActivate: (uri: string) => void;
}

function AddMenu({
  pickableProviders, recentUris, store, providers, mru, onActivate,
}: AddMenuProps): ReactElement {
  // Resolve an MRU URI to whatever display data we still have:
  //   - if the entry is still in the store, use its label/etc.
  //   - otherwise, derive the label from the URI itself.
  const findEntry = (uri: string): NogginListEntry | null =>
    store.entries.find((e) => e.uri === uri) ?? null;
  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          className="iconbtn noggin-list-iconbtn"
          title="Add a noggin"
          aria-label="Add a noggin"
          aria-haspopup="menu"
        >
          <Icon name="add" />
        </button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          className="ctx-menu noggin-list-add-menu"
          align="end"
          sideOffset={4}
          collisionPadding={8}
        >
          {recentUris.length > 0 && (
            <DropdownMenuPrimitive.Sub>
              <DropdownMenuPrimitive.SubTrigger className="ctx-item">
                <Icon name="history" />
                <span className="ctx-item-label">
                  Recent
                  <span className="ctx-item-hint">
                    {recentUris.length === 1 ? '1 noggin' : `${recentUris.length} noggins`}
                  </span>
                </span>
                <Icon name="chevron-right" className="ctx-item-chev" />
              </DropdownMenuPrimitive.SubTrigger>
              <DropdownMenuPrimitive.Portal>
                <DropdownMenuPrimitive.SubContent
                  className="ctx-menu noggin-list-add-submenu"
                  sideOffset={4}
                  collisionPadding={8}
                >
                  {recentUris.map((uri) => {
                    const provider = providers.forUri(uri);
                    const entry = findEntry(uri);
                    const ts = mru?.lastUsedAt(uri) ?? null;
                    return (
                      <DropdownMenuPrimitive.Item
                        key={uri}
                        className="ctx-item"
                        onSelect={() => onActivate(uri)}
                      >
                        <Icon name={provider?.icon ?? 'file'} />
                        <span className="ctx-item-label">
                          {entry?.label ?? labelFor(uri)}
                          {ts && (
                            <span className="ctx-item-hint">
                              {relativeTime(ts)}
                              {provider ? ` · ${provider.scheme}` : ''}
                            </span>
                          )}
                        </span>
                      </DropdownMenuPrimitive.Item>
                    );
                  })}
                </DropdownMenuPrimitive.SubContent>
              </DropdownMenuPrimitive.Portal>
            </DropdownMenuPrimitive.Sub>
          )}
          {recentUris.length > 0 && pickableProviders.length > 0 && (
            <DropdownMenuPrimitive.Separator className="ctx-sep" />
          )}
          {pickableProviders.map((p, i) => (
            <div key={p.scheme}>
              {i > 0 && <DropdownMenuPrimitive.Separator className="ctx-sep" />}
              <div className="ctx-header" role="presentation">{p.label}</div>
              {(p.pickers ?? []).map((picker) => (
                <DropdownMenuPrimitive.Item
                  key={picker.id}
                  className="ctx-item"
                  onSelect={() => { void picker.onSelect(); }}
                >
                  <Icon name={picker.icon} />
                  <span className="ctx-item-label">
                    {picker.label}
                    {picker.hint && <span className="ctx-item-hint">{picker.hint}</span>}
                  </span>
                </DropdownMenuPrimitive.Item>
              ))}
            </div>
          ))}
          {pickableProviders.length === 0 && recentUris.length === 0 && (
            <div className="ctx-empty" role="presentation">
              No providers offer a picker.
            </div>
          )}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

function CopyButton({
  value, label, classNames,
}: {
  value: string;
  label: string;
  classNames?: NogginListClassNames;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={cn(
        'noggin-list-copy-btn',
        copied && 'noggin-list-copy-btn--copied',
        classNames?.copyButton,
      )}
      title={copied ? 'Copied!' : label}
      aria-label={label}
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        const done = () => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 900);
        };
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(value).then(done, () => fallbackCopy(value, done));
        } else {
          fallbackCopy(value, done);
        }
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} />
    </button>
  );
}

function fallbackCopy(value: string, onDone: () => void): void {
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    onDone();
  } catch {
    /* silently absorb — see plan: copy chips no-op when unsupported */
  }
}

// ── Gauge subcomponent ───────────────────────────────────────────────

interface CompletionGaugeProps {
  total: number | null;
  done: number | null;
  size?: number;
}

function CompletionGauge({ total, done, size = 14 }: CompletionGaugeProps): ReactElement {
  const c = size / 2;
  const r = size / 2 - 1;
  const known = typeof total === 'number' && typeof done === 'number';
  const fraction = known && total > 0 ? Math.min(1, done / total) : 0;
  const filled = known && total > 0 && done >= total;

  const tooltip = !known
    ? 'Completion: never observed'
    : total === 0
      ? 'Empty noggin (0 of 0)'
      : `${done} of ${total} done — ${Math.round(fraction * 100)}%`;

  return (
    <svg
      className={cn('noggin-gauge', filled && 'noggin-gauge--filled')}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={tooltip}
    >
      <title>{tooltip}</title>
      {known && fraction > 0 && (
        filled ? (
          <circle cx={c} cy={c} r={r - 0.5} className="noggin-gauge-slice" />
        ) : (
          <path d={piePath(c, c, r - 0.5, fraction)} className="noggin-gauge-slice" />
        )
      )}
      <circle cx={c} cy={c} r={r} fill="none" className="noggin-gauge-ring" strokeWidth={1} />
    </svg>
  );
}

function piePath(cx: number, cy: number, r: number, fraction: number): string {
  const angle = fraction * 2 * Math.PI;
  const startX = cx;
  const startY = cy - r;
  const endX = cx + r * Math.sin(angle);
  const endY = cy - r * Math.cos(angle);
  const largeArc = fraction > 0.5 ? 1 : 0;
  return [
    `M ${cx} ${cy}`,
    `L ${startX} ${startY}`,
    `A ${r} ${r} 0 ${largeArc} 1 ${endX} ${endY}`,
    'Z',
  ].join(' ');
}

// ── String helpers ───────────────────────────────────────────────────

function labelFor(uri: string): string {
  const cleaned = uri
    .replace(/^memory:\/\//i, '')
    .replace(/^file:\/\//i, '')
    .replace(/^https?:\/\//i, '');
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || cleaned;
}

function schemeOf(uri: string): string {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(uri);
  return m ? m[1].toLowerCase() : 'file';
}

function relativeTime(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - then);
    const m = Math.floor(diff / 60_000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

function gaugeTooltip(total: number | null, done: number | null): string {
  if (total === null || done === null) return 'Completion: never observed';
  if (total === 0) return 'Empty noggin (0 of 0 done)';
  const pct = Math.round((done / total) * 100);
  const open = total - done;
  if (done >= total) return `Complete — ${total} item${total === 1 ? '' : 's'}, all done (100%)`;
  return `${done} of ${total} done (${pct}%) — ${open} still open`;
}
