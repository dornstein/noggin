// noggin-api — typed, in-process API for the noggin working-memory tree.
//
// Used by both the CLI wrapper (cli/noggin.mjs) and the VS Code extension.
// Two layers:
//   1. Stateless verb functions (`apiPush`, `apiAdd`, …) that take a file
//      path and an options object, do load → mutate → save, and return a
//      view of the resulting tree. These power the CLI.
//   2. `Noggin` class — long-lived handle over one file. Caches the parsed
//      store, watches the file for external edits, fires onDidChange.
//      Used by the extension.
//
// Every failure throws a `NogginError` with a stable `code` and a CLI-style
// `exitCode`. Nothing in here writes to process.stderr or calls process.exit;
// that is the CLI wrapper's job. Error messages preserve the exact wording
// of the original cli.mjs so user-visible behaviour is unchanged.

/// <reference path="./noggin-api.d.ts" />

import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const SCHEMA_VERSION = 1;
export const DEFAULT_FILE = path.join(os.homedir(), '.noggin.yaml');

// ── Errors ───────────────────────────────────────────────────────────────────

export class NogginError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, exitCode?: number }} [opts]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = 'NogginError';
    this.code = opts.code || 'noggin-error';
    this.exitCode = typeof opts.exitCode === 'number' ? opts.exitCode : 2;
  }
}

/** Throw a usage-style error (exit code 2). */
function usage(code, message) {
  throw new NogginError(message, { code, exitCode: 2 });
}

/** Throw a runtime/state-style error (exit code 1). */
function runtime(code, message) {
  throw new NogginError(message, { code, exitCode: 1 });
}

// ── Low-level helpers ────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function newKey() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const slug =
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  const hex = crypto.randomBytes(3).toString('hex');
  return `i-${slug}-${hex}`;
}

function emptyStore() {
  return { schemaVersion: SCHEMA_VERSION, active: null, items: [] };
}

function normalizeNote(note) {
  if (note && typeof note === 'object' && note.text !== undefined) {
    return { timestamp: note.timestamp ? String(note.timestamp) : null, text: String(note.text) };
  }
  usage('invalid-note', 'internal: invalid note object');
}

function normalizeStore(store) {
  store.schemaVersion = SCHEMA_VERSION;
  for (const f of store.items) {
    if (!Array.isArray(f.notes)) usage('invalid-store', 'invalid contents: item notes must be an array');
    f.notes = f.notes.map(normalizeNote);
  }
  return store;
}

function validateStore(store) {
  const keys = new Set();
  for (const f of store.items) {
    if (!f.key) usage('invalid-store', 'internal: item missing key');
    if (keys.has(f.key)) usage('invalid-store', 'internal: duplicate item key detected');
    keys.add(f.key);
  }
  for (const f of store.items) {
    if (f.parentKey && !keys.has(f.parentKey)) {
      usage('invalid-store', 'internal: item has unknown parent reference');
    }
  }
  if (store.active && !keys.has(store.active)) {
    usage('invalid-store', 'internal: active points to unknown item');
  }
}

/**
 * Load and validate a YAML store. Returns an empty store if the file does
 * not exist or is empty.
 */
export function loadStore(filePath) {
  if (!fs.existsSync(filePath)) return emptyStore();
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch (e) { usage('io', `failed to read ${filePath}: ${e.message}`); }
  if (!raw.trim()) return emptyStore();
  let data;
  try { data = yaml.load(raw); }
  catch (e) { usage('invalid-store', `failed to parse ${filePath}: ${e.message}`); }
  if (!data || typeof data !== 'object') {
    usage('invalid-store', `invalid contents in ${filePath}: expected a mapping`);
  }
  if (data.schemaVersion !== SCHEMA_VERSION) {
    usage(
      'unsupported-schema',
      `schemaVersion ${data.schemaVersion} in ${filePath} not supported by this CLI ` +
        `(expected ${SCHEMA_VERSION}).`,
    );
  }
  if (!Array.isArray(data.items)) usage('invalid-store', `invalid contents in ${filePath}: expected items array`);
  if (data.active === undefined) usage('invalid-store', `invalid contents in ${filePath}: expected active field`);
  return normalizeStore(data);
}

