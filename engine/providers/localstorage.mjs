// LocalStorage provider for noggin.
//
// Registers a provider under the `localstorage://` scheme. Useful for
// browser surfaces (docs site playground, sandboxed renderers) that
// want noggins to persist across reloads without a filesystem.
//
// Storage layout:
//   localStorage[`noggin:${slot}`] = <yaml document>
//
// A `localstorage://my-slot` URI maps to the `noggin:my-slot` key.
// The full key (`noggin:` prefix included) is the on-disk identifier;
// the URI is the user-facing one.
//
// Staying in sync with the slot has two layers:
//
//   1. **Cross-tab, event-driven.** The browser fires DOM `storage`
//      events on every *other* same-origin tab whenever our slot is
//      mutated. The provider listens and diff-fires `onDidChange`
//      immediately, so tabs stay in sync with near-zero latency.
//
//   2. **Same-tab, polling.** Same-tab writes NEVER dispatch the DOM
//      `storage` event (browsers explicitly exclude the writing
//      window). If some out-of-band code path in the same tab
//      (dev-tools, a second script, another `Storage` handle to the
//      same origin) mutates the slot, the event-driven layer can't
//      see it. So the provider also runs a periodic `getItem` +
//      diff; drift is bounded by the poll interval (default 500ms).
//
// Same-tab writes issued through `apply()` update state synchronously
// inside the verb, so the poll is a no-op in the common case — the
// snapshot it reads matches the cached doc and no event fires.

import {
  applyOps,
  bindNogginVerbs,
  providers,
  freezeDocument,
  documentsEqual,
  diffDocuments,
  normalizeDocument,
  NogginError,
  SCHEMA_VERSION,
  resolvePath,
  tryResolvePath,
  pathOf,
  childrenOf,
} from '../noggin-api.mjs';
import { fromYaml, toYaml } from '../serializers/yaml.mjs';

const KEY_PREFIX = 'noggin:';

/** @public Default slot used when `openNoggin('localstorage://')` is
 *  called with no path. */
export const DEFAULT_STORAGE_SLOT = 'playground';

/** Default poll interval (ms) for same-tab drift detection. */
const DEFAULT_POLL_INTERVAL_MS = 500;

/** @public Registered for the `localstorage://` scheme. */
export const localStorageProvider = {
  scheme: 'localstorage',
  async open(location, opts) {
    const slot = parseSlot(location);
    const storage = (opts && opts.storage) || globalThis.localStorage;
    if (!storage) {
      throw new NogginError('localstorage: no Storage available (set opts.storage or run in a browser)', {
        code: 'no-location',
        exitCode: 2,
      });
    }
    return new LocalStorageNoggin(slot, storage, opts || {});
  },
};

providers.register(localStorageProvider);

/**
 * @public
 * Convenience: open a localStorage-backed noggin without going through
 * the provider + URL scheme dance.
 *
 *   const n = await openLocalStorageNoggin({ slot: 'groceries' });
 *
 * Equivalent to `openNoggin('localstorage://groceries')` modulo the
 * `opts.storage` override (which lets tests pass a custom Storage
 * impl such as `node-localstorage`).
 */
export async function openLocalStorageNoggin(opts = {}) {
  return localStorageProvider.open(opts.slot ?? DEFAULT_STORAGE_SLOT, opts);
}

/**
 * @public
 * Resolve the localStorage key a `localstorage://` URI maps to. Used
 * by hosts that want to clear / inspect the underlying storage
 * directly. Returns the full key, including the `noggin:` prefix.
 */
export function localStorageKeyFor(location) {
  return KEY_PREFIX + parseSlot(location);
}

function parseSlot(location) {
  if (!location) return DEFAULT_STORAGE_SLOT;
  const m = /^localstorage:(?:\/\/)?(.*)$/i.exec(String(location));
  const slot = m ? m[1] : String(location);
  // Strip a leading slash so `localstorage:///foo` and
  // `localstorage://foo` both map to the same slot.
  return slot.replace(/^\/+/, '') || DEFAULT_STORAGE_SLOT;
}

class LocalStorageNoggin {
  constructor(slot, storage, opts) {
    this._slot = slot;
    this._storage = storage;
    this.location = `localstorage://${slot}`;
    this.readOnly = false;
    this._listeners = new Set();
    this._errorListeners = new Set();
    this._disposed = false;
    this._tail = Promise.resolve();
    this._doc = freezeDocument(this._load());

    this.onDidChange = (handler) => {
      this._listeners.add(handler);
      return { dispose: () => this._listeners.delete(handler) };
    };
    this.onDidError = (handler) => {
      this._errorListeners.add(handler);
      return { dispose: () => this._errorListeners.delete(handler) };
    };

    // Cross-tab sync via the DOM `storage` event. Skipped when no
    // window is available (Node + node-localstorage stubs).
    this._onStorage = null;
    const win = opts.window
      ?? (storage && storage.__window)
      ?? (typeof window !== 'undefined' ? window : null);
    if (win && typeof win.addEventListener === 'function') {
      this._win = win;
      this._onStorage = (e) => {
        if (!e || e.key !== this._fullKey()) return;
        if (e.storageArea && e.storageArea !== this._storage) return;
        this._reconcile();
      };
      win.addEventListener('storage', this._onStorage);
    }

    // Same-tab drift poll. Runs alongside the DOM `storage` listener;
    // catches out-of-band writes from other code paths in the current
    // tab (dev-tools, secondary scripts, node-localstorage shims that
    // don't fire `storage`). Pass `pollIntervalMs: 0` to disable.
    const pollMs = typeof opts.pollIntervalMs === 'number'
      ? opts.pollIntervalMs
      : DEFAULT_POLL_INTERVAL_MS;
    this._pollTimer = null;
    if (pollMs > 0 && typeof setInterval === 'function') {
      this._pollTimer = setInterval(() => this._reconcile(), pollMs);
      // Node's setInterval returns a Timeout with `unref()`; browsers
      // return a number. Guard the call so we don't crash in
      // browsers.
      if (this._pollTimer && typeof this._pollTimer.unref === 'function') {
        this._pollTimer.unref();
      }
    }

    bindNogginVerbs(this);
  }

