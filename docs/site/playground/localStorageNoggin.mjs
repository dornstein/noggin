// Browser noggin backend: implements the Noggin interface on top of
// window.localStorage. Persists the document as YAML in a single key.
//
// Registers itself with the engine's factory registry under the
// `localstorage://` scheme on import; after that,
// `openNoggin('localstorage://playground')` returns one of these.
//
// No locking, no watcher, no async queue — the browser is single-
// threaded and the only writer is this tab.

import {
  applyOps,
  factories,
  freezeDocument,
  NogginError,
  resolvePath as engineResolvePath,
  tryResolvePath as engineTryResolvePath,
  pathOf as enginePathOf,
  childrenOf as engineChildrenOf,
  SCHEMA_VERSION,
} from '../../../cli/noggin-api.mjs';
import { fromYaml, toYaml } from '../../../cli/serializers/yaml.mjs';

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
    const doc = this._load();
    applyOps(doc, ops);
    this._save(doc);
    this._doc = freezeDocument(doc);
    this._fireChange();
  }

  async dispose() {
    this._listeners.clear();
    this._errorListeners.clear();
  }

  // ── Playground helpers (not part of the standard Noggin surface) ────

  /** Read the underlying document — for the tree view tab. */
  snapshot() { return this._load(); }

  /** Wipe the store. Fires change so subscribers re-render empty. */
  reset() {
    this.storage.removeItem(this._fullKey());
    this._doc = freezeDocument(this._load());
    this._fireChange();
  }

  /**
   * Replace the current document wholesale. Used by the "Load sample
   * data" button. Round-trips through yaml to validate / normalize.
   */
  loadDocument(doc) {
    const next = fromYaml(toYaml(doc));
    this.storage.setItem(this._fullKey(), toYaml(next));
    this._doc = freezeDocument(next);
    this._fireChange();
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

  _fireChange() {
    for (const h of this._listeners) { try { h(); } catch { /* ignore */ } }
  }
}

// ── Factory + registration ──────────────────────────────────────────

export const localStorageFactory = {
  scheme: 'localstorage',
  async open(location, opts) {
    const storage = (opts && opts.storage) || globalThis.localStorage;
    if (!storage) throw new NogginError('localStorage: no storage available', { code: 'no-location', exitCode: 2 });
    const key = location || DEFAULT_STORAGE_KEY;
    return new LocalStorageNoggin(key, storage);
  },
};

factories.register(localStorageFactory);

// Re-export so main.mjs can grab a typed handle without going through
// the registry (e.g. for the tree view tab's direct snapshot access).
export { LocalStorageNoggin };
