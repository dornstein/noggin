// HTTP(S) provider for noggin (read-only).
//
// Registers under both `https://` and `http://` schemes. Fetches a
// noggin YAML document from a URL once at open time, parses it, and
// exposes it as a frozen read-only noggin. Mutations are rejected
// with `NogginError({ code: 'read-only' })`.
//
// Use cases: sharing a public sample noggin, previewing a teammate's
// noggin from a PR, browsing the cognitive-foundations examples from
// the repo. Anything that would normally be a static `.yaml.example`
// in a docs site.
//
// What this provider is NOT:
//   - A sync layer. There is no polling, no ETag refresh, no
//     onDidChange after open. A second open of the same URL
//     re-fetches; that is the only way to refresh.
//   - Authenticated. It uses anonymous fetch only. Private GitHub
//     repos, gated APIs, anything needing a header — out of scope.
//   - URL-aware. The provider fetches whatever URL it's given. Host
//     UIs that want to massage user input (rewriting one shape of
//     URL into another, defaulting a scheme, validating shape) do
//     that at the picker boundary before calling openNoggin.

import {
  bindNogginVerbs,
  providers,
  freezeDocument,
  normalizeDocument,
  NogginError,
  SCHEMA_VERSION,
  resolvePath,
  tryResolvePath,
  pathOf,
  childrenOf,
} from '../noggin-api.mjs';
import { fromYaml } from '../serializers/yaml.mjs';

// Provider object factory. Both `http` and `https` share the same
// open logic; they only differ in which scheme to reconstruct when
// the caller passed a bare post-scheme path.
function makeProvider(scheme) {
  return {
    scheme,
    /**
     * @param {string} rest  Post-scheme portion of the URL (e.g.
     *   `raw.githubusercontent.com/...`).
     * @param {object} [opts]
     */
    async open(rest, opts) {
      // The engine strips `scheme://` before handing us `rest`;
      // rebuild the full URL so fetch() sees something parseable.
      const url = `${scheme}://${rest}`;
      const noggin = new HttpNoggin(url, opts);
      await noggin._init();
      return noggin;
    },
  };
}

/** @public Registered for the `https://` scheme. */
export const httpsProvider = makeProvider('https');
/** @public Registered for the `http://` scheme. */
export const httpProvider = makeProvider('http');

providers.register(httpsProvider);
providers.register(httpProvider);

/**
 * @public
 * Convenience: open a remote noggin by URL without going through the
 * scheme registry. Equivalent to `openNoggin(url)` for a `http(s)`
 * URL but skips one indirection.
 *
 * @param {string} url   Full URL including scheme.
 * @param {object} [opts]
 */
export async function openHttpNoggin(url, opts = {}) {
  const noggin = new HttpNoggin(url, opts);
  await noggin._init();
  return noggin;
}

class HttpNoggin {
  constructor(url, _opts = {}) {
    this.location = url;
    /** Public flag UIs read to gate mutation affordances. */
    this.readOnly = true;
    /** @type {any} */
    this._doc = { schemaVersion: SCHEMA_VERSION, active: null, items: [] };
    /** @type {Set<() => void>} */
    this._changeListeners = new Set();
    /** @type {Set<(err: any) => void>} */
    this._errorListeners = new Set();
    this._disposed = false;

    // Standard listener registration shape every provider matches.
    // Change events never fire after the initial open — the document
    // is immutable from the provider's perspective — but we keep the
    // registration API so consumers don't have to special-case.
    this.onDidChange = (handler) => {
      this._changeListeners.add(handler);
      return { dispose: () => this._changeListeners.delete(handler) };
    };
    this.onDidError = (handler) => {
      this._errorListeners.add(handler);
      return { dispose: () => this._errorListeners.delete(handler) };
    };

    bindNogginVerbs(this);
  }

  async _init() {
    let res;
    try { res = await fetch(this.location); }
    catch (err) {
      throw new NogginError(`http: ${err.message}`, {
        code: 'http-fetch-failed', exitCode: 2,
      });
    }
    if (!res.ok) {
      throw new NogginError(`http: ${res.status} ${res.statusText}`, {
        code: 'http-error', exitCode: 2,
      });
    }
    const text = await res.text();
    let doc;
    try { doc = fromYaml(text); }
    catch (err) {
      // Most common failure mode: the user pasted a URL pointing at
      // HTML rather than YAML (a viewer page, a wiki, a redirect).
      // The YAML parser's error is opaque ("unexpected character
      // <"); wrap it with something the UI can show.
      throw new NogginError(
        `http: response is not a valid noggin YAML document (${err.message})`,
        { code: 'http-invalid-yaml', exitCode: 2 },
      );
    }
    this._doc = freezeDocument(normalizeDocument(doc));
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

  // ── The (rejected) mutator ──────────────────────────────────────────
  apply(_ops) {
    return Promise.reject(new NogginError(
      'this noggin was loaded over HTTP and is read-only',
      { code: 'read-only', exitCode: 2 },
    ));
  }

  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._changeListeners.clear();
    this._errorListeners.clear();
  }

  describe() { return this.location; }

  _fireChange(event) {
    for (const h of this._changeListeners) {
      try { h(event); } catch { /* swallow */ }
    }
  }
  _fireError(err) {
    for (const h of this._errorListeners) {
      try { h(err); } catch { /* swallow */ }
    }
  }
}

// findByKey is a hot loop over a small flat array; the engine doesn't
// export it directly so we inline a copy here (same as the memory
// provider does).
function findByKey(items, key) {
  for (const it of items) if (it.key === key) return it;
  return null;
}
