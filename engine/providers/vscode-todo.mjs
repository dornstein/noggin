// VS Code Copilot todo-list provider (read-only, preview).
//
// Registers under the `vscode-todo` scheme. Points at a VS Code
// workspace's `state.vscdb` SQLite file and projects the Copilot
// chat todo list (built-in `manage_todo_list` tool) as a noggin.
//
// Storage that this provider reads:
//   <workspaceStorage>/<workspaceId>/state.vscdb
//     ItemTable row  key = "memento/chat-todo-list"
//     value          JSON { [sessionId]: IChatTodo[] }
//     IChatTodo      { id: number, title: string,
//                      status: 'not-started' | 'in-progress' | 'completed' }
//
// This is what VS Code's workbench-internal `ChatTodoListStorage`
// (backing `IChatTodoListService`) writes on every `manage_todo_list`
// tool invocation.
//
// Projection:
//   • Requires a sessionId (`#<sessionId>` fragment on the URI, or
//     `opts.sessionId` on the factory). Providers surface exactly
//     one session’s todos as root items.
//   • status: 'completed'    → item.done = true
//   • status: 'in-progress'  → item.done = false + a system note
//                              ("in-progress")
//   • status: 'not-started'  → item.done = false, no notes
//
// Read-only. Writes go to the same SQLite memento in the running
// VS Code process — attempting to poke that from outside would fight
// VS Code's in-memory `Memento` cache and get overwritten. `apply()`
// therefore rejects with `code: 'read-only'` (matches the http
// provider's contract). Future iterations may reroute writes via the
// VS Code extension host using `vscode.lm.invokeTool`.
//
// Watching: polls the `state.vscdb` and `state.vscdb-wal` mtimes
// (SQLite in WAL mode journals to the -wal sidecar between
// checkpoints). Any change triggers a re-read + diff + onDidChange.
//
// Requires Node ≥ 22.5 for `node:sqlite`. Older runtimes throw a
// clear `NogginError` at `open()` time.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import {
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

const MEMENTO_KEY = 'memento/chat-todo-list';
/**
 * VS Code's chat-session index — a JSON blob keyed by session id
 * that carries the same `title`, `lastMessageDate`, `isEmpty`,
 * `isExternal`, `initialLocation`, etc. metadata VS Code's Sessions
 * sidebar reads. Introduced in VS Code 1.109's `ChatSessionStore`
 * refactor. Present in each workspace's `state.vscdb` (and in the
 * global `<userDataDir>/User/globalStorage/state.vscdb` for
 * empty-window sessions).
 */
const CHAT_INDEX_KEY = 'chat.ChatSessionStore.index';
/**
 * VS Code's agent-session cache — the second half of what the
 * Sessions sidebar renders. Array of `{ resource, label,
 * providerType, providerLabel, icon, status, timing, changes,
 * metadata }` for every agent-mode session that has visible state
 * in this workspace (Copilot CLI runs, cloud agents, hosted
 * agents). Written by `AgentSessionsCache.SESSIONS_STORAGE_KEY` in
 * VS Code's `agentSessionsModel.ts`.
 */
const AGENT_SESSIONS_CACHE_KEY = 'agentSessions.model.cache';
const DEFAULT_POLL_INTERVAL_MS = 2000;
const CREATED_AT_SENTINEL = '1970-01-01T00:00:00.000Z';

/** @public Registered for the `vscode-todo` scheme. */
export const vscodeTodoProvider = {
  scheme: 'vscode-todo',
  /**
   * @param {string} rest    Post-scheme portion of the URL.
   * @param {object} [opts]  Forwarded from openNoggin.
   */
  async open(rest, opts) {
    const original = (opts && typeof opts.location === 'string' && opts.location) || `vscode-todo://${rest}`;
    const parsed = parseVscodeTodoLocation(original, rest);
    const noggin = new VscodeTodoNoggin(parsed, opts);
    await noggin._init();
    return noggin;
  },
};

providers.register(vscodeTodoProvider);

/**
 * @public
 * Convenience factory: open a vscode-todo noggin from a real
 * filesystem path to `state.vscdb`, without constructing a URL.
 *
 * @param {string} statePath   Absolute path to a VS Code workspace's
 *                             `state.vscdb`.
 * @param {object} [opts]
 * @param {string} [opts.sessionId]      Restrict to one chat session.
 * @param {number} [opts.pollIntervalMs] Override the mtime poll
 *                                       cadence (default 2000ms).
 */
