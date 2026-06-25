// AUTO-SYNCED FROM engine/providers/memory.mjs — DO NOT EDIT HERE.
// Edit the source and run: node scripts/sync-skill.mjs

// Memory provider for noggin.
//
// Registers a provider under the `memory://` scheme. Useful for
// browser-based dev iteration (renderer can load the real engine and
// hit verbs.* with zero divergence from the Electron path) and for
// tests that want a fast, disposable noggin without touching the
// filesystem.
//
// The provider implements the same `Noggin` interface the file provider
// does: deep-frozen in-memory document, a single `apply(ops)` that
// delegates to the engine's shared `applyOps()`, and fan-out
// `onDidChange` / `onDidError`.

import {
  applyOps,
  providers,
  freezeDocument,
  documentsEqual,
  diffDocuments,
  normalizeDocument,
  NogginError,
  SCHEMA_VERSION,
  // Path / tree helpers exported by the engine. We reuse them so the
  // memory provider supports the exact same path grammar as the file
  // provider (`/1/2`, `.`, `..`, `-`, `+`, `-/X`, etc.) with zero
  // duplicated logic.
  resolvePath,
  tryResolvePath,
  pathOf,
  childrenOf,
} from '../noggin-api.mjs';

/** @public Registered for the `memory://` scheme. */
export const memoryProvider = {
  scheme: 'memory',
  async open(location, opts) {
    const label = String(location || '') || 'in-memory';
    const noggin = new MemoryNoggin(label, opts);
    await noggin._init();
    return noggin;
  },
};

providers.register(memoryProvider);

/**
 * @public
 * Convenience: open an in-memory noggin without going through the
 * provider + URL scheme dance. Equivalent to
 * `openNoggin('memory://' + label, opts)`.
 *
 * `opts.initialDocument` (optional) seeds the noggin with an existing
 * `NogginDocument`; otherwise it starts empty.
 */
export async function openMemoryNoggin(opts = {}) {
  const noggin = new MemoryNoggin(opts.label || 'in-memory', opts);
  await noggin._init();
  return noggin;
}

class MemoryNoggin {
  constructor(label, opts = {}) {
    this.location = `memory://${label}`;
    this._label = label;
    this._initial = opts.initialDocument || null;
    /** @type {any} */
    this._doc = { schemaVersion: SCHEMA_VERSION, active: null, items: [] };
    /** @type {Set<() => void>} */
    this._changeListeners = new Set();
    /** @type {Set<(err: any) => void>} */
    this._errorListeners = new Set();
    this._disposed = false;
    this._tail = Promise.resolve();

    this.onDidChange = (handler) => {
      this._changeListeners.add(handler);
      return { dispose: () => this._changeListeners.delete(handler) };
    };
    this.onDidError = (handler) => {
      this._errorListeners.add(handler);
      return { dispose: () => this._errorListeners.delete(handler) };
    };
  }

  async _init() {
    const seed = this._initial
      ? normalizeDocument(structuredClone(this._initial))
      : { schemaVersion: SCHEMA_VERSION, active: null, items: [] };
    this._doc = freezeDocument(seed);
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
    // Engine resolver supports both absolute (/1/2) and active-relative
    // (., .., -, +, -/X, +/X) syntax; pass a {items, active} snapshot.
    return resolvePath({ items: this._doc.items, active: this._doc.active }, p);
  }
  tryResolvePath(p) {
    return tryResolvePath({ items: this._doc.items, active: this._doc.active }, p);
  }

  // ── The only mutator ────────────────────────────────────────────────
  /**
   * Apply a list of AtomicOps. Same contract as the file provider's
   * apply(): serialized through a tail-promise so concurrent callers
   * don't interleave, atomic per call.
   */
  apply(ops) {
    if (this._disposed) {
      return Promise.reject(new NogginError('memory: noggin disposed', { code: 'disposed', exitCode: 2 }));
    }
    const run = async () => {
      const before = this._doc;
      const next = applyOps(structuredClone(before), ops);
      if (documentsEqual(before, next)) return;
      const changes = diffDocuments(before, next);
      this._doc = freezeDocument(next);
      this._fireChange(changes);
    };
    this._tail = this._tail.then(run, run);
    return this._tail;
  }

  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._changeListeners.clear();
    this._errorListeners.clear();
  }

  describe() { return this.location; }

  _fireChange(event) {
    for (const h of [...this._changeListeners]) {
      try { h(event); } catch (err) { this._fireError(err); }
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
