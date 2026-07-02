// MRU manager — a small, self-contained registry of URI → ISO-8601 UTC
// "last used" timestamps, with bounded retention and MRU-first
// enumeration.
//
// Design model:
//   - The MRU owns *timestamps* and ordering. Nothing else.
//   - It does NOT know about the NogginListStore (the entry list is
//     a different concern with a different lifecycle).
//   - It does NOT subscribe to noggins. Hosts route activity into the
//     MRU through explicit `touch()` calls (see store.onUriActivity).
//   - Persistence is host-owned, same shape as createNogginListStore:
//     pass `initial` + `onStateChange` callbacks.
//
// All timestamps stored and surfaced by this module are UTC ISO-8601
// strings ending in `Z` (`Date.prototype.toISOString()`). Hosts are
// expected to convert to the user's locale only at render time.

const DEFAULT_MAX_ENTRIES = 10;

/**
 * @public
 * Read-only view of the MRU. Components that consume the order
 * (e.g. the NogginList "Recent" submenu) take this; only host
 * wiring code takes the full {@link MRUManager} surface.
 */
export interface MRUReader {
  /**
   * ISO-8601 UTC timestamp of the last touch for `uri`, or `null`
   * if the URI has never been touched (or has been forgotten).
   */
  lastUsedAt(uri: string): string | null;

  /**
   * Every known URI, MRU-first (most-recently-touched → oldest).
   * Length is bounded by the manager's `maxEntries` setting.
   */
  entries(): readonly string[];

  /**
   * Convenience: the first N entries from {@link entries}. Pass
   * `Infinity` (or omit) to get everything.
   */
  recent(limit?: number): readonly string[];

  /** Fires whenever entries / timestamps change. */
  onDidChange(cb: () => void): { dispose(): void };
}

/**
 * @public
 * Mutable side. Hosts call `touch()` to record activity, `forget()`
 * to drop a single URI from history, and `clear()` to wipe.
 *
 * Mutations to the MRU are never automatic — the MRU does not
 * subscribe to anything. The bridge between application events
 * (noggin opened, item edited, file watcher fire) and MRU
 * `touch()` lives in the host. Two natural bridges:
 *
 *   1. From {@link NogginListStore} via its `onUriActivity` option,
 *      which fires on every observed `onDidChange` of an opened
 *      noggin.
 *   2. From the host's `onActivate` handler in {@link NogginListProps},
 *      called when the user picks a row.
 */
export interface MRUManager extends MRUReader {
  /**
   * Record a use of `uri`. Defaults to "now" if `at` is omitted.
   * `at` is converted to UTC ISO via `Date#toISOString()` before
   * storage — callers can pass any `Date`.
   *
   * If touching pushes the total above `maxEntries`, the
   * least-recently-touched URI is evicted.
   */
  touch(uri: string, at?: Date): void;

  /** Drop a single URI from the log. No-op if missing. */
  forget(uri: string): void;

  /** Empty the log. */
  clear(): void;
}

/** @public Options for {@link createMRUManager}. */
export interface CreateMRUManagerOptions {
  /**
   * Initial state. Keys are URIs; values are UTC ISO-8601 strings.
   * Typically loaded from `localStorage` or a settings file at
   * construction time. Malformed entries (non-string values) are
   * silently dropped.
   */
  initial?: Readonly<Record<string, string>>;

  /**
   * Fired after every state change (touch / forget / clear /
   * eviction). Hosts persist on this. The shape mirrors
   * {@link NogginListStore}'s `onStateChange`.
   */
  onStateChange?: (state: { entries: Readonly<Record<string, string>> }) => void;

  /**
   * Maximum URIs retained. When a `touch()` would push the size
   * above this limit, the oldest entry is evicted. Defaults to
   * 10. Pass `Infinity` (or `0`) to disable eviction.
   */
  maxEntries?: number;