function dumpStore(store) {
  return yaml.dump(store, { noRefs: true, lineWidth: 100, sortKeys: false });
}

function writeAtomic(filePath, contents) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, filePath);
}

/** Write a YAML store. Atomic where the platform allows. */
export function saveStore(filePath, store) {
  normalizeStore(store);
  validateStore(store);
  writeAtomic(filePath, dumpStore(store));
}

// ── Tree helpers ─────────────────────────────────────────────────────────────

function findByKey(items, key) {
  if (!key) return null;
  return items.find((f) => f.key === key) || null;
}

function _childrenOf(items, parentKey) {
  return items.filter((f) => f.parentKey === parentKey);
}

function siblingsOf(items, item) {
  if (!item) return [];
  return _childrenOf(items, item.parentKey).filter((f) => f.key !== item.key);
}

function positionOf(items, item) {
  if (!item) return null;
  const siblings = _childrenOf(items, item.parentKey);
  const index = siblings.findIndex((s) => s.key === item.key);
  return index >= 0 ? index + 1 : null;
}

function _pathOf(items, item) {
  if (!item) return null;
  const parts = [];
  let f = item;
  while (f) {
    const position = positionOf(items, f);
    if (!position) return null;
    parts.unshift(String(position));
    f = f.parentKey ? findByKey(items, f.parentKey) : null;
  }
  return parts.join('/');
}

function ancestorsOf(items, item) {
  const chain = [];
  let f = item;
  while (f && f.parentKey) {
    const p = findByKey(items, f.parentKey);
    if (!p) break;
    chain.unshift(p);
    f = p;
  }
  return chain;
}

// ── Path resolution ──────────────────────────────────────────────────────────

function siblingRelative(items, item, delta, originalForError) {
  const peers = _childrenOf(items, item.parentKey || null);
  const index = peers.findIndex((p) => p.key === item.key);
  const target = peers[index + delta];
  if (!target) {
    const direction = delta < 0 ? 'previous' : 'next';
    return { ok: false, error: `path '${originalForError}': active item has no ${direction} sibling` };
  }
  return { ok: true, item: target };
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
    const match = _childrenOf(items, parentKey)[position - 1];
    if (!match) {
      const where = current ? `under '${_pathOf(items, current)}'` : 'at root';
      return { ok: false, error: `path not found: ${originalForError} (no position ${position} ${where})` };
    }
    current = match;
  }
  return { ok: true, item: current };
}

/**
 * Resolve a path string against a store. Mirrors the CLI's path grammar:
 * '.', '..', '-', '+', './X', '../X', '-/X/Y', '../../X', and absolute 'X/Y/Z'.
 * Returns `{ ok: true, item } | { ok: false, error }`.
 */
function tryResolveDetailed(store, p) {
  if (!p) return { ok: false, error: `path: empty path` };
  const s = String(p);
  const active = store.active ? findByKey(store.items, store.active) : null;

  if (s === '.') {
    if (!active) return { ok: false, error: `path '.': no active item` };
    return { ok: true, item: active };
  }
  if (s === '..') {
    if (!active) return { ok: false, error: `path '..': no active item` };
    if (!active.parentKey) return { ok: false, error: `path '..': active item has no parent` };
    return { ok: true, item: findByKey(store.items, active.parentKey) };
  }
  if (s === '-' || s === '+') {
    if (!active) return { ok: false, error: `path '${s}': no active item` };
    return siblingRelative(store.items, active, s === '-' ? -1 : 1, s);
  }

  if (s.startsWith('-/') || s.startsWith('+/')) {
    if (!active) return { ok: false, error: `path '${s}' is relative but no active item` };
    const direction = s[0] === '-' ? -1 : 1;
    const sibling = siblingRelative(store.items, active, direction, s);
    if (!sibling.ok) return sibling;
    const rest = s.slice(2);
    if (rest === '') return { ok: false, error: `path '${s}': trailing slash with no descendant` };
    return walkPath(store.items, sibling.item, rest, s);
  }

  if (s.startsWith('./') || s.startsWith('../')) {
    if (!active) return { ok: false, error: `path '${s}' is relative but no active item` };
    let base = active;
    let rest = s;
    while (rest === '..' || rest.startsWith('../')) {
      if (!base.parentKey) return { ok: false, error: `path '${s}': cannot go above root` };
      base = findByKey(store.items, base.parentKey);
      rest = rest === '..' ? '' : rest.slice(3);
    }
    if (rest.startsWith('./')) rest = rest.slice(2);
    if (rest === '') return { ok: true, item: base };
    return walkPath(store.items, base, rest, s);
  }

  return walkPath(store.items, null, s, s);
}

