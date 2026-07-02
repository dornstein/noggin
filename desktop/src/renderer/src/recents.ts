// Recents list — lives entirely in the renderer now that the engine
// also lives in the renderer. Persisted to localStorage so users see
// the same recents across launches without the main process needing
// to own the file.
//
// Ordering model: the list is **manually ordered**. Selecting an
// existing noggin does NOT change its position; only:
//   - `bump(location)` for a brand-new entry adds it at the top,
//   - `reorder(location, beforeLocation | null)` moves an entry,
//   - `remove(location)` drops it.
// `lastOpenedAt` is still tracked so the "last seen 3d ago" meta is
// accurate, but it no longer drives row order.
//
// The store also caches each noggin's last-known active path + title.
// The currently-open noggin pushes those into the cache on every
// active-change so when the user closes it and comes back later,
// the sidebar still shows where they were.

import { useCallback, useEffect, useState } from 'react';

const KEY = 'noggin:recents:v3';
const LEGACY_KEY = 'noggin:recents:v2';
const MAX = 24;

interface StoredRecent {
  location: string;
  lastOpenedAt: string;
  /** Last-known active path inside this noggin, or null if nothing was active. */
  activePath?: string | null;
  /** Last-known active item key. Paths shift under structural
   *  changes; the key is the stable identifier. Cached so the
   *  sidebar can render the engine's stable id (alongside / instead
   *  of the path) even when this noggin is closed. */
  activeKey?: string | null;
  /** Last-known title of the active item. Cached so the sidebar can
   *  render it even when this noggin is closed. */
  activeTitle?: string | null;
  /** Total item count at the last snapshot. Cached so the sidebar's
   *  completion gauge has something to show for closed noggins. */
  itemsTotal?: number;
  /** Items marked `done` at the last snapshot. */
  itemsDone?: number;
}

export interface RecentEntry {
  location: string;
  label: string;
  lastOpenedAt: string;
  exists: boolean;
  activePath: string | null;
  activeKey: string | null;
  activeTitle: string | null;
  /** Total items (cached at last snapshot). null when we've never
   *  observed this noggin's contents. */
  itemsTotal: number | null;
  /** Items that are done (cached at last snapshot). null when total
   *  is null. */
  itemsDone: number | null;
}

function readStored(): StoredRecent[] {
  // Try v3 first; fall back to v2 (one-way migration) so users who
  // already have a recents list see it on their next launch.
  const fromV3 = readKey(KEY);
  if (fromV3) return fromV3;
  const fromV2 = readKey(LEGACY_KEY);
  if (fromV2) {
    // Migrate: persist under v3 immediately so we never reach back
    // for v2 again.
    write(fromV2);
    return fromV2;
  }
  return [];
}

function readKey(key: string): StoredRecent[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((r: unknown): r is StoredRecent => {
      const o = r as Record<string, unknown> | null;
      return !!o && typeof o.location === 'string' && typeof o.lastOpenedAt === 'string';
    });
  } catch { return null; }
}

function write(list: StoredRecent[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* ignore */ }
}

