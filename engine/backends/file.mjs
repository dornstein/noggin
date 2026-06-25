// File backend for noggin.
//
// Importing this module side-effect-registers a factory under the
// `file://` scheme (and as the default factory for bare paths) in the
// engine's registry. After the import, `openNoggin('~/x.yaml')` and
// `openNoggin('file:///abs/path.yaml')` both work.
//
// The backend implements the `Noggin` interface from `../noggin-api.mjs`:
// it owns the file, exposes accessors over a deep-frozen in-memory
// document, and provides a single `apply(ops)` method that delegates
// to the engine's shared `applyOps()` after taking a cross-process
// advisory lock. All verb logic lives in `verbs.*` and never reaches
// this file.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  applyOps,
  factories,
  freezeDocument,
  documentsEqual,
  diffDocuments,
  normalizeDocument,
  NogginError,
  SCHEMA_VERSION,
  // tree helpers exposed via the noggin accessors below — re-implement here
  // (not exported by the engine) so the backend has them locally:
} from '../noggin-api.mjs';
import { fromYaml, toYaml } from '../serializers/yaml.mjs';

// ── Factory ──────────────────────────────────────────────────────────────────

const DEFAULT_LOCK_TIMEOUT = 5000;

/** @public Registered for the `file://` scheme and as the default. */
export const fileFactory = {
  scheme: 'file',
  async open(location, opts) {
    const filePath = expandHome(String(location || ''));
    if (!filePath) throw new NogginError('fileFactory: empty location', { code: 'no-location', exitCode: 2 });
    // Preserve the original location string (as passed to openNoggin)
    // so describe()/where can return a round-trippable, human-readable
    // form (e.g. `~/.noggin.yaml` stays unexpanded). Falls back to the
    // resolved path for callers that bypass openNoggin.
    const original = (opts && typeof opts.location === 'string' && opts.location) || filePath;
    const noggin = new FileNoggin(path.resolve(filePath), { ...opts, _originalLocation: original });
    await noggin._init();
    return noggin;
  },
};

factories.register(fileFactory, { default: true });

// ── Internals ────────────────────────────────────────────────────────────────

class FileNoggin {
  constructor(filePath, opts = {}) {
    this.file = filePath;
    // `location` is the canonical, round-trippable string the user/agent
    // passed to openNoggin — `~/.noggin.yaml`, `./.noggin.yaml`,
    // `file:///abs/path.yaml`, or a bare absolute path. `file` is the
    // resolved absolute filesystem path used for I/O.
    this.location = (typeof opts._originalLocation === 'string' && opts._originalLocation) || filePath;
    /** @type {any} */
    this._doc = { schemaVersion: SCHEMA_VERSION, active: null, items: [] };
    /** @type {Set<() => void>} */
    this._changeListeners = new Set();
    /** @type {Set<(err: any) => void>} */
    this._errorListeners = new Set();
    this._watcher = null;
    this._reloadTimer = null;
    this._disposed = false;
    this._tail = Promise.resolve();
    this._watchOnInit = opts.watch === true;
    this._lockTimeout = opts.lockTimeout || DEFAULT_LOCK_TIMEOUT;

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
    // Bad files surface as a thrown error so callers fail fast.
    // (The watcher path below stays best-effort.)
    this._doc = freezeDocument(loadDocument(this.file));
    if (this._watchOnInit) this._startWatch();
    return this;
  }

  // ── Read accessors ──────────────────────────────────────────────────
  get items() { return this._doc.items; }
  get active() {
    return this._doc.active ? findByKey(this._doc.items, this._doc.active) : null;
  }
  get roots() { return childrenOfImpl(this._doc.items, null); }

  findByKey(key) { return findByKey(this._doc.items, key); }
  childrenOf(parentKey) { return childrenOfImpl(this._doc.items, parentKey || null); }
  pathOf(item) { return pathOfImpl(this._doc.items, item); }
  resolvePath(p) {
    const r = tryResolveDetailed(this._doc, p);
    if (r.ok) return r.item;
    throw new NogginError(r.error, { code: 'path-not-found', exitCode: 1 });
  }
  tryResolvePath(p) {
    const r = tryResolveDetailed(this._doc, p);
    return r.ok ? r.item : null;
  }

  describe() {
    return this.location;
  }

  // ── The single mutator ──────────────────────────────────────────────
  apply(ops) {
    return this._enqueue(() => this._runLocked(async () => {
      const before = this._doc;
      const doc = loadDocument(this.file);
      applyOps(doc, ops);
      saveDocument(this.file, doc);
      const next = freezeDocument(doc);
      const changes = diffDocuments(before, next);
      this._doc = next;
      this._fireChange(changes);
    }));
  }