/** Resolve a path or throw NogginError (exit 1). */
export function resolvePath(store, p) {
  const r = tryResolveDetailed(store, p);
  if (r.ok) return r.item;
  runtime('path-not-found', r.error);
}

/** Resolve a path or return null. */
export function tryResolvePath(store, p) {
  const r = tryResolveDetailed(store, p);
  return r.ok ? r.item : null;
}

/** Compute the absolute 1-based path for an item in the store. */
export function pathOf(store, item) {
  return _pathOf(store.items, item);
}

/** Children of a parent (null = roots), in stable on-disk order. */
export function childrenOf(store, parentKey) {
  return _childrenOf(store.items, parentKey || null);
}

// ── Subtree utilities ────────────────────────────────────────────────────────

function isDescendant(items, candidate, root) {
  if (!candidate || !root) return false;
  let node = candidate;
  while (node && node.parentKey) {
    if (node.parentKey === root.key) return true;
    node = findByKey(items, node.parentKey);
  }
  return false;
}

function countOpenDescendants(items, root) {
  let n = 0;
  const stack = _childrenOf(items, root.key);
  while (stack.length) {
    const f = stack.pop();
    if (!f.done) n++;
    for (const c of _childrenOf(items, f.key)) stack.push(c);
  }
  return n;
}

function collectDescendants(items, root) {
  const out = [];
  const stack = [..._childrenOf(items, root.key)];
  while (stack.length) {
    const f = stack.pop();
    out.push(f);
    for (const c of _childrenOf(items, f.key)) stack.push(c);
  }
  return out;
}

// ── View builders ────────────────────────────────────────────────────────────

function toPublicItem(items, f) {
  return {
    key: f.key,
    parentKey: f.parentKey || null,
    path: _pathOf(items, f),
    position: positionOf(items, f),
    title: f.title,
    done: Boolean(f.done),
    pushedAt: f.pushedAt,
    closedAt: f.closedAt,
    notes: Array.isArray(f.notes) ? f.notes.map(normalizeNote) : [],
  };
}

/**
 * Build the CurrentTreeView shape (the same JSON the CLI emits via
 * `emitCurrentTree`). Pure — does not mutate the store.
 */
export function buildView(store, target, opts = {}) {
  if (!target) return null;
  const includeChildren = opts.includeChildren !== false;
  const kids = includeChildren
    ? _childrenOf(store.items, target.key).map((k) => toPublicItem(store.items, k))
    : undefined;
  const sibs = siblingsOf(store.items, target).map((s) => toPublicItem(store.items, s));
  return {
    ...toPublicItem(store.items, target),
    active: store.active ? _pathOf(store.items, findByKey(store.items, store.active)) : null,
    ancestors: ancestorsOf(store.items, target).map((a) => toPublicItem(store.items, a)),
    siblings: sibs,
    ...(includeChildren ? { children: kids } : {}),
  };
}

// ── File resolution ──────────────────────────────────────────────────────────

/**
 * Resolve the noggin file path with the same priority as the CLI:
 *   1. `opts.file`
 *   2. `opts.env.NOGGIN_FILE` (defaults to process.env)
 *   3. `~/.noggin.yaml`
 */