export async function openVscodeTodoNoggin(statePath, opts = {}) {
  if (!statePath) {
    throw new NogginError('vscode-todo: statePath required', { code: 'no-location', exitCode: 2 });
  }
  const abs = path.resolve(statePath);
  const location = `vscode-todo://${abs.replace(/\\/g, '/')}${opts.sessionId ? `#${opts.sessionId}` : ''}`;
  const noggin = new VscodeTodoNoggin({ file: abs, sessionId: opts.sessionId || null, location }, opts);
  await noggin._init();
  return noggin;
}

// ── Internals ────────────────────────────────────────────────────────────────

class VscodeTodoNoggin {
  constructor({ file, sessionId, location }, opts = {}) {
    this.file = file;
    this.location = location;
    this.readOnly = true;
    this._sessionId = sessionId || null;
    this._pollIntervalMs = typeof opts.pollIntervalMs === 'number'
      ? opts.pollIntervalMs
      : DEFAULT_POLL_INTERVAL_MS;

    /** @type {any} */
    this._doc = { schemaVersion: SCHEMA_VERSION, active: null, items: [] };
    /** Session title resolved from VS Code's `chat.ChatSessionStore.index`
     *  (or `agentSessions.model.cache`) at open time — the same string
     *  the Sessions sidebar displays. Cached so `describe()` is sync
     *  and stable; hosts that want a display label read it. */
    /** @type {string | null} */
    this._sessionTitle = null;
    /** @type {Set<() => void>} */
    this._changeListeners = new Set();
    /** @type {Set<(err: any) => void>} */
    this._errorListeners = new Set();
    this._disposed = false;
    this._pollTimer = null;
    this._lastFingerprint = '';

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
    // Fail fast if node:sqlite is unavailable (Node < 22.5).
    await getDatabaseCtor();
    if (!this._sessionId) {
      throw new NogginError(
        'vscode-todo: sessionId required. Pass it as the URI fragment '
        + '(vscode-todo://<path>#<sessionId>) or as opts.sessionId.',
        { code: 'sessionId-required', exitCode: 2 },
      );
    }
    if (!fs.existsSync(this.file)) {
      throw new NogginError(`vscode-todo: file not found: ${this.file}`, {
        code: 'io', exitCode: 2, data: { path: this.file },
      });
    }
    const { doc, fingerprint } = await this._readAndProject();
    this._doc = freezeDocument(doc);
    this._lastFingerprint = fingerprint;
    // Resolve the session's display title from the same registries
    // the picker enumerates. Best-effort — a session that isn't in
    // either registry just gets `null` and `describe()` falls back to
    // the location.
    this._sessionTitle = await resolveSessionTitle(this.file, this._sessionId);
    if (this._pollIntervalMs > 0) this._startPoll();
  }

  // ── Read accessors (identical shape to file/http/memory providers) ──
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

  /**
   * The session's title as VS Code renders it in its Sessions
   * sidebar (from the `chat.ChatSessionStore.index` or the
   * `agentSessions.model.cache`). Falls back to the noggin's
   * location string when the session couldn't be found in either
   * registry — keeps `describe()` non-null for hosts that use it
   * as a display label.
   */
  describe() { return this._sessionTitle || this.location; }

  // ── The (rejected) mutator ──────────────────────────────────────────
  apply(_ops) {
    return Promise.reject(new NogginError(
      'vscode-todo noggins are read-only (VS Code owns writes to the chat-todo-list memento)',
      { code: 'read-only', exitCode: 2 },
    ));
  }

  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    this._changeListeners.clear();
    this._errorListeners.clear();
  }

  // ── Watching ────────────────────────────────────────────────────────

  _startPoll() {
    if (typeof setInterval !== 'function') return;
    this._pollTimer = setInterval(() => {
      if (this._disposed) return;
      void this._maybeReload();
    }, this._pollIntervalMs);
    if (this._pollTimer && typeof this._pollTimer.unref === 'function') {
      this._pollTimer.unref();
    }
  }

  async _maybeReload() {
    // Cheap pre-filter: only re-read if either the main DB file or
    // its -wal sidecar has moved. SQLite in WAL mode journals writes
    // to the sidecar between checkpoints, so the main file's mtime
    // alone would miss most in-session updates.
    const mainMtime = safeMtimeMs(this.file);
    const walMtime = safeMtimeMs(`${this.file}-wal`);
    const cheapKey = `${mainMtime}:${walMtime}`;
    if (cheapKey === this._lastCheapKey) return;
    this._lastCheapKey = cheapKey;

    let readResult;
    try { readResult = await this._readAndProject(); }
    catch (e) {
      if (e instanceof NogginError) this._fireError(e);
      return;
    }
    if (readResult.fingerprint === this._lastFingerprint) return;
    if (documentsEqual(this._doc, readResult.doc)) {
      this._lastFingerprint = readResult.fingerprint;
      return;
    }
    const before = this._doc;
    const frozen = freezeDocument(readResult.doc);
    const changes = diffDocuments(before, frozen);
    this._doc = frozen;
    this._lastFingerprint = readResult.fingerprint;
    if (changes.length > 0) this._fireChange(changes);
  }

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

  // ── DB read + projection ────────────────────────────────────────────

  async _readAndProject() {
    const raw = await readMementoRow(this.file);
    const fingerprint = raw ?? '';
    const bySession = parseMemento(raw);
    const doc = projectDocument(bySession, this._sessionId);
    return { doc, fingerprint };
  }
}

