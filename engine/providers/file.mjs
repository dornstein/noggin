// File provider for noggin.
//
// Importing this module side-effect-registers a provider under the
// `file://` scheme in the engine's registry. After the import,
// `openNoggin('file:///abs/path.yaml')` works.
//
// Hosts that have a raw filesystem path (file dialog result, CLI
// argument) can either:
//   - convert it to a `file://` URI and call `openNoggin`, or
//   - call the {@link openFileNoggin} factory below, which accepts
//     bare paths (absolute, relative, or `~`-prefixed) directly.
//
// The provider implements the `Noggin` interface from `../noggin-api.mjs`:
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
  bindNogginVerbs,
  providers,
  freezeDocument,
  documentsEqual,
  diffDocuments,
  normalizeDocument,
  NogginError,
  SCHEMA_VERSION,
  // tree helpers exposed via the noggin accessors below — re-implement here
  // (not exported by the engine) so the provider has them locally:
} from '../noggin-api.mjs';
import { fromYaml, toYaml } from '../serializers/yaml.mjs';

// ── Provider ─────────────────────────────────────────────────────────────────

const DEFAULT_LOCK_TIMEOUT = 5000;
/**
 * Poll interval (ms) for the safety-net stat-based reload. The
 * `fs.watch` path is the fast case; polling covers filesystems where
 * `fs.watch` is unreliable or silently drops events (network shares,
 * some containers, editors that rename-then-write in unusual ways).
 * The check is a single `fs.statSync` when nothing has changed, and
 * a full re-read + diff only when the mtime moves.
 */
const DEFAULT_POLL_INTERVAL_MS = 2000;

/** @public Registered for the `file://` scheme. */
export const fileProvider = {
  scheme: 'file',
  async open(location, opts) {
    const filePath = expandHome(String(location || ''));
    if (!filePath) throw new NogginError('location required', { code: 'no-location', exitCode: 2 });
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

providers.register(fileProvider);

/**
 * @public
 * Convenience: open a file-backed noggin from a raw filesystem path
 * without going through the URI registry. The path may be absolute
 * (`/abs/p.yaml`), relative (`./p.yaml`), or `~`-prefixed
 * (`~/.noggin.yaml`); the provider expands `~` and resolves relative
 * paths against `process.cwd()` exactly as it does for the post-`file://`
 * portion of a URI.
 *
 * This is the right entry point for hosts whose user input is a real
 * OS path (file dialogs, drop targets, CLI argv). Hosts that work
 * with URIs end-to-end should prefer `openNoggin('file://...')`.
 */
export async function openFileNoggin(filePath, opts) {
  return fileProvider.open(filePath, opts);
}

// ── Internals ────────────────────────────────────────────────────────────────

class FileNoggin {
  constructor(filePath, opts = {}) {
    this.file = filePath;
    // `location` is the canonical, round-trippable string the user/agent
    // passed to openNoggin — `~/.noggin.yaml`, `./.noggin.yaml`,
    // `file:///abs/path.yaml`, or a bare absolute path. `file` is the
    // resolved absolute filesystem path used for I/O.
    this.location = (typeof opts._originalLocation === 'string' && opts._originalLocation) || filePath;
    this.readOnly = false;
    /** @type {any} */
    this._doc = { schemaVersion: SCHEMA_VERSION, active: null, items: [] };
    /** @type {Set<() => void>} */
    this._changeListeners = new Set();
    /** @type {Set<(err: any) => void>} */
    this._errorListeners = new Set();
    this._watcher = null;
    this._reloadTimer = null;
    this._pollTimer = null;
    /** mtime (ms) of the file the last time we successfully loaded
     *  it. Compared against `fs.statSync(...).mtimeMs` inside the
     *  poll to skip a full re-read when the file hasn't moved. */
    this._lastMtimeMs = 0;
    this._disposed = false;
    this._tail = Promise.resolve();
    this._watchOnInit = opts.watch === true;
    this._lockTimeout = opts.lockTimeout || DEFAULT_LOCK_TIMEOUT;
    this._pollIntervalMs = typeof opts.pollIntervalMs === 'number'
      ? opts.pollIntervalMs
      : DEFAULT_POLL_INTERVAL_MS;

    this.onDidChange = (handler) => {
      this._changeListeners.add(handler);
      return { dispose: () => this._changeListeners.delete(handler) };
    };
    this.onDidError = (handler) => {
      this._errorListeners.add(handler);
      return { dispose: () => this._errorListeners.delete(handler) };
    };

    // Attach bound verb methods (push/add/move/…) so consumers can
    // call `noggin.push(opts)` instead of `verbs.push(noggin, opts)`.
    bindNogginVerbs(this);
  }

  async _init() {
    // Bad files surface as a thrown error so callers fail fast.
    // (The watcher path below stays best-effort.)
    this._doc = freezeDocument(loadDocument(this.file));
    this._lastMtimeMs = currentMtimeMs(this.file);
    if (this._watchOnInit) this._startWatch();
    // Polling always runs (unless explicitly disabled) — it's the
    // safety net for filesystems where `fs.watch` misses events.
    // See DEFAULT_POLL_INTERVAL_MS for the trade-off.
    if (this._pollIntervalMs > 0) this._startPoll();
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
    throw new NogginError(r.error, { code: 'path-not-found', exitCode: 1, data: { path: String(p), detail: r.error } });
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
      // Refresh our mtime snapshot so the safety-net poll doesn't
      // trip and re-read the file just because we wrote it.
      this._lastMtimeMs = currentMtimeMs(this.file);
      const next = freezeDocument(doc);
      const changes = diffDocuments(before, next);
      this._doc = next;
      // Skip the listener fan-out if the apply produced no observable
      // change. Subscribers expect `changes.length > 0`; firing empty
      // arrays violates the contract pinned by the empty-diff test.
      if (changes.length > 0) this._fireChange(changes);
    }));
  }

  // ── Lifecycle ───────────────────────────────────────────────────────
  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._reloadTimer) { clearTimeout(this._reloadTimer); this._reloadTimer = null; }
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
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

  /**
   * Same-tab / same-process drift poll. Runs a cheap `fs.statSync`
   * on the tracked file; if the mtime moved since the last known
   * value, schedules a full reload. The reload path is idempotent
   * with the watcher — both funnel through `_maybeReload`, which is
   * serialised via the mutation queue + advisory lock.
   *
   * Runs unconditionally (unless disabled with `pollIntervalMs: 0`)
   * because it's the safety net for filesystems where `fs.watch`
   * silently drops events. The stat is one `int` compare on the
   * happy path.
   */
  _startPoll() {
    if (typeof setInterval !== 'function') return;
    this._pollTimer = setInterval(() => {
      if (this._disposed) return;
      const mtime = currentMtimeMs(this.file);
      if (mtime === this._lastMtimeMs) return;
      this._scheduleReload();
    }, this._pollIntervalMs);
    if (this._pollTimer && typeof this._pollTimer.unref === 'function') {
      this._pollTimer.unref();
    }
  }

  _scheduleReload() {
    // Coalesce: if a reload is already pending, leave the existing
    // timer alone. Repeated triggers from a burst of watcher events
    // OR from the safety-net poll ticking on top of an already-drifted
    // mtime would otherwise reset the debounce forever and the reload
    // would never fire.
    if (this._reloadTimer) return;
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
    // Update our mtime snapshot regardless of whether the doc's
    // structural content changed — a save that produced the same
    // logical document (e.g. re-order-preserving formatter run)
    // still moves mtime, and we don't want to re-fire for it
    // forever.
    this._lastMtimeMs = currentMtimeMs(this.file);
    if (documentsEqual(this._doc, next)) return;
    const before = this._doc;
    const frozen = freezeDocument(next);
    const changes = diffDocuments(before, frozen);
    this._doc = frozen;
    this._fireChange(changes);
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
    throw new NogginError(`failed to read file: ${e.message}`, { code: 'io', exitCode: 2, data: { path: filePath, detail: e.message } });
  }
  try {
    return normalizeDocument(fromYaml(raw));
  } catch (e) {
    if (e instanceof NogginError && (e.code === 'invalid-document' || e.code === 'unsupported-schema')) {
      throw new NogginError(e.message, { code: e.code, exitCode: e.exitCode, data: { ...(e.data || {}), path: filePath } });
    }
    throw e;
  }
}