export function resolveFile(opts = {}) {
  const env = opts.env || process.env;
  let file, source;
  if (opts.file) { file = opts.file; source = 'flag'; }
  else if (env.NOGGIN_FILE) { file = env.NOGGIN_FILE; source = 'env'; }
  else { file = DEFAULT_FILE; source = 'default'; }
  return {
    file,
    source,
    exists: fs.existsSync(file),
    defaultFile: DEFAULT_FILE,
    env: env.NOGGIN_FILE || null,
  };
}

// ── Internal verb helpers ────────────────────────────────────────────────────

function applyGoto(store, base, goto, commandName) {
  if (goto === undefined) return base;
  if (!base) runtime('goto-base-missing', `${commandName}: --goto has no base item`);
  const gotoPath = goto === true ? '.' : goto;
  if (!gotoPath) runtime('goto-path-required', `${commandName}: --goto requires a path`);
  const scopedStore = { ...store, active: base.key };
  const resolved = tryResolveDetailed(scopedStore, gotoPath);
  if (!resolved.ok) runtime('goto-unresolved', `${commandName}: --goto ${resolved.error}`);
  store.active = resolved.item.key;
  return resolved.item;
}

function makeItem({ title, parentKey }) {
  return {
    key: newKey(),
    parentKey,
    title,
    done: false,
    pushedAt: nowIso(),
    closedAt: null,
    notes: [],
  };
}

/**
 * Validate a placement option ({ kind, anchor } where anchor is a path).
 * Returns the resolved anchor item and the kind.
 */
function resolvePlacement(store, placement, commandName) {
  if (!placement) return null;
  const { kind, anchor } = placement;
  if (!kind || !anchor) {
    usage('placement-missing', `${commandName}: placement requires both kind and anchor`);
  }
  if (kind !== 'before' && kind !== 'after' && kind !== 'into') {
    usage('placement-invalid', `${commandName}: unknown placement kind '${kind}'`);
  }
  const anchorItem = resolvePath(store, anchor);
  return { kind, anchor: anchorItem };
}

// ── Verb implementations ─────────────────────────────────────────────────────

/**
 * push: create a child of active (or a root if none) and become active.
 */
export function apiPush(file, opts) {
  const title = (opts && opts.title || '').toString().trim();
  if (!title) usage('title-required', 'push: title required (--title or positional)');
  const store = loadStore(file);
  const activeItem = findByKey(store.items, store.active);
  const item = makeItem({ title, parentKey: activeItem ? activeItem.key : null });
  store.items.push(item);
  store.active = item.key;
  saveStore(file, store);
  return buildView(store, item);
}

/**
 * add: create an item. With no placement, becomes a child of active (or root).
 * Placement flags (`{ kind: 'before'|'after'|'into', anchor: path }`) override.
 * Active is unchanged unless `goto` is supplied.
 */
export function apiAdd(file, opts = {}) {
  const title = (opts.title || '').toString().trim();
  if (!title) usage('title-required', 'add: title required (--title or positional)');
  const store = loadStore(file);
  const activeItem = findByKey(store.items, store.active);
  const placement = resolvePlacement(store, opts.placement, 'add');

  let parentKey;
  let insertIndex;
  if (placement) {
    const { kind, anchor } = placement;
    if (kind === 'into') {
      parentKey = anchor.key;
      insertIndex = store.items.length;
    } else {
      parentKey = anchor.parentKey;
      const anchorIdx = store.items.indexOf(anchor);
      insertIndex = kind === 'before' ? anchorIdx : anchorIdx + 1;
    }
  } else {
    parentKey = activeItem ? activeItem.key : null;
    insertIndex = store.items.length;
  }

  const item = makeItem({ title, parentKey });
  store.items.splice(insertIndex, 0, item);
  const outputTarget = opts.goto !== undefined ? applyGoto(store, item, opts.goto, 'add') : item;
  saveStore(file, store);
  return buildView(store, outputTarget);
}

