// NogginListStore — the controller behind the public NogginList
// component. Holds the *list* of entries (recents, bookmarks,
// "open these") plus selection, plus the lifecycle bridge between
// live `Noggin` instances and inert list rows.
//
// JS factory + no React. Matches `createNogginActions` so hosts
// have one shape to learn:
//
//   const store = useMemo(() => createNogginListStore({
//     initialEntries: loadEntries('noggin:list:v1'),
//     onStateChange: ({ entries }) => saveEntries('noggin:list:v1', entries),
//   }), []);
//
// The store owns three things:
//   1. `entries` — stored order, persisted on change.
//   2. `selectedIds` — currently-selected URIs (single-select in
//      v1; the array shape keeps multi-select an additive change).
//   3. `observations` — a hidden bridge between observe()'d
//      Noggins and the matching entry's cached state.
//
// Hosts wire it up like this:
//
//   useEffect(() => {
//     if (!noggin || !openState.location) return;
//     store.add(openState.location);
//     store.setSelectedIds([openState.location]);
//     return store.observe(openState.location, noggin).dispose;
//   }, [noggin, openState.location, store]);
//
// The observe() bridge auto-snapshots item counts + active key +
// active title on each `noggin.onDidChange` fire, so the host
// writes one effect and is done.

import type { Noggin } from '@noggin/engine';

/**
 * @public
 * Inert row data for one entry in a NogginList. The URI is the
 * canonical identifier — its scheme determines the provider type,
 * so there is no separate `providerType` field.
 *
 * Active-item caching (key + title + counts) lives on the entry so
 * the list can render a meaningful "last active" hint and a
 * completion gauge even when the underlying noggin is closed. The
 * active *path* is NOT cached: paths shift under structural
 * changes; the key + title together carry the user's mental
 * model.
 */
export interface NogginListEntry {
  /** Canonical URI. Stable across the entry's lifetime. */
  readonly uri: string;
  /** Display name. Defaults to the URI's tail at render time when
   *  absent. */
  readonly label?: string;
  /** Whether the underlying resource is reachable. Treated as
   *  `true` when absent. */
  readonly exists?: boolean;
  /** Cached snapshot of the noggin's active item.
   *  - `null`: we know there's no active item.
   *  - absent: we've never observed this noggin. */
  readonly activeKey?: string | null;
  readonly activeTitle?: string | null;
  /** Cached active item path. Updated on every observed change
   *  while the noggin is open; stale (or absent) for closed
   *  noggins. Hosts that don't want stale paths showing should
   *  turn off `prefs.showPath`. */
  readonly activePath?: string | null;
  /** Cached item counts for the completion gauge. Both `null` =
   *  unknown. */
  readonly itemsTotal?: number | null;
  readonly itemsDone?: number | null;
}

/**
 * @public
 * Persistence + initial-state options for `createNogginListStore`.
 */
export interface CreateNogginListStoreOptions {
  /** Initial entries to seed the store with. Typically read from
   *  localStorage at construction time. */
  initialEntries?: readonly NogginListEntry[];
  /**
   * Fires after every entries change. Not called for transient
   * state (`selectedIds`, internal observations). Hosts persist
   * whatever they want from here.
   *
   * If the callback throws, the store catches the error, logs a
   * warning, and rethrows it from the *next* mutation. The
   * in-memory mutation that triggered the failing save still
   * applies; this opportunistic-rethrow behaviour exists so
   * persistence errors are surfaced somewhere instead of being
   * swallowed.
   */
  onStateChange?: (state: { entries: readonly NogginListEntry[] }) => void;
  /**
   * Fires every time an observed noggin's state changes (i.e. on
   * every `noggin.onDidChange` event for any `uri` currently
   * `observe()`d). The single argument is the URI; the timestamp
   * is `new Date()` (UTC) at the moment the event fires.
   *
   * This is the bridge between the noggin's activity and an
   * external MRU manager. The store itself does NOT track
   * timestamps — hosts wire this callback to `mru.touch(uri)`
   * (or anything else they want) and keep the MRU as a separate
   * concern.
   *
   * The initial snapshot fired when `observe()` first attaches
   * does NOT fire `onUriActivity` — only subsequent state
   * changes do. That way, simply opening a noggin doesn't count
   * as activity; the activity signal corresponds to actual
   * change events.
   */
  onUriActivity?: (uri: string, at: Date) => void;
}

/**
 * @public
 * The list controller. Built via {@link createNogginListStore}.
 */
