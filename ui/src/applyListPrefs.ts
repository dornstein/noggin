// applyListPrefs — pure projection helper for NogginList.
//
// Takes the store's raw entries + the controlled prefs + the
// provider-registry reader and returns the filtered/sorted view
// the component renders. No I/O, no React; exported so hosts and
// tests can validate the projection logic outside the component.
//
// The component memoizes the result on (entries, prefs, providers, mru).
// Tests call this directly against any combination.

import type { NogginListEntry, NogginListPrefs } from './nogginListStore.js';
import type { NogginProviderTypeReader } from './nogginProviderRegistry.js';
import type { MRUReader } from './mruManager.js';

/**
 * @public
 * One of three completion statuses derived from cached counts.
 * `'unknown'` means we've never observed this noggin's contents
 * (so the gauge has no data); `'complete'` means every cached
 * item is done AND there's at least one item; `'incomplete'`
 * means at least one item is open. Empty noggins are
 * `'incomplete'` (an empty list of work is not work that's
 * done).
 */
export type NogginListCompletionStatus = 'complete' | 'incomplete' | 'unknown';

/** @public Pure: compute the completion status of an entry from
 *  its cached counts. */
export function completionStatusOf(entry: NogginListEntry): NogginListCompletionStatus {
  const total = entry.itemsTotal ?? null;
  const done = entry.itemsDone ?? null;
  if (total === null) return 'unknown';
  if (total === 0) return 'incomplete';
  if (done === null) return 'unknown';
  return done >= total ? 'complete' : 'incomplete';
}

/**
 * @public
 * Apply `prefs` to raw entries. Pure; no I/O, no React.
 *
 * Ordering:
 *   1. Filter by type (if `prefs.typeFilter` is non-null).
 *   2. Filter by completion (if `prefs.completionFilter !== 'all'`).
 *   3. Sort:
 *      - `'manual'`: preserve input order.
 *      - `'newest'` / `'oldest'`: requires an `mru` reader; sorts
 *        by `mru.lastUsedAt(uri)`. Entries with no recorded use
 *        sink to the end (`'newest'`) or front (`'oldest'`).
 *        Without an `mru`, both modes fall back to input order so
 *        hosts can offer the sort UI even when they haven't wired
 *        an MRU yet.
 */
export function applyListPrefs(
  entries: readonly NogginListEntry[],
  prefs: NogginListPrefs,
  providers: NogginProviderTypeReader,
  mru?: MRUReader,
): readonly NogginListEntry[] {
  let out = entries.slice();

  if (prefs.typeFilter !== null) {
    const allowed = new Set(prefs.typeFilter.map((s) => s.toLowerCase()));
    out = out.filter((e) => {
      const p = providers.forUri(e.uri);
      const scheme = (p?.scheme ?? schemeFor(e.uri)).toLowerCase();
      return allowed.has(scheme);
    });
  }

  if (prefs.completionFilter !== 'all') {
    out = out.filter((e) => {
      const status = completionStatusOf(e);
      // 'unknown' rolls into the 'incomplete' bucket — a noggin we
      // haven't observed is more likely in progress than done.
      if (prefs.completionFilter === 'complete') return status === 'complete';
      return status === 'incomplete' || status === 'unknown';
    });
  }

  if (mru && (prefs.sortMode === 'newest' || prefs.sortMode === 'oldest')) {
    // ISO UTC strings are lexicographically equivalent to
    // chronological order, so localeCompare on `Z` form is the
    // correct sort. Entries with no MRU entry get sentinel values
    // that drop them to the appropriate end.
    if (prefs.sortMode === 'newest') {
      out.sort((a, b) => {
        const ta = mru.lastUsedAt(a.uri) ?? '';
        const tb = mru.lastUsedAt(b.uri) ?? '';
        return tb.localeCompare(ta);
      });
    } else {
      out.sort((a, b) => {
        const ta = mru.lastUsedAt(a.uri) ?? '\uffff';
        const tb = mru.lastUsedAt(b.uri) ?? '\uffff';
        return ta.localeCompare(tb);
      });
    }
  }
  // 'manual' (or newest/oldest without an MRU) preserves caller
  // order.

  return out;
}

function schemeFor(uri: string): string {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(uri);
  return m ? m[1].toLowerCase() : 'file';
}