/**
 * move: relocate an item. Default target = active. Placement is required.
 * Active pointer is preserved by key; cycles are rejected.
 */
export function apiMove(file, opts = {}) {
  const store = loadStore(file);
  const placement = resolvePlacement(store, opts.placement, 'move');
  if (!placement) usage('placement-missing', 'move: choose exactly one of --before, --after, or --into');
  const { kind, anchor } = placement;

  let target;
  if (opts.path) target = resolvePath(store, opts.path);
  else {
    target = findByKey(store.items, store.active);
    if (!target) runtime('no-active-item', 'move: no active item; pass a path');
  }

  if (kind === 'into') {
    if (target.key === anchor.key) {
      runtime('cycle', `move: cannot move ${_pathOf(store.items, target)} into itself (would create a cycle)`);
    }
    if (isDescendant(store.items, anchor, target)) {
      runtime('cycle', `move: cannot move ${_pathOf(store.items, target)} into its own subtree (would create a cycle)`);
    }
  } else {
    if (isDescendant(store.items, anchor, target)) {
      runtime('cycle', `move: cannot move ${_pathOf(store.items, target)} next to its own descendant (would create a cycle)`);
    }
    if (anchor.key === target.key) {
      // before/after self: same place. Silent no-op.
      const activeItem = findByKey(store.items, store.active);
      const outputTarget = opts.goto !== undefined ? applyGoto(store, target, opts.goto, 'move') : (activeItem || target);
      saveStore(file, store);
      return buildView(store, outputTarget);
    }
  }

  const newParentKey = kind === 'into' ? anchor.key : anchor.parentKey;
  const targetIdx = store.items.indexOf(target);
  store.items.splice(targetIdx, 1);

  let insertIndex;
  if (kind === 'into') {
    insertIndex = store.items.length;
  } else {
    const anchorIdx = store.items.indexOf(anchor);
    insertIndex = kind === 'before' ? anchorIdx : anchorIdx + 1;
  }

  target.parentKey = newParentKey;
  store.items.splice(insertIndex, 0, target);

  const activeItem = findByKey(store.items, store.active);
  const outputTarget = opts.goto !== undefined ? applyGoto(store, target, opts.goto, 'move') : (activeItem || target);
  saveStore(file, store);
  return buildView(store, outputTarget);
}

/** goto: make the item at `path` active. */
export function apiGoto(file, opts = {}) {
  if (!opts.path) usage('path-required', 'goto: path required');
  const store = loadStore(file);
  const target = resolvePath(store, opts.path);
  store.active = target.key;
  saveStore(file, store);
  return buildView(store, target);
}

/** done: mark an item done, then move active to the target's parent. */
export function apiDone(file, opts = {}) {
  if (opts.goto !== undefined) usage('goto-unsupported', 'done: --goto is not supported; done always moves to the target parent');
  const store = loadStore(file);
  let target;
  if (opts.path) target = resolvePath(store, opts.path);
  else {
    target = findByKey(store.items, store.active);
    if (!target) runtime('no-active-item', 'done: no active item; pass a path');
  }
  if (target.done) runtime('already-done', `done: ${_pathOf(store.items, target)} already done`);
  const open = countOpenDescendants(store.items, target);
  if (open > 0) runtime('open-descendants', `done: ${_pathOf(store.items, target)} has ${open} open descendant(s); mark them done first`);
  target.done = true;
  target.closedAt = nowIso();
  const parent = target.parentKey ? findByKey(store.items, target.parentKey) : null;
  store.active = parent ? parent.key : null;
  saveStore(file, store);
  return buildView(store, parent || target);
}

/** pop: shorthand for done() on the active item. */
export function apiPop(file, opts = {}) {
  if (opts && opts.path !== undefined) usage('pop-no-path', 'pop: takes no path; pop always operates on the active item');
  if (opts && opts.goto !== undefined) usage('goto-unsupported', 'pop: --goto is not supported; pop always moves to the active item\'s parent');
  const store = loadStore(file);
  if (!findByKey(store.items, store.active)) runtime('no-active-item', 'pop: no active item');
  return apiDone(file, {});
}