/** Millisecond mtime of `filePath`, or 0 if missing / unreadable.
 *  Never throws — the caller uses this inside a poll and treats
 *  transient stat failures as "no change to notice." */
function currentMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function saveDocument(filePath, doc) {
  normalizeDocument(doc);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, toYaml(doc), 'utf8');
  renameWithRetry(tmp, filePath);
}

// Atomic-rename retry. On POSIX `rename(2)` is genuinely atomic and
// happy even if another handle is open on the destination — the
// directory entry just flips. On Windows the call can fail with
// EPERM/EBUSY/EACCES if any process has a handle open on the dest
// during the rename: a sibling FileNoggin watcher re-reading after a
// write, Windows Defender scanning the file, the Search indexer,
// etc. The contention windows are sub-millisecond and clear quickly,
// so retry a few times with tiny backoff before giving up. Matches
// what every cross-platform "atomic write" library does
// (write-file-atomic, proper-lockfile, graceful-fs).
function renameWithRetry(from, to) {
  const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
  const MAX_ATTEMPTS = 6;
  let lastErr;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try { fs.renameSync(from, to); return; }
    catch (err) {
      lastErr = err;
      if (!err || !TRANSIENT.has(err.code)) throw err;
      if (attempt === MAX_ATTEMPTS - 1) break;
      // Tiny synchronous wait. saveDocument is already inside the
      // file lock + the per-noggin promise queue; nobody is racing
      // for this thread.
      spinSleep(5 + Math.floor(Math.random() * 15));
    }
  }
  throw lastErr;
}

function spinSleep(ms) {
  const until = Date.now() + ms;
  // eslint-disable-next-line no-empty
  while (Date.now() < until) {}
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
// implement the same grammar here so this provider can answer
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