  // ── Read accessors ──────────────────────────────────────────────────
  get items() { return this._doc.items; }
  get active() {
    return this._doc.active ? findByKey(this._doc.items, this._doc.active) : null;
  }
  get roots() { return childrenOf({ items: this._doc.items }, null); }

  findByKey(k) { return k ? findByKey(this._doc.items, k) : null; }
  childrenOf(k) { return childrenOf({ items: this._doc.items }, k ?? null); }
  pathOf(item) { return pathOf({ items: this._doc.items }, item); }
  resolvePath(p) {
    return resolvePath({ items: this._doc.items, active: this._doc.active }, p);
  }
  tryResolvePath(p) {
    return tryResolvePath({ items: this._doc.items, active: this._doc.active }, p);
  }

  describe() { return this.location; }

  // ── Mutator ─────────────────────────────────────────────────────────
  apply(ops) {
    if (this._disposed) {
      return Promise.reject(new NogginError('localstorage: noggin disposed', { code: 'disposed', exitCode: 2 }));
    }
    const run = async () => {
      const before = this._doc;
      const doc = applyOps(this._load(), ops);
      if (documentsEqual(before, doc)) return;
      this._save(doc);
      const next = freezeDocument(doc);
      const changes = diffDocuments(before, next);
      this._doc = next;
      this._fireChange(changes);
    };
    this._tail = this._tail.then(run, run);
    return this._tail;
  }

  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    try { await this._tail; } catch { /* swallow */ }
    this._listeners.clear();
    this._errorListeners.clear();
    if (this._win && this._onStorage) {
      this._win.removeEventListener('storage', this._onStorage);
      this._onStorage = null;
    }
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  // ── Convenience methods (browser hosts use these) ──────────────────

  /**
   * Read the current document directly. Useful for tabs that need a
   * snapshot without going through the verb API.
   */
  snapshot() { return this._load(); }

  /**
   * Wipe the slot. Fires onDidChange so subscribers re-render empty.
   */
  async reset() {
    if (this._disposed) return;
    const run = async () => {
      const before = this._doc;
      this._storage.removeItem(this._fullKey());
      const next = freezeDocument(this._load());
      const changes = diffDocuments(before, next);
      this._doc = next;
      if (changes.length > 0) this._fireChange(changes);
    };
    this._tail = this._tail.then(run, run);
    return this._tail;
  }

  /**
   * Replace the slot's document wholesale. Used by demo "load sample
   * data" buttons. Round-trips through YAML to validate + normalize.
   */
  async loadDocument(doc) {
    if (this._disposed) return;
    const run = async () => {
      const before = this._doc;
      const normalized = normalizeDocument(fromYaml(toYaml(doc)));
      this._save(normalized);
      const next = freezeDocument(normalized);
      const changes = diffDocuments(before, next);
      this._doc = next;
      if (changes.length > 0) this._fireChange(changes);
    };
    this._tail = this._tail.then(run, run);
    return this._tail;
  }

  /** True if there is non-empty data currently in this slot. */
  hasData() {
    const text = this._storage.getItem(this._fullKey());
    if (!text || !text.trim()) return false;
    try {
      const doc = fromYaml(text);
      return Array.isArray(doc.items) && doc.items.length > 0;
    } catch { return false; }
  }

  // ── Internals ──────────────────────────────────────────────────────

  _fullKey() { return KEY_PREFIX + this._slot; }

  _load() {
    const text = this._storage.getItem(this._fullKey()) || '';
    if (!text.trim()) {
      return { schemaVersion: SCHEMA_VERSION, active: null, items: [] };
    }
    return fromYaml(text);
  }

  _save(doc) {
    this._storage.setItem(this._fullKey(), toYaml(doc));
  }

  /**
   * Re-read the slot and fire onDidChange iff the doc has drifted
   * from `_doc`. Called by both the DOM `storage` listener
   * (cross-tab) and the same-tab drift poll. Serialised through
   * `_tail` so a reconcile can't race an in-flight `apply`/`reset`/
   * `loadDocument`.
   *
   * A caught load error is routed to onDidError (rather than
   * thrown) so background polling can't crash the tab if the slot
   * gets corrupted mid-flight.
   */
  _reconcile() {
    if (this._disposed) return;
    const run = async () => {
      try {
        const before = this._doc;
        const next = freezeDocument(this._load());
        const changes = diffDocuments(before, next);
        this._doc = next;
        if (changes.length > 0) this._fireChange(changes);
      } catch (err) {
        this._fireError(err);
      }
    };
    this._tail = this._tail.then(run, run);
  }

  _fireChange(changes) {
    for (const h of [...this._listeners]) {
      try { h(changes); } catch (err) { this._fireError(err); }
    }
  }
  _fireError(err) {
    for (const h of [...this._errorListeners]) {
      try { h(err); } catch { /* ignore */ }
    }
  }
}

function findByKey(items, key) {
  for (const it of items) if (it.key === key) return it;
  return null;
}

export { LocalStorageNoggin };