/** set-state: explicitly set lifecycle state. */
export function apiSetState(file, opts = {}) {
  if (typeof opts.done !== 'boolean') usage('state-missing', 'set-state: choose exactly one of --done or --undone');
  const store = loadStore(file);
  let target;
  if (opts.path) target = resolvePath(store, opts.path);
  else {
    target = findByKey(store.items, store.active);
    if (!target) runtime('no-active-item', 'set-state: no active item; pass a path');
  }

  if (opts.done) {
    const open = countOpenDescendants(store.items, target);
    if (open > 0) runtime('open-descendants', `set-state: ${_pathOf(store.items, target)} has ${open} open descendant(s); mark them done first`);
    if (!target.done) target.closedAt = nowIso();
    target.done = true;
  } else {
    target.done = false;
    target.closedAt = null;
  }

  const outputTarget = opts.goto !== undefined ? applyGoto(store, target, opts.goto, 'set-state') : target;
  saveStore(file, store);
  return buildView(store, outputTarget);
}

/**
 * show: detail for one item plus first-level children. Default target = active.
 * Returns null if no target can be resolved (no active item, no path given).
 */
export function apiShow(file, opts = {}) {
  const store = loadStore(file);
  const target = opts.path
    ? resolvePath(store, opts.path)
    : findByKey(store.items, store.active);
  if (!target) return null;
  const outputTarget = opts.goto !== undefined ? applyGoto(store, target, opts.goto, 'show') : target;
  if (opts.goto !== undefined) saveStore(file, store);
  return buildView(store, outputTarget, { includeChildren: opts.nokids !== true });
}

/** note: append a timestamped note. Path defaults to active. */
export function apiNote(file, opts = {}) {
  const text = (opts.text || '').toString().trim();
  if (!text) usage('text-required', 'note: text required');
  const store = loadStore(file);
  let target;
  if (opts.path) target = resolvePath(store, opts.path);
  else {
    target = findByKey(store.items, store.active);
    if (!target) runtime('no-active-item', 'note: no active item and no path given');
  }
  if (!Array.isArray(target.notes)) target.notes = [];
  target.notes.push({ timestamp: nowIso(), text });
  const outputTarget = opts.goto !== undefined ? applyGoto(store, target, opts.goto, 'note') : target;
  saveStore(file, store);
  return buildView(store, outputTarget);
}

/** retitle: change an item's title. Path defaults to active. */
export function apiRetitle(file, opts = {}) {
  const title = (opts.title || '').toString().trim();
  if (!title) usage('title-required', 'retitle: new title required');
  const store = loadStore(file);
  let target;
  if (opts.path) target = resolvePath(store, opts.path);
  else {
    target = findByKey(store.items, store.active);
    if (!target) runtime('no-active-item', 'retitle: no active item and no path given');
  }
  target.title = title;
  const outputTarget = opts.goto !== undefined ? applyGoto(store, target, opts.goto, 'retitle') : target;
  saveStore(file, store);
  return buildView(store, outputTarget);
}

/**
 * delete: remove an item. Refuses if it has descendants unless `recursive`.
 * If the deleted subtree contains the active item, active becomes the
 * deleted item's parent (or null if it was a root).
 */
export function apiDelete(file, opts = {}) {
  if (opts.goto !== undefined) usage('goto-unsupported', 'delete: --goto is not supported');
  if (!opts.path) usage('path-required', 'delete: path required');
  const store = loadStore(file);
  const target = resolvePath(store, opts.path);
  const targetPath = _pathOf(store.items, target);
  const descendants = collectDescendants(store.items, target);
  if (descendants.length > 0 && opts.recursive !== true) {
    runtime(
      'has-descendants',
      `delete: ${targetPath} has ${descendants.length} descendant(s); ` +
        `pass --recursive to delete the whole subtree`,
    );
  }
  const removeKeys = new Set([target.key, ...descendants.map((d) => d.key)]);
  const activeWasRemoved = store.active != null && removeKeys.has(store.active);
  store.items = store.items.filter((i) => !removeKeys.has(i.key));
  if (activeWasRemoved) {
    store.active = target.parentKey || null;
  }
  saveStore(file, store);
  const newActive = findByKey(store.items, store.active);
  const view = newActive ? buildView(store, newActive) : null;
  const result = {
    deleted: targetPath,
    descendantCount: descendants.length,
    active: newActive ? _pathOf(store.items, newActive) : null,
  };
  if (view) result.view = view;
  return result;
}