export interface NogginListStore {
  /** Raw entries in stored order. The component projects these
   *  through `applyListPrefs` for display; non-React callers can
   *  read this directly. */
  readonly entries: readonly NogginListEntry[];

  /** Currently-selected URIs. `[]` = nothing selected. v1 ships
   *  single-select UX (max length 1); the array shape makes
   *  multi-select an additive future change. */
  readonly selectedIds: readonly string[];

  /** Fires after any state change (entries, selection, or
   *  observation snapshots that produced a material change). */
  onDidChange(cb: () => void): { dispose: () => void };

  // ── Mutators ───────────────────────────────────────────────────
  /**
   * Insert or merge an entry.
   *  - If `uri` is missing, the entry is added at the top of the
   *    list with the supplied init fields.
   *  - If `uri` already exists, only the fields in `init` are
   *    merged in (no reorder).
   */
  add(uri: string, init?: Partial<NogginListEntry>): void;

  /** Remove the entry by URI. No-op if missing. Drops `uri` from
   *  `selectedIds` if present. */
  remove(uri: string): void;

  /**
   * Move `uri` to immediately before `beforeUri`. Pass `null` to
   * move to the end. No-op if `uri` is missing OR if `beforeUri`
   * is missing (and not null) OR if the move wouldn't change the
   * order. `onDidChange` only fires on a real reorder.
   */
  reorder(uri: string, beforeUri: string | null): void;

  /** Replace the selected-URIs array. Skips the change event if
   *  the new array equals the previous one. */
  setSelectedIds(ids: readonly string[]): void;

  // ── Lifecycle bridge ───────────────────────────────────────────
  /**
   * Subscribe to a live Noggin and project its state into the
   * matching entry. Reads `noggin.items`, `noggin.active`, and the
   * active item's title; never mutates the noggin.
   *
   * If no entry exists for `uri`, one is added implicitly. Hosts
   * should still call `add()` first if they have a label to set;
   * the implicit-add path is just a safety net.
   *
   * Calling `observe(uri, …)` twice for the same `uri` without
   * disposing the first throws.
   *
   * The returned `dispose()`:
   *   - unsubscribes from the noggin's `onDidChange`
   *   - clears the internal observation entry
   *   - removes `uri` from `selectedIds` if present
   */
  observe(uri: string, noggin: Noggin): { dispose: () => void };
}

interface Observation {
  noggin: Noggin;
  sub: { dispose(): void };
}

interface SnapshotFields {
  activeKey: string | null;
  activeTitle: string | null;
  activePath: string | null;
  itemsTotal: number | null;
  itemsDone: number | null;
}

function snapshot(noggin: Noggin): SnapshotFields {
  const items = noggin.items;
  let done = 0;
  for (const it of items) if (it.done) done += 1;
  const active = noggin.active;
  return {
    activeKey: active?.key ?? null,
    activeTitle: active?.title ?? null,
    activePath: active ? (noggin.pathOf(active) ?? null) : null,
    itemsTotal: items.length,
    itemsDone: done,
  };
}

function snapshotEquals(a: NogginListEntry, b: SnapshotFields): boolean {
  return (a.activeKey ?? null) === b.activeKey
    && (a.activeTitle ?? null) === b.activeTitle
    && (a.activePath ?? null) === b.activePath
    && (a.itemsTotal ?? null) === b.itemsTotal
    && (a.itemsDone ?? null) === b.itemsDone;
}