  /**
   * Determinism seam: clock used when `touch()` is called without an
   * explicit `at`. Defaults to `() => new Date()`. Tests inject a fixed
   * or advancing clock so recorded timestamps are reproducible.
   */
  now?: () => Date;
}

/**
 * @public
 * Build a fresh {@link MRUManager}.
 */
export function createMRUManager(opts: CreateMRUManagerOptions = {}): MRUManager {
  const cap = resolveCap(opts.maxEntries);

  // Internal store: uri → ISO timestamp. Insertion order is NOT the
  // truth — we sort by timestamp when reading. (We could maintain a
  // sorted structure, but the entry counts are tiny and the simpler
  // implementation is easier to verify.)
  const log = new Map<string, string>();
  if (opts.initial) {
    for (const [uri, ts] of Object.entries(opts.initial)) {
      if (typeof uri !== 'string' || !uri) continue;
      if (typeof ts !== 'string' || !ts) continue;
      // Normalise: accept anything Date can parse, re-emit as UTC.
      // localStorage (or any other host store) is user-controllable
      // through devtools, so we don't trust that inbound strings
      // are already canonical Z form — parse and re-emit.
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) continue;
      log.set(uri, d.toISOString());
    }
    enforceCap(log, cap);
  }

  const listeners = new Set<() => void>();

  const fireChange = (): void => {
    for (const cb of [...listeners]) {
      try { cb(); } catch (err) {
        // eslint-disable-next-line no-console
        console.error('mruManager: onDidChange listener threw', err);
      }
    }
  };

  const notifyState = (): void => {
    if (!opts.onStateChange) return;
    try {
      opts.onStateChange({ entries: Object.fromEntries(log) });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('mruManager: onStateChange threw', err);
    }
  };

  /** MRU-first ordering: sort descending by ISO string. UTC ISO
   *  strings are lexicographically equivalent to chronological
   *  order, so a string compare is enough. */
  const orderedUris = (): string[] => {
    const arr = Array.from(log.entries());
    arr.sort((a, b) => b[1].localeCompare(a[1]));
    return arr.map(([uri]) => uri);
  };

  return {
    lastUsedAt(uri: string): string | null {
      return log.get(uri) ?? null;
    },

    entries(): readonly string[] {
      return orderedUris();
    },

    recent(limit?: number): readonly string[] {
      const all = orderedUris();
      if (limit === undefined || !Number.isFinite(limit) || limit < 0) return all;
      return all.slice(0, Math.floor(limit));
    },

    onDidChange(cb: () => void): { dispose(): void } {
      listeners.add(cb);
      return { dispose: () => { listeners.delete(cb); } };
    },

    touch(uri: string, at?: Date): void {
      if (typeof uri !== 'string' || !uri) return;
      const when = at ?? (opts.now ? opts.now() : new Date());
      const iso = when.toISOString();
      // touch is idempotent against same-iso writes
      if (log.get(uri) === iso) return;
      log.set(uri, iso);
      enforceCap(log, cap);
      notifyState();
      fireChange();
    },

    forget(uri: string): void {
      if (!log.has(uri)) return;
      log.delete(uri);
      notifyState();
      fireChange();
    },

    clear(): void {
      if (log.size === 0) return;
      log.clear();
      notifyState();
      fireChange();
    },
  };
}

function resolveCap(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_ENTRIES;
  if (!Number.isFinite(raw)) return Infinity;
  if (raw <= 0) return Infinity;       // 0 = "no cap"; matches the doc
  return Math.floor(raw);
}

/**
 * Evict the oldest entries until the log fits inside `cap`. The
 * sort is by ISO string descending; we drop from the tail.
 */
function enforceCap(log: Map<string, string>, cap: number): void {
  if (!Number.isFinite(cap) || log.size <= cap) return;
  const sorted = Array.from(log.entries()).sort((a, b) => b[1].localeCompare(a[1]));
  for (let i = cap; i < sorted.length; i++) log.delete(sorted[i][0]);
}