  // ── Lifecycle ───────────────────────────────────────────────────────
  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._reloadTimer) { clearTimeout(this._reloadTimer); this._reloadTimer = null; }
    if (this._watcher) { try { this._watcher.close(); } catch { /* ignore */ } this._watcher = null; }
    this._changeListeners.clear();
    this._errorListeners.clear();
    try { await this._tail; } catch { /* swallow */ }
  }

  // ── Internals ───────────────────────────────────────────────────────

  _enqueue(task) {
    const prev = this._tail;
    const next = prev.then(() => task());
    this._tail = next.catch(() => {});
    return next;
  }

  async _runLocked(task) {
    return withFileLock(this.file, this._lockTimeout, task);
  }

  _fireChange(event) {
    for (const h of this._changeListeners) {
      try { h(event); } catch { /* listener errors don't propagate */ }
    }
  }
  _fireError(err) {
    for (const h of this._errorListeners) {
      try { h(err); } catch { /* swallow */ }
    }
  }

  _startWatch() {
    const dir = path.dirname(this.file);
    if (!fs.existsSync(dir)) return;
    try {
      this._watcher = fs.watch(dir, { persistent: false }, (_event, name) => {
        if (!name) { this._scheduleReload(); return; }
        if (path.basename(this.file) === name) this._scheduleReload();
      });
    } catch { /* best-effort */ }
  }

  _scheduleReload() {
    if (this._reloadTimer) clearTimeout(this._reloadTimer);
    this._reloadTimer = setTimeout(() => {
      this._reloadTimer = null;
      if (this._disposed) return;
      void this._maybeReload();
    }, 50);
  }

  async _maybeReload() {
    let next;
    try { next = loadDocument(this.file); }
    catch (e) {
      if (e instanceof NogginError) this._fireError(e);
      return;
    }
    if (documentsEqual(this._doc, next)) return;
    const before = this._doc;
    const frozen = freezeDocument(next);
    const changes = diffDocuments(before, frozen);
    this._doc = frozen;
    this._fireChange({ changes, cause: 'external' });
  }
}

// ── File I/O ─────────────────────────────────────────────────────────────────

function loadDocument(filePath) {
  if (!fs.existsSync(filePath)) {
    return { schemaVersion: SCHEMA_VERSION, active: null, items: [] };
  }
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch (e) {
    throw new NogginError(`failed to read ${filePath}: ${e.message}`, { code: 'io', exitCode: 2 });
  }
  try {
    return normalizeDocument(fromYaml(raw));
  } catch (e) {
    if (e instanceof NogginError && (e.code === 'invalid-document' || e.code === 'unsupported-schema')) {
      throw new NogginError(`${e.message} (in ${filePath})`, { code: e.code, exitCode: e.exitCode });
    }
    throw e;
  }
}

function saveDocument(filePath, doc) {
  normalizeDocument(doc);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, toYaml(doc), 'utf8');
  fs.renameSync(tmp, filePath);
}

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// ── Cross-process advisory lock (mkdir-based, with stale detection) ─────────

const LOCK_SUFFIX = '.lock';
const STALE_AFTER_MS = 30_000;

async function withFileLock(filePath, timeout, task) {
  const lockDir = filePath + LOCK_SUFFIX;
  const deadline = Date.now() + timeout;
  let acquired = false;
  while (!acquired) {
    try { fs.mkdirSync(lockDir); acquired = true; }
    catch (err) {
      if (err && err.code !== 'EEXIST') throw err;
      if (reclaimIfStale(lockDir)) continue;
      if (Date.now() >= deadline) {
        const e = new NogginError(
          `could not acquire lock on ${filePath} within ${timeout}ms`,
          { code: 'lock-timeout', exitCode: 1 },
        );
        throw e;
      }
      await sleep(25 + Math.floor(Math.random() * 50));
    }
  }
  writeHeartbeat(lockDir);
  try { return await task(); }
  finally { try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch { /* ignore */ } }
}

function writeHeartbeat(lockDir) {
  try {
    fs.writeFileSync(path.join(lockDir, 'pid'), `${process.pid}\n${Date.now()}\n`, 'utf8');
  } catch { /* best-effort */ }
}

function reclaimIfStale(lockDir) {
  let pidFile;
  try { pidFile = fs.readFileSync(path.join(lockDir, 'pid'), 'utf8'); }
  catch { return false; }
  const [pidStr, tsStr] = pidFile.split('\n');
  const pid = Number(pidStr);
  const ts = Number(tsStr);
  if (!Number.isFinite(pid) || !Number.isFinite(ts)) return false;
  if (Date.now() - ts < STALE_AFTER_MS && isAlive(pid)) return false;
  try { fs.rmSync(lockDir, { recursive: true, force: true }); return true; }
  catch { return false; }
}

