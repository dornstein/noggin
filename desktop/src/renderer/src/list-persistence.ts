// localStorage adapters for the desktop NogginList store, prefs,
// and MRU.
//
// Each `load*` reads a single key and returns whatever's there
// merged with sensible defaults; unknown fields are ignored by the
// type. Timestamps stored in the MRU are canonicalised by the MRU
// manager itself (UTC ISO), so this layer just moves bytes.

import type { NogginListEntry, NogginListPrefs } from '@noggin/ui';
import { defaultNogginListPrefs } from '@noggin/ui';

const ENTRIES_KEY = 'noggin:list:v1';
const PREFS_KEY = 'noggin:list-prefs:v1';
const MRU_KEY = 'noggin:mru:v1';

export function loadEntries(): readonly NogginListEntry[] {
  const raw = readArray(ENTRIES_KEY);
  if (!raw) return [];
  return raw.filter((e): e is NogginListEntry => typeof e?.uri === 'string' && !!e.uri);
}

export function saveEntries(entries: readonly NogginListEntry[]): void {
  try {
    localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries.slice(0, 50)));
  } catch { /* ignore quota */ }
}

export function loadPrefs(): NogginListPrefs {
  const raw = readObject(PREFS_KEY) ?? {};
  return { ...defaultNogginListPrefs, ...(raw as Partial<NogginListPrefs>) };
}

export function savePrefs(prefs: NogginListPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { /* ignore quota */ }
}

export function loadMRU(): Record<string, string> {
  const raw = readObject(MRU_KEY);
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [uri, ts] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof uri === 'string' && uri && typeof ts === 'string') out[uri] = ts;
  }
  return out;
}

export function saveMRU(entries: Readonly<Record<string, string>>): void {
  try {
    localStorage.setItem(MRU_KEY, JSON.stringify(entries));
  } catch { /* ignore quota */ }
}

function readArray(key: string): Array<Partial<NogginListEntry>> | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : null;
  } catch { return null; }
}

function readObject(key: string): unknown | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
