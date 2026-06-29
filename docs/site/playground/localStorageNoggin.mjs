// Browser noggin provider: implements the Noggin interface on top of
// window.localStorage. Persists the document as YAML in a single key.
//
// Registers itself with the engine's provider registry under the
// `localstorage://` scheme on import; after that,
// `openNoggin('localstorage://playground')` returns one of these.
//
// No locking, no async queue — the browser is single-threaded and a
// given Noggin instance is the only writer to its slot within this
// tab. Cross-tab sync is handled via the DOM `storage` event: when
// another same-origin tab mutates our key, we reload and fire
// onDidChange so subscribers re-render.

import {
  applyOps,
  bindNogginVerbs,
  providers,
  freezeDocument,
  diffDocuments,
  NogginError,
  resolvePath as engineResolvePath,
  tryResolvePath as engineTryResolvePath,
  pathOf as enginePathOf,
  childrenOf as engineChildrenOf,
  SCHEMA_VERSION,
} from '../../../engine/noggin-api.mjs';
import { fromYaml, toYaml } from '../../../engine/serializers/yaml.mjs';

export const DEFAULT_STORAGE_KEY = 'playground';
const KEY_PREFIX = 'noggin:';

class LocalStorageNoggin {
  constructor(storageKey, storage) {
    this.storageKey = storageKey;
    this.storage = storage;
    this._listeners = new Set();
    this._errorListeners = new Set();
    this._doc = freezeDocument(this._load());

    this.onDidChange = (handler) => {
      this._listeners.add(handler);
      return { dispose: () => this._listeners.delete(handler) };
    };
    this.onDidError = (handler) => {
      this._errorListeners.add(handler);
      return { dispose: () => this._errorListeners.delete(handler) };
    };

    // Cross-tab sync. The browser fires `storage` on every other
    // same-origin window when our key is mutated; reload + refire so
    // subscribers re-render. Same-tab writes don't dispatch this
    // event (the writing tab updates synchronously in `apply`).
    this._onStorage = null;
    const win = (storage && storage.__window) || (typeof window !== 'undefined' ? window : null);
    if (win && typeof win.addEventListener === 'function') {
      this._win = win;
      this._onStorage = (e) => {
        if (!e || e.key !== this._fullKey()) return;
        if (e.storageArea && e.storageArea !== this.storage) return;
        try {
          const before = this._doc;
          const next = freezeDocument(this._load());
          const changes = diffDocuments(before, next);
          this._doc = next;
          // Skip the listener fan-out if the reload produced no
          // observable change (subscribers expect `changes.length > 0`).
          if (changes.length > 0) this._fireChange(changes);
        } catch (err) {
          for (const h of this._errorListeners) { try { h(err); } catch { /* ignore */ } }
        }
      };
      win.addEventListener('storage', this._onStorage);
    }

    // Attach bound verb methods (push/add/move/…) so consumers can
    // call `noggin.push(opts)` directly — same pattern as the
    // in-process providers.
    bindNogginVerbs(this);
  }

  // ── Accessors ──────────────────────────────────────────────────────
  get items() { return this._doc.items; }
  get active() {
    return this._doc.active ? this._doc.items.find((i) => i.key === this._doc.active) || null : null;
  }
  get roots() { return engineChildrenOf(this._doc, null); }

  findByKey(key) {
    if (!key) return null;
    return this._doc.items.find((i) => i.key === key) || null;
  }
  childrenOf(parentKey) { return engineChildrenOf(this._doc, parentKey); }
  pathOf(item) { return enginePathOf(this._doc, item); }
  resolvePath(p) { return engineResolvePath(this._doc, p); }
  tryResolvePath(p) { return engineTryResolvePath(this._doc, p); }

  describe() { return `localStorage: ${KEY_PREFIX}${this.storageKey}`; }

  // ── Single mutator ─────────────────────────────────────────────────
  async apply(ops) {
    const before = this._doc;
    const doc = this._load();
    applyOps(doc, ops);
    this._save(doc);
    const next = freezeDocument(doc);
    const changes = diffDocuments(before, next);
    this._doc = next;
    if (changes.length > 0) this._fireChange(changes);
  }

  async dispose() {
    this._listeners.clear();
    this._errorListeners.clear();
    if (this._win && this._onStorage) {
      this._win.removeEventListener('storage', this._onStorage);
      this._onStorage = null;
    }
  }

  // ── Playground helpers (not part of the standard Noggin surface) ────

  /** Read the underlying document — for the tree view tab. */
  snapshot() { return this._load(); }

  /** Wipe the store. Fires change so subscribers re-render empty. */
  reset() {
    const before = this._doc;
    this.storage.removeItem(this._fullKey());
    const next = freezeDocument(this._load());
    const changes = diffDocuments(before, next);
    this._doc = next;
    this._fireChange(changes);
  }

  /**
   * Replace the current document wholesale. Used by the "Load sample
   * data" button. Round-trips through yaml to validate / normalize.
   */
  loadDocument(doc) {
    const before = this._doc;
    const next = fromYaml(toYaml(doc));
    this.storage.setItem(this._fullKey(), toYaml(next));
    const frozen = freezeDocument(next);
    const changes = diffDocuments(before, frozen);
    this._doc = frozen;
    this._fireChange(changes);
  }

  /** True if there is non-empty data currently stored. */
  hasData() {
    const text = this.storage.getItem(this._fullKey());
    if (!text || !text.trim()) return false;
    try {
      const doc = fromYaml(text);
      return Array.isArray(doc.items) && doc.items.length > 0;
    } catch { return false; }
  }

  // ── Internals ──────────────────────────────────────────────────────

  _fullKey() { return KEY_PREFIX + this.storageKey; }

  _load() {
    const text = this.storage.getItem(this._fullKey()) || '';
    if (!text.trim()) {
      return { schemaVersion: SCHEMA_VERSION, active: null, items: [] };
    }
    return fromYaml(text);
  }

  _save(doc) {
    this.storage.setItem(this._fullKey(), toYaml(doc));
  }

  _fireChange(changes) {
    for (const h of this._listeners) { try { h(changes); } catch { /* ignore */ } }
  }
}

// ── Provider + registration ──────────────────────────────────────

export const localStorageProvider = {
  scheme: 'localstorage',
  async open(location, opts) {
    const storage = (opts && opts.storage) || globalThis.localStorage;
    if (!storage) throw new NogginError('localStorage: no storage available', { code: 'no-location', exitCode: 2 });
    const key = location || DEFAULT_STORAGE_KEY;
    return new LocalStorageNoggin(key, storage);
  },
};

providers.register(localStorageProvider);

// Re-export so main.mjs can grab a typed handle without going through
// the registry (e.g. for the tree view tab's direct snapshot access).
export { LocalStorageNoggin };