function isAlive(pid) {
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); return true; }
  catch (err) { return !!(err && err.code === 'EPERM'); }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Tree helpers (local copies — engine exports are noggin-shaped) ──────────

function findByKey(items, key) {
  if (!key) return null;
  return items.find((f) => f.key === key) || null;
}

function childrenOfImpl(items, parentKey) {
  return items.filter((f) => (f.parentKey ?? null) === (parentKey ?? null));
}

function positionOf(items, item) {
  if (!item) return null;
  const siblings = childrenOfImpl(items, item.parentKey ?? null);
  const index = siblings.findIndex((s) => s.key === item.key);
  return index >= 0 ? index + 1 : null;
}

function pathOfImpl(items, item) {
  if (!item) return null;
  const parts = [];
  let f = item;
  while (f) {
    const position = positionOf(items, f);
    if (!position) return null;
    parts.unshift(String(position));
    f = f.parentKey ? findByKey(items, f.parentKey) : null;
  }
  return '/' + parts.join('/');
}

// ── Path resolution (mirrors the engine's resolver, scoped to this doc) ─────
//
// The engine's resolvePath is exposed on the Noggin interface; we
// implement the same grammar here so this backend can answer
// noggin.resolvePath / tryResolvePath without round-tripping through
// the engine.

function tryResolveDetailed(doc, p) {
  if (!p) return { ok: false, error: `path: empty path` };
  const s = String(p);
  const active = doc.active ? findByKey(doc.items, doc.active) : null;

  if (s.startsWith('/')) {
    const rest = s.slice(1);
    if (rest === '') return { ok: false, error: `path '${s}': empty absolute path` };
    return walkPath(doc.items, null, rest, s);
  }
  if (s === '.') {
    if (!active) return { ok: false, error: `path '.': no active item` };
    return { ok: true, item: active };
  }
  if (s === '..') {
    if (!active) return { ok: false, error: `path '..': no active item` };
    if (!active.parentKey) return { ok: false, error: `path '..': active item has no parent` };
    return { ok: true, item: findByKey(doc.items, active.parentKey) };
  }
  if (s === '-' || s === '+') {
    if (!active) return { ok: false, error: `path '${s}': no active item` };
    return siblingRelative(doc.items, active, s === '-' ? -1 : 1, s);
  }
  if (s.startsWith('-/') || s.startsWith('+/')) {
    if (!active) return { ok: false, error: `path '${s}' is relative but no active item` };
    const direction = s[0] === '-' ? -1 : 1;
    const sibling = siblingRelative(doc.items, active, direction, s);
    if (!sibling.ok) return sibling;
    const rest = s.slice(2);
    if (rest === '') return { ok: false, error: `path '${s}': trailing slash with no descendant` };
    return walkPath(doc.items, sibling.item, rest, s);
  }
  if (!active) return { ok: false, error: `path '${s}' is relative but no active item` };
  let base = active;
  let rest = s;
  while (rest === '..' || rest.startsWith('../')) {
    if (!base.parentKey) return { ok: false, error: `path '${s}': cannot go above root` };
    base = findByKey(doc.items, base.parentKey);
    rest = rest === '..' ? '' : rest.slice(3);
  }
  if (rest.startsWith('./')) rest = rest.slice(2);
  if (rest === '') return { ok: true, item: base };
  return walkPath(doc.items, base, rest, s);
}

function walkPath(items, base, segPath, originalForError) {
  const segments = segPath.split('/').filter(Boolean);
  if (segments.length === 0) {
    return base ? { ok: true, item: base } : { ok: false, error: `path '${originalForError}' is empty` };
  }
  let current = base;
  for (const seg of segments) {
    if (!/^\d+$/.test(seg) || Number(seg) < 1) {
      return { ok: false, error: `path '${originalForError}': segment '${seg}' is not a 1-based position` };
    }
    const parentKey = current ? current.key : null;
    const position = Number(seg);
    const match = childrenOfImpl(items, parentKey)[position - 1];
    if (!match) {
      const where = current ? `under '${pathOfImpl(items, current)}'` : 'at root';
      return { ok: false, error: `path not found: ${originalForError} (no position ${position} ${where})` };
    }
    current = match;
  }
  return { ok: true, item: current };
}

function siblingRelative(items, item, delta, originalForError) {
  const peers = childrenOfImpl(items, item.parentKey || null);
  const index = peers.findIndex((p) => p.key === item.key);
  const target = peers[index + delta];
  if (!target) {
    const direction = delta < 0 ? 'previous' : 'next';
    return { ok: false, error: `path '${originalForError}': active item has no ${direction} sibling` };
  }
  return { ok: true, item: target };
}