/** where: returns the resolved file info for the current options. */
export function apiWhere(opts = {}) {
  return resolveFile(opts);
}

// ── Noggin class ─────────────────────────────────────────────────────────────

/**
 * Long-lived handle over a single noggin file. Caches the parsed store in
 * memory, watches the file for external edits, and fires onDidChange when
 * the store changes (via a verb method or an external edit).
 *
 * Read accessors are cheap. Verbs reload from disk before mutating so they
 * see any external edits, then write atomically and refresh the cache.
 */
export class Noggin {
  /**
   * @param {string} file Absolute path to the noggin YAML file.
   * @param {{ watch?: boolean }} [opts]
   */
  constructor(file, opts = {}) {
    if (!file) throw new NogginError('Noggin: file path required', { code: 'no-file', exitCode: 2 });
    this.file = file;
    /** @type {any} */
    this._store = emptyStore();
    /** @type {Set<() => void>} */
    this._changeListeners = new Set();
    /** @type {Set<(err: NogginError) => void>} */
    this._errorListeners = new Set();
    this._watcher = null;
    this._reloadTimer = null;
    this._disposed = false;

    // Bind so they look like vscode.Event<T>: function-shaped subscribe.
    this.onDidChange = (handler) => {
      this._changeListeners.add(handler);
      return { dispose: () => this._changeListeners.delete(handler) };
    };
    this.onDidError = (handler) => {
      this._errorListeners.add(handler);
      return { dispose: () => this._errorListeners.delete(handler) };
    };

    // Best-effort initial load. A bad file surfaces as onDidError but the
    // instance still works (the cache stays empty until reload succeeds).
    try { this._store = freezeStore(loadStore(file)); }
    catch (e) {
      if (e instanceof NogginError) this._fireError(e);
      else throw e;
    }

    if (opts.watch) this._startWatch();
  }

  // ── Read accessors ──────────────────────────────────────────────────
  get store() { return this._store; }
  get active() { return this._store.active ? findByKey(this._store.items, this._store.active) : null; }
  get roots() { return _childrenOf(this._store.items, null); }

  findByKey(key) { return findByKey(this._store.items, key); }
  childrenOf(parentKey) { return _childrenOf(this._store.items, parentKey || null); }
  pathOf(item) { return _pathOf(this._store.items, item); }
  resolvePath(p) { return resolvePath(this._store, p); }
  tryResolvePath(p) { return tryResolvePath(this._store, p); }

  /**
   * Build a CurrentTreeView. Target may be an item, a path string, or null
   * (defaults to the active item). Returns null if no target is found.
   */
  view(target, opts = {}) {
    let item = null;
    if (target == null) item = this.active;
    else if (typeof target === 'string') item = this.tryResolvePath(target);
    else item = target;
    if (!item) return null;
    return buildView(this._store, item, opts);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  /** Reload from disk. Returns true if the cached store actually changed. */
  reload() {
    const prev = this._store;
    let next;
    try { next = loadStore(this.file); }
    catch (e) {
      if (e instanceof NogginError) { this._fireError(e); return false; }
      throw e;
    }
    if (storesEqual(prev, next)) return false;
    this._store = freezeStore(next);
    this._fireChange();
    return true;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._reloadTimer) { clearTimeout(this._reloadTimer); this._reloadTimer = null; }
    if (this._watcher) { try { this._watcher.close(); } catch { /* ignore */ } this._watcher = null; }
    this._changeListeners.clear();
    this._errorListeners.clear();
  }