function selectionEquals(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Merge duplicate URIs in a persisted entry list. Order of first
 *  occurrence wins for position (so the sidebar order stays stable),
 *  later occurrences win for fields (they usually carry the fresher
 *  snapshot). Called only from the constructor to sanitise
 *  `initialEntries`; every mutation path afterwards is already
 *  URI-unique via `upsert`. */
function dedupeInitialEntries(input: readonly NogginListEntry[]): readonly NogginListEntry[] {
  const positions = new Map<string, number>();
  const out: NogginListEntry[] = [];
  for (const e of input) {
    const existing = positions.get(e.uri);
    if (existing === undefined) {
      positions.set(e.uri, out.length);
      out.push({ ...e });
    } else {
      // Later entries win for fields, but the position of the first
      // occurrence is preserved so drag-reorder history isn't
      // silently rewritten by loading a duplicated file.
      out[existing] = { ...out[existing], ...e, uri: e.uri };
    }
  }
  return out;
}

/**
 * @public
 * Build a {@link NogginListStore}.
 */
export function createNogginListStore(
  opts: CreateNogginListStoreOptions = {},
): NogginListStore {
  // Dedupe by URI. All mutation paths go through `upsert`, which
  // is O(n) URI-scan, so in-memory the invariant holds. Persistence,
  // though, is host-owned — a corrupt or racily-written JSON file can
  // arrive with duplicates. Loading them verbatim renders every dupe
  // as a distinct row, and every row that shares the "selected" URI
  // lights up as selected; onActivate then no-ops because the URI
  // is already open. Merging by URI (later entries win, since they
  // usually carry the fresher snapshot) makes the store self-heal
  // and — via `onStateChange` on any subsequent mutation — the
  // persisted state gets rewritten clean.
  let entries: readonly NogginListEntry[] = dedupeInitialEntries(opts.initialEntries ?? []);
  let selectedIds: readonly string[] = [];
  const observations = new Map<string, Observation>();
  const listeners = new Set<() => void>();

  // Pending error from a previous `onStateChange` throw. Rethrown
  // on the next mutation so hosts notice but the in-memory state
  // still settles.
  let pendingError: unknown = null;

  const fireDidChange = (): void => {
    for (const cb of [...listeners]) {
      try { cb(); } catch (err) {
        // eslint-disable-next-line no-console
        console.error('nogginListStore: onDidChange listener threw', err);
      }
    }
  };

  const notifyState = (): void => {
    if (!opts.onStateChange) return;
    try {
      opts.onStateChange({ entries });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('nogginListStore: onStateChange threw; will rethrow on next mutation', err);
      pendingError = err;
    }
  };

  const drainPendingError = (): void => {
    if (pendingError === null) return;
    const err = pendingError;
    pendingError = null;
    throw err;
  };

  const upsert = (uri: string, init?: Partial<NogginListEntry>): void => {
    const idx = entries.findIndex((e) => e.uri === uri);
    if (idx >= 0) {
      // Merge only the supplied fields; don't reorder.
      const merged = { ...entries[idx], ...(init ?? {}), uri };
      const next = entries.slice();
      next[idx] = merged;
      entries = next;
    } else {
      const fresh: NogginListEntry = { uri, ...(init ?? {}) };
      entries = [fresh, ...entries];
    }
  };

  const removeUri = (uri: string): boolean => {
    const idx = entries.findIndex((e) => e.uri === uri);
    if (idx < 0) return false;
    entries = entries.slice(0, idx).concat(entries.slice(idx + 1));
    return true;
  };

  const dropSelection = (uri: string): boolean => {
    if (!selectedIds.includes(uri)) return false;
    selectedIds = selectedIds.filter((id) => id !== uri);
    return true;
  };

  return {
    get entries(): readonly NogginListEntry[] { return entries; },
    get selectedIds(): readonly string[] { return selectedIds; },

    onDidChange(cb: () => void): { dispose: () => void } {
      listeners.add(cb);
      return { dispose: () => { listeners.delete(cb); } };
    },

    add(uri: string, init?: Partial<NogginListEntry>): void {
      drainPendingError();
      const before = entries;
      upsert(uri, init);
      if (before !== entries) {
        notifyState();
        fireDidChange();
      }
    },

    remove(uri: string): void {
      drainPendingError();
      const removed = removeUri(uri);
      const dropped = dropSelection(uri);
      // Also dispose any observation for this URI so the bridge
      // stays in sync. Hosts that explicitly call observe(...).
      // dispose() before remove() get a silent no-op here.
      const obs = observations.get(uri);
      if (obs) {
        try { obs.sub.dispose(); } catch { /* ignore */ }
        observations.delete(uri);
      }
      if (removed) notifyState();
      if (removed || dropped) fireDidChange();
    },

    reorder(uri: string, beforeUri: string | null): void {
      drainPendingError();
      const fromIdx = entries.findIndex((e) => e.uri === uri);
      if (fromIdx < 0) return;
      const dragged = entries[fromIdx];
      const without = entries.slice(0, fromIdx).concat(entries.slice(fromIdx + 1));
      let toIdx: number;
      if (beforeUri === null) {
        toIdx = without.length;
      } else {
        const anchorIdx = without.findIndex((e) => e.uri === beforeUri);
        if (anchorIdx < 0) return;
        toIdx = anchorIdx;
      }
      // No-op detection: produces same array order as the current
      // entries. fromIdx === toIdx covers most cases; we also need
      // to catch the "move to end while already last" path.
      if (toIdx === fromIdx) return;
      const next = without.slice(0, toIdx).concat(dragged, without.slice(toIdx));
      // Double-check the result actually differs (paranoia against
      // off-by-one edges).
      let same = true;
      for (let i = 0; i < next.length; i++) {
        if (next[i].uri !== entries[i].uri) { same = false; break; }
      }
      if (same) return;
      entries = next;
      notifyState();
      fireDidChange();
    },

    setSelectedIds(ids: readonly string[]): void {
      drainPendingError();
      const next = ids.slice();
      if (selectionEquals(selectedIds, next)) return;
      selectedIds = next;
      fireDidChange();
    },

    observe(uri: string, noggin: Noggin): { dispose: () => void } {
      drainPendingError();
      if (observations.has(uri)) {
        throw new Error(`nogginListStore: already observing "${uri}"; dispose the previous observation first`);
      }

      // Implicit upsert. We don't mark it with onStateChange because
      // the implicit row is meant to be filled in via subsequent
      // add() calls; firing a save on every observe() round-trip
      // would churn persistence on every window focus.
      if (!entries.some((e) => e.uri === uri)) {
        const before = entries;
        upsert(uri);
        if (before !== entries) {
          notifyState();
          // No fireDidChange here — the snapshot pass below will
          // either fire one (with the snapshot deltas applied) or
          // do so itself in the absence of changes by issuing the
          // first observation.
        }
      }

      const reproject = (): void => {
        const idx = entries.findIndex((e) => e.uri === uri);
        if (idx < 0) return;
        const snap = snapshot(noggin);
        if (snapshotEquals(entries[idx], snap)) return;
        const merged: NogginListEntry = { ...entries[idx], ...snap };
        const next = entries.slice();
        next[idx] = merged;
        entries = next;
        notifyState();
        fireDidChange();
      };

      // Initial snapshot so the entry's cached fields reflect the
      // observed noggin immediately. Providers keep their in-memory
      // doc in sync with backing storage automatically (watchers +
      // polling safety net), so the reproject sees the same state
      // the noggin's accessors already know about.
      reproject();

      // Subsequent change events both reproject AND fire activity
      // to the host (the activity hook is the bridge into MRU
      // managers / analytics / anything else that cares about
      // "this noggin just moved"). The initial snapshot above
      // deliberately does NOT fire activity — a fresh observe()
      // is just attachment, not a user-meaningful event.
      const sub = noggin.onDidChange(() => {
        reproject();
        if (opts.onUriActivity) {
          try { opts.onUriActivity(uri, new Date()); }
          catch (err) {
            // eslint-disable-next-line no-console
            console.warn('nogginListStore: onUriActivity threw', err);
          }
        }
      });
      observations.set(uri, { noggin, sub });

      return {
        dispose: () => {
          const obs = observations.get(uri);
          if (!obs || obs.noggin !== noggin) return;
          observations.delete(uri);
          try { obs.sub.dispose(); } catch { /* ignore */ }
          const dropped = dropSelection(uri);
          if (dropped) fireDidChange();
        },
      };
    },
  };
}

// ── Preferences ──────────────────────────────────────────────────────

/**
 * @public
 * View preferences for a NogginList. Hosts manage these as plain
 * React state (or any other channel they want) and feed them back
 * via the component's controlled `prefs` + `onPrefsChange` props.
 *
 * Decoupled from the store because they're a separate concern: how
 * a particular surface chooses to *view* the list, not what's *in*
 * the list. Two NogginList instances backed by the same store can
 * render with different prefs (a compact dropdown + an expanded
 * sidebar, for example).
 */
export interface NogginListPrefs {
  sortMode: 'manual' | 'newest' | 'oldest';
  /** `null` = show all installed types. Otherwise an explicit
   *  subset of provider schemes. */
  typeFilter: readonly string[] | null;
  completionFilter: 'all' | 'complete' | 'incomplete';
  /** Show the active item's title (cached for closed noggins). */
  showTitle: boolean;
  /** Show the active item's key (cached for closed noggins). */
  showKey: boolean;
  /** Show the active item's path. Only renders when the noggin is
   *  observed; paths aren't cached for closed noggins. */
  showPath: boolean;
  /** Show the provider-type badge (scheme) at the end of each row. */
  showType: boolean;
  wrapTitles: boolean;
}

/** @public The default `NogginListPrefs` hosts can merge with
 *  loaded persisted prefs to migrate forward. */
export const defaultNogginListPrefs: NogginListPrefs = {
  sortMode: 'manual',
  typeFilter: null,
  completionFilter: 'all',
  showTitle: true,
  showKey: false,
  showPath: true,
  showType: true,
  wrapTitles: false,
};
