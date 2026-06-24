// Recents list — lives entirely in the renderer now that the engine
// also lives in the renderer. Persisted to localStorage so users see
// the same recents across launches without the main process needing
// to own the file.
//
// As of this revision, the store also caches each noggin's last-known
// active path + title. The currently-open noggin pushes those into
// the cache on every active-change so when the user closes it and
// comes back later, the sidebar still shows where they were.

import { useCallback, useEffect, useState } from 'react';

const KEY = 'noggin:recents:v2';
const MAX = 12;

interface StoredRecent {
  location: string;
  lastOpenedAt: string;
  /** Last-known active path inside this noggin, or null if nothing was active. */
  activePath?: string | null;
  /** Last-known title of the active item. Cached so the sidebar can
   *  render it even when this noggin is closed. */
  activeTitle?: string | null;
}

export interface RecentEntry {
  location: string;
  label: string;
  lastOpenedAt: string;
  exists: boolean;
  activePath: string | null;
  activeTitle: string | null;
}

function read(): StoredRecent[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((r: unknown): r is StoredRecent => {
      const o = r as Record<string, unknown> | null;
      return !!o && typeof o.location === 'string' && typeof o.lastOpenedAt === 'string';
    });
  } catch { return []; }
}

function write(list: StoredRecent[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* ignore */ }
}

function labelFor(location: string): string {
  const cleaned = location.replace(/^memory:\/\//, '').replace(/^file:\/\//i, '');
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || cleaned;
}

function exists(_location: string): boolean { return true; }

export interface UseRecents {
  recents: RecentEntry[];
  bump(location: string): void;
  remove(location: string): void;
  refresh(): void;
  /** Update the cached active state for `location`. */
  setActive(location: string, activePath: string | null, activeTitle: string | null): void;
}

export function useRecents(currentLocation: string | null): UseRecents {
  const [recents, setRecents] = useState<StoredRecent[]>(() => read());

  const refresh = useCallback(() => setRecents(read()), []);

  // Bump current location to the top whenever it changes.
  useEffect(() => {
    if (!currentLocation) return;
    const now = new Date().toISOString();
    const existing = read().find((r) => r.location === currentLocation);
    const next = [
      {
        location: currentLocation,
        lastOpenedAt: now,
        activePath: existing?.activePath ?? null,
        activeTitle: existing?.activeTitle ?? null,
      },
      ...read().filter((r) => r.location !== currentLocation),
    ].slice(0, MAX);
    write(next);
    setRecents(next);
  }, [currentLocation]);

  const bump = useCallback((location: string) => {
    const now = new Date().toISOString();
    const existing = read().find((r) => r.location === location);
    const next = [
      {
        location,
        lastOpenedAt: now,
        activePath: existing?.activePath ?? null,
        activeTitle: existing?.activeTitle ?? null,
      },
      ...read().filter((r) => r.location !== location),
    ].slice(0, MAX);
    write(next);
    setRecents(next);
  }, []);

  const remove = useCallback((location: string) => {
    const next = read().filter((r) => r.location !== location);
    write(next);
    setRecents(next);
  }, []);

  const setActive = useCallback((location: string, activePath: string | null, activeTitle: string | null) => {
    const cur = read();
    const idx = cur.findIndex((r) => r.location === location);
    if (idx < 0) return;
    // Skip writes when nothing actually changed — avoids burning a
    // localStorage write + re-render on every onDidChange tick.
    if (cur[idx].activePath === activePath && cur[idx].activeTitle === activeTitle) return;
    const next = cur.slice();
    next[idx] = { ...next[idx], activePath, activeTitle };
    write(next);
    setRecents(next);
  }, []);

  const projected: RecentEntry[] = recents.map((r) => ({
    location: r.location,
    label: labelFor(r.location),
    lastOpenedAt: r.lastOpenedAt,
    exists: exists(r.location),
    activePath: r.activePath ?? null,
    activeTitle: r.activeTitle ?? null,
  }));

  return { recents: projected, bump, remove, refresh, setActive };
}