  // ── Verbs ───────────────────────────────────────────────────────────
  push(opts) { return this._run(apiPush, opts); }
  add(opts) { return this._run(apiAdd, opts); }
  move(opts) { return this._run(apiMove, opts); }
  goto(p) { return this._run(apiGoto, { path: p }); }
  done(opts) { return this._run(apiDone, opts); }
  pop() { return this._run(apiPop, {}); }
  setState(opts) { return this._run(apiSetState, opts); }
  show(opts) { return this._runRead(apiShow, opts); }
  note(opts) { return this._run(apiNote, opts); }
  retitle(opts) { return this._run(apiRetitle, opts); }
  delete(opts) { return this._run(apiDelete, opts); }
  where() { return resolveFile({ file: this.file }); }

  // ── Internals ───────────────────────────────────────────────────────

  _run(fn, opts) {
    const result = fn(this.file, opts || {});
    // Refresh cache and notify listeners.
    try {
      const next = loadStore(this.file);
      this._store = freezeStore(next);
      this._fireChange();
    } catch (e) {
      if (e instanceof NogginError) this._fireError(e);
      else throw e;
    }
    return result;
  }

  _runRead(fn, opts) {
    const result = fn(this.file, opts || {});
    // show with --goto mutates; refresh cache in that case.
    if (opts && opts.goto !== undefined) {
      try {
        this._store = freezeStore(loadStore(this.file));
        this._fireChange();
      } catch (e) {
        if (e instanceof NogginError) this._fireError(e);
      }
    }
    return result;
  }

  _fireChange() {
    for (const h of this._changeListeners) {
      try { h(); } catch { /* listener errors don't propagate */ }
    }
  }

  _fireError(err) {
    for (const h of this._errorListeners) {
      try { h(err); } catch { /* swallow */ }
    }
  }

  _startWatch() {
    const dir = path.dirname(this.file);
    if (!fs.existsSync(dir)) return; // can't watch a nonexistent dir; bail
    try {
      this._watcher = fs.watch(dir, { persistent: false }, (_event, name) => {
        if (!name) { this._scheduleReload(); return; }
        if (path.basename(this.file) === name) this._scheduleReload();
      });
    } catch { /* watching is best-effort */ }
  }

  _scheduleReload() {
    if (this._reloadTimer) clearTimeout(this._reloadTimer);
    this._reloadTimer = setTimeout(() => {
      this._reloadTimer = null;
      if (this._disposed) return;
      this.reload();
    }, 50);
  }
}

/** Convenience constructor: opens a watched Noggin. */
export function openNoggin(file) {
  return new Noggin(file, { watch: true });
}

// ── Snapshot helpers ─────────────────────────────────────────────────────────

function storesEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.active !== b.active) return false;
  if (a.items.length !== b.items.length) return false;
  for (let i = 0; i < a.items.length; i++) {
    if (!itemsEqual(a.items[i], b.items[i])) return false;
  }
  return true;
}

function itemsEqual(a, b) {
  if (a === b) return true;
  if (a.key !== b.key) return false;
  if (a.parentKey !== b.parentKey) return false;
  if (a.title !== b.title) return false;
  if (Boolean(a.done) !== Boolean(b.done)) return false;
  if (a.pushedAt !== b.pushedAt) return false;
  if (a.closedAt !== b.closedAt) return false;
  const an = a.notes || [];
  const bn = b.notes || [];
  if (an.length !== bn.length) return false;
  for (let i = 0; i < an.length; i++) {
    if (an[i].timestamp !== bn[i].timestamp) return false;
    if (an[i].text !== bn[i].text) return false;
  }
  return true;
}

function freezeStore(store) {
  // Deep-freeze prevents consumers from mutating cached state. Items and
  // their notes arrays are frozen; the top-level object is the snapshot.
  for (const item of store.items) {
    for (const note of item.notes || []) Object.freeze(note);
    Object.freeze(item.notes);
    Object.freeze(item);
  }
  Object.freeze(store.items);
  Object.freeze(store);
  return store;
}