/**
 * @public
 * Enumerate every chat session in this workspace. Reads the same
 * three registries VS Code's own Sessions sidebar aggregates:
 *
 *   1. `chat.ChatSessionStore.index` — panel chat sessions (title,
 *      lastMessageDate, isEmpty, isExternal).
 *   2. `agentSessions.model.cache` — agent-mode sessions from
 *      Copilot CLI / cloud / hosted agents (resource, label,
 *      timing.{created,lastRequestStarted,lastRequestEnded},
 *      changes stats).
 *   3. The `manage_todo_list` memento — where the tool writes its
 *      state; supplies `count` / `firstTitle`.
 *
 * Union is by session id (the `resource` field for agent sessions,
 * the object key for the other two). Sessions that VS Code marks
 * `isEmpty: true` in the chat index (opened once, never used) are
 * dropped.
 *
 * @param {string} statePath  Absolute path to a workspace's `state.vscdb`.
 * @returns {Promise<Array<{
 *   sessionId: string,
 *   count: number,
 *   firstTitle: string | null,
 *   sessionTitle: string | null,
 *   mtimeMs: number,
 *   hasSessionLog: boolean,
 *   isExternal: boolean,
 * }>>}
 */
export async function listVscodeTodoSessions(statePath) {
  const abs = path.resolve(statePath);

  /** @type {Map<string, { sessionId: string, count: number, firstTitle: string | null, sessionTitle: string | null, mtimeMs: number, hasSessionLog: boolean, isExternal: boolean }>} */
  const rows = new Map();
  const ensure = (sid) => {
    let r = rows.get(sid);
    if (!r) {
      r = { sessionId: sid, count: 0, firstTitle: null, sessionTitle: null, mtimeMs: 0, hasSessionLog: false, isExternal: false };
      rows.set(sid, r);
    }
    return r;
  };

  // Source 1: VS Code's chat session index — panel chat sessions.
  // Authoritative for local chat titles and recency.
  const index = await readChatSessionIndex(abs);
  for (const [sid, entry] of Object.entries(index)) {
    if (entry && entry.isEmpty) continue; // Skip never-used chats
    const r = ensure(sid);
    r.sessionTitle = typeof entry.title === 'string' && entry.title.trim() ? entry.title : null;
    r.mtimeMs = typeof entry.lastMessageDate === 'number' ? entry.lastMessageDate : 0;
    r.isExternal = entry.isExternal === true;
    r.hasSessionLog = !r.isExternal; // Local sessions have a .jsonl / .json in chatSessions/
  }

  // Source 2: VS Code's agent-sessions cache — the second half of
  // what the Sessions sidebar renders. Every Copilot CLI, cloud,
  // and hosted-agent session appears here with its label, timing,
  // and change stats. Entries with `providerType === 'local'`
  // duplicate what the chat index already carries (they wrap a
  // native panel session in an agent-view shim) — skip those to
  // avoid double-listing every local chat.
  const agentSessions = await readAgentSessionsCache(abs);
  for (const s of agentSessions) {
    if (typeof s.resource !== 'string') continue;
    if (s.providerType === 'local') continue;
    const sid = s.resource;
    const r = ensure(sid);
    // Prefer the agent-cache label when the chat index didn't
    // supply a title (the agent cache carries the same rendered
    // label the sidebar shows). Keep an existing index title if
    // both are set — the chat index is closer to VS Code's own
    // display precedence.
    if (!r.sessionTitle && typeof s.label === 'string' && s.label.trim()) {
      r.sessionTitle = s.label;
    }
    const timing = s.timing || {};
    const agentMtime = typeof timing.lastRequestEnded === 'number'
      ? timing.lastRequestEnded
      : (typeof timing.lastRequestStarted === 'number'
        ? timing.lastRequestStarted
        : (typeof timing.created === 'number' ? timing.created : 0));
    if (agentMtime > r.mtimeMs) r.mtimeMs = agentMtime;
    // Agent sessions are always "external" from the local chat
    // panel's perspective — mark them accordingly.
    r.isExternal = true;
  }

  // Source 3: the memento — where `manage_todo_list` writes end up.
  // Contributes `count` and `firstTitle` for sessions that have
  // called the tool. May include sessions absent from both
  // catalogues (e.g. deleted or migrated); include them anyway
  // with hasSessionLog = false so the user can still open them.
  const raw = await readMementoRow(abs);
  const bySession = parseMemento(raw);
  for (const sid of Object.keys(bySession)) {
    const todos = Array.isArray(bySession[sid]) ? bySession[sid] : [];
    const r = ensure(sid);
    r.count = todos.length;
    r.firstTitle = todos.length > 0 ? String(todos[0].title ?? '') : null;
  }

  return [...rows.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Resolve `sessionId`'s display title from the same two registries
 * `listVscodeTodoSessions` unions. Returns null when the session
 * isn't in either — the noggin still opens (a fresh session may
 * appear before either store records it), just without a nice
 * label.
 *
 * @param {string} statePath
 * @param {string} sessionId
 * @returns {Promise<string | null>}
 */
async function resolveSessionTitle(statePath, sessionId) {
  if (!sessionId) return null;
  try {
    const index = await readChatSessionIndex(statePath);
    const entry = index[sessionId];
    if (entry && typeof entry.title === 'string' && entry.title.trim()) {
      return entry.title;
    }
  } catch { /* fall through */ }
  try {
    const agentSessions = await readAgentSessionsCache(statePath);
    const match = agentSessions.find((s) => s && s.resource === sessionId);
    if (match && typeof match.label === 'string' && match.label.trim()) {
      return match.label;
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * Read the workspace's chat session index (`chat.ChatSessionStore.index`)
 * from `state.vscdb`. Returns an empty object when the row is
 * missing or malformed — that's the natural state for a workspace
 * that has never opened Copilot Chat.
 *
 * @param {string} file
 * @returns {Promise<Record<string, { title?: string; lastMessageDate?: number; isEmpty?: boolean; isExternal?: boolean; initialLocation?: string }>>}
 */
async function readChatSessionIndex(file) {
  const DatabaseSync = await getDatabaseCtor();
  if (!fs.existsSync(file)) return {};
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(CHAT_INDEX_KEY);
    if (!row) return {};
    const raw = typeof row.value === 'string' ? row.value : String(row.value);
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return {}; }
    if (!parsed || typeof parsed !== 'object' || !parsed.entries || typeof parsed.entries !== 'object') return {};
    return parsed.entries;
  } finally {
    db.close();
  }
}

/**
 * Read the workspace's agent-sessions cache
 * (`agentSessions.model.cache`) from `state.vscdb`. Returns an
 * empty array when the row is missing or malformed.
 *
 * Shape of each entry (from `agentSessionsModel.ts`
 * `IInternalAgentSessionData` / `ISerializedAgentSession`):
 *   {
 *     providerType: 'copilotcli' | 'agentHost' | …,
 *     providerLabel: 'Copilot CLI' | …,
 *     resource: string,                  // session URI as string
 *     icon: string,                      // codicon id
 *     label: string,                     // display title
 *     status: number,
 *     timing: { created, lastRequestStarted?, lastRequestEnded? },
 *     changes?: …,
 *     metadata?: …,
 *   }
 *
 * @param {string} file
 * @returns {Promise<Array<{ resource?: string; label?: string; timing?: { created?: number; lastRequestStarted?: number; lastRequestEnded?: number } }>>}
 */
async function readAgentSessionsCache(file) {
  const DatabaseSync = await getDatabaseCtor();
  if (!fs.existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(AGENT_SESSIONS_CACHE_KEY);
    if (!row) return [];
    const raw = typeof row.value === 'string' ? row.value : String(row.value);
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return []; }
    return Array.isArray(parsed) ? parsed : [];
  } finally {
    db.close();
  }
}

/**
 * Read the first chunk of a chat-session `.jsonl` and try to
/**
 * Read the raw JSON string value of the `memento/chat-todo-list` row
 * from an ItemTable. Returns `null` if the row is missing.
 */
async function readMementoRow(file) {
  const DatabaseSync = await getDatabaseCtor();
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(MEMENTO_KEY);
    if (!row) return null;
    return typeof row.value === 'string' ? row.value : String(row.value);
  } finally {
    db.close();
  }
}