function labelFor(location: string): string {
  // Strip well-known scheme prefixes so the label is the
  // human-meaningful tail (filename for file://, scheme-less rest
  // for everything else).
  const cleaned = location
    .replace(/^memory:\/\//, '')
    .replace(/^file:\/\//i, '')
    .replace(/^https?:\/\//i, '');
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || cleaned;
}

function exists(_location: string): boolean { return true; }

export interface UseRecents {
  recents: RecentEntry[];
  /**
   * Add `location` to the list if it isn't already there. Existing
   * entries get their `lastOpenedAt` refreshed in place — their
   * position in the list does NOT change. New entries land at the
   * top so users see the just-added noggin where their eye is.
   */
  bump(location: string): void;
  remove(location: string): void;
  refresh(): void;
  /** Update the cached active state for `location`. No-op if the
   *  location isn't in the list. */
  setActive(location: string, activeKey: string | null, activePath: string | null, activeTitle: string | null): void;
  /** Update the cached completion stats for `location`. No-op if the
   *  location isn't in the list. Called from the host on every
   *  onDidChange so the sidebar gauge stays current. */
  setCompletion(location: string, itemsTotal: number, itemsDone: number): void;
  /**
   * Move `location` to immediately before `beforeLocation`. Pass
   * `beforeLocation = null` to move it to the end of the list. No-op
   * when either argument is missing from the list, or when the move
   * would be a no-op against current ordering.
   */
  reorder(location: string, beforeLocation: string | null): void;
}

export function useRecents(currentLocation: string | null): UseRecents {
  const [recents, setRecents] = useState<StoredRecent[]>(() => readStored());

  const refresh = useCallback(() => setRecents(readStored()), []);

  // Refresh `lastOpenedAt` for the current location whenever it
  // changes — but DO NOT reorder. The sidebar is manually ordered;
  // selecting an existing noggin should never jiggle the list.
  useEffect(() => {
    if (!currentLocation) return;
    const cur = readStored();
    const idx = cur.findIndex((r) => r.location === currentLocation);
    if (idx < 0) return;
    const next = cur.slice();
    next[idx] = { ...next[idx], lastOpenedAt: new Date().toISOString() };
    write(next);
    setRecents(next);
  }, [currentLocation]);

  const bump = useCallback((location: string) => {
    const cur = readStored();
    const idx = cur.findIndex((r) => r.location === location);
    const now = new Date().toISOString();
    if (idx >= 0) {
      // Existing entry: refresh its timestamp in place, do NOT
      // reorder. Same policy as the currentLocation effect above.
      const next = cur.slice();
      next[idx] = { ...next[idx], lastOpenedAt: now };
      write(next);
      setRecents(next);
      return;
    }
    // Brand-new entry: insert at the top so the newly-added noggin
    // appears where the user's attention is.
    const next = [
      { location, lastOpenedAt: now, activeKey: null, activePath: null, activeTitle: null },
      ...cur,
    ].slice(0, MAX);
    write(next);
    setRecents(next);
  }, []);

  const remove = useCallback((location: string) => {
    const next = readStored().filter((r) => r.location !== location);
    write(next);
    setRecents(next);
  }, []);

  const setActive = useCallback((location: string, activeKey: string | null, activePath: string | null, activeTitle: string | null) => {
    const cur = readStored();
    const idx = cur.findIndex((r) => r.location === location);
    if (idx < 0) return;
    // Skip writes when nothing actually changed — avoids burning a
    // localStorage write + re-render on every onDidChange tick.
    if (cur[idx].activeKey === activeKey
      && cur[idx].activePath === activePath
      && cur[idx].activeTitle === activeTitle) return;
    const next = cur.slice();
    next[idx] = { ...next[idx], activeKey, activePath, activeTitle };
    write(next);
    setRecents(next);
  }, []);

  const setCompletion = useCallback((location: string, itemsTotal: number, itemsDone: number) => {
    const cur = readStored();
    const idx = cur.findIndex((r) => r.location === location);
    if (idx < 0) return;
    if (cur[idx].itemsTotal === itemsTotal && cur[idx].itemsDone === itemsDone) return;
    const next = cur.slice();
    next[idx] = { ...next[idx], itemsTotal, itemsDone };
    write(next);
    setRecents(next);
  }, []);

  const reorder = useCallback((location: string, beforeLocation: string | null) => {
    const cur = readStored();
    const fromIdx = cur.findIndex((r) => r.location === location);
    if (fromIdx < 0) return;
    // Snapshot the dragged entry, drop it from the current list,
    // then re-insert at the target slot. Computing the target index
    // AFTER the drop avoids off-by-one bugs when dragging downwards.
    const dragged = cur[fromIdx];
    const without = cur.slice(0, fromIdx).concat(cur.slice(fromIdx + 1));
    let toIdx: number;
    if (beforeLocation === null) {
      toIdx = without.length; // end of the list
    } else {
      const anchorIdx = without.findIndex((r) => r.location === beforeLocation);
      if (anchorIdx < 0) return;  // anchor missing → bail
      toIdx = anchorIdx;
    }
    if (toIdx === fromIdx) return;  // no-op
    const next = without.slice(0, toIdx).concat(dragged, without.slice(toIdx));
    write(next);
    setRecents(next);
  }, []);

  const projected: RecentEntry[] = recents.map((r) => ({
    location: r.location,
    label: labelFor(r.location),
    lastOpenedAt: r.lastOpenedAt,
    exists: exists(r.location),
    activePath: r.activePath ?? null,
    activeKey: r.activeKey ?? null,
    activeTitle: r.activeTitle ?? null,
    itemsTotal: typeof r.itemsTotal === 'number' ? r.itemsTotal : null,
    itemsDone: typeof r.itemsDone === 'number' ? r.itemsDone : null,
  }));

  return { recents: projected, bump, remove, refresh, setActive, setCompletion, reorder };
}