function parseMemento(raw) {
  if (!raw) return {};
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) {
    throw new NogginError(`vscode-todo: memento value is not JSON (${e.message})`, {
      code: 'invalid-memento', exitCode: 2,
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new NogginError('vscode-todo: memento value must be an object keyed by sessionId', {
      code: 'invalid-memento', exitCode: 2,
    });
  }
  return /** @type {Record<string, Array<{ id: number; title: string; status: string }>>} */ (parsed);
}

/**
 * Project the raw memento shape into a NogginDocument. Pure function
 * — same input always produces the same output, which is what lets
 * `documentsEqual` short-circuit the watch loop on no-op re-reads.
 *
 * Always scoped to a single `sessionId`. If the session isn’t
 * present in the memento (deleted from VS Code, wrong id typed by
 * the user) the projection is an empty document — that’s a
 * transient state, not an error.
 */
function projectDocument(bySession, sessionId) {
  const items = [];
  const todos = Array.isArray(bySession[sessionId]) ? bySession[sessionId] : [];
  for (const todo of todos) {
    const status = String(todo.status ?? 'not-started');
    const notes = [];
    if (status === 'in-progress') {
      notes.push({ timestamp: null, text: 'in-progress' });
    }
    items.push({
      key: todoKey(sessionId, todo.id),
      parentKey: null,
      title: String(todo.title ?? ''),
      done: status === 'completed',
      createdAt: CREATED_AT_SENTINEL,
      notes,
    });
  }

  const doc = { schemaVersion: SCHEMA_VERSION, active: null, items };
  return normalizeDocument(doc);
}

function todoKey(sid, id) {
  return `vt-t-${sid}-${id}`;
}

function safeMtimeMs(file) {
  try { return fs.statSync(file).mtimeMs; }
  catch { return 0; }
}

/**
 * Parse a `vscode-todo://` URL. Accepts either a Windows-style
 * post-scheme path (`/c:/Users/.../state.vscdb`) or a POSIX absolute
 * path, with an optional `#sessionId` fragment.
 */
function parseVscodeTodoLocation(original, rest) {
  // Prefer WHATWG URL parsing when we have the full URI — it strips
  // the leading `/` in front of Windows drive letters, decodes
  // percent-escapes, and pulls the fragment out cleanly.
  let file;
  let fragment = '';
  try {
    const u = new URL(original);
    fragment = u.hash ? u.hash.slice(1) : '';
    // `pathname` includes the leading `/`. Windows drive-letter
    // paths come through as `/C:/...` — `fileURLToPath` on a synthetic
    // `file://` sibling handles the drive-letter unwind for us.
    const stripped = u.pathname.replace(/^\/+/, '');
    if (/^[a-zA-Z]:/.test(stripped)) {
      file = url.fileURLToPath(`file:///${stripped}`);
    } else {
      file = url.fileURLToPath(`file:///${stripped}`);
    }
  } catch {
    // Fall back to raw rest parsing.
    const [pathPart, hashPart = ''] = String(rest).split('#');
    fragment = hashPart;
    file = pathPart.replace(/^\/+([a-zA-Z]:)/, '$1');
  }
  return { file: path.resolve(file), sessionId: fragment || null, location: original };
}

let _cachedDatabaseCtor;
/**
 * Lazy-load `node:sqlite`. Returns the `DatabaseSync` constructor.
 * Cached across opens. Throws a clean `NogginError` on Node runtimes
 * that don't have it (< 22.5).
 */
async function getDatabaseCtor() {
  if (_cachedDatabaseCtor) return _cachedDatabaseCtor;
  try {
    const mod = await import('node:sqlite');
    _cachedDatabaseCtor = mod.DatabaseSync;
    return _cachedDatabaseCtor;
  } catch (e) {
    throw new NogginError(
      'vscode-todo: node:sqlite is unavailable (requires Node ≥ 22.5, ideally ≥ 24)',
      { code: 'sqlite-unavailable', exitCode: 2, data: { detail: e && e.message } },
    );
  }
}

// findByKey — inlined for the same reason http/memory providers do.
function findByKey(items, key) {
  for (const it of items) if (it.key === key) return it;
  return null;
}
