// AUTO-SYNCED FROM cli/noggin-api.mjs — DO NOT EDIT HERE.
// Edit the source and run: node scripts/sync-skill.mjs

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

/// <reference path="./noggin-api.d.mts" />

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { fromYaml, toYaml } from './serializers/yaml.mjs';

export const SCHEMA_VERSION = 1;

/**
 * Version tag stamped onto every JSON envelope this module produces (via
 * `formatSuccess` / `formatError`). Independent of the on-disk store
 * `SCHEMA_VERSION`; bump when the shape of `CurrentTreeView`, the envelope,
 * or any per-verb payload changes in a breaking way.
 */
export const JSON_SCHEMA_VERSION = 2;

/**
 * Text of the system-generated note appended whenever an item transitions
 * from open to done. The note's timestamp records when the close happened
 * — there is no separate closedAt field on the item.
 */
export const CLOSE_NOTE_TEXT = 'closed';

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

function nowIso(ctx) {
  return ((ctx && ctx.now) || new Date()).toISOString();
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

/**
 * Normalize a single note object. Exported for the serializers, which
 * share this shape contract; not part of the public API.
 */
export function normalizeNote(note) {
  if (note && typeof note === 'object' && note.text !== undefined) {
    return { timestamp: note.timestamp ? String(note.timestamp) : null, text: String(note.text) };
  }
  usage('invalid-note', 'internal: invalid note object');
}

function normalizeStore(store) {
  store.schemaVersion = SCHEMA_VERSION;
  for (const f of store.items) {
    if (!Array.isArray(f.notes)) usage('invalid-document', 'invalid contents: item notes must be an array');
    f.notes = f.notes.map(normalizeNote);
    // closedAt and pushedAt were both dropped before noggin shipped.
    // Strip them on load so a dev's pre-rename test file doesn't carry
    // dead fields forward into the new on-disk shape.
    if ('closedAt' in f) delete f.closedAt;
    if ('pushedAt' in f) delete f.pushedAt;
  }
  return store;
}

function validateStore(store) {
  const keys = new Set();
  for (const f of store.items) {
    if (!f.key) usage('invalid-document', 'internal: item missing key');
    if (keys.has(f.key)) usage('invalid-document', 'internal: duplicate item key detected');
    keys.add(f.key);
  }
  for (const f of store.items) {
    if (f.parentKey && !keys.has(f.parentKey)) {
      usage('invalid-document', 'internal: item has unknown parent reference');
    }
  }
  if (store.active && !keys.has(store.active)) {
    usage('invalid-document', 'internal: active points to unknown item');
  }
}

/**
 * Load and validate a YAML noggin document from disk. Returns an empty
 * document if the file does not exist or is empty. Errors surface as
 * `NogginError` with code `'invalid-document'` or `'unsupported-schema'`
 * (structural) or `'io'` (file read failure).
 */
export function loadStore(filePath) {
  if (!fs.existsSync(filePath)) return emptyStore();
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch (e) { usage('io', `failed to read ${filePath}: ${e.message}`); }
  try {
    return normalizeStore(fromYaml(raw));
  } catch (e) {
    if (e instanceof NogginError && (e.code === 'invalid-document' || e.code === 'unsupported-schema')) {
      // Re-throw with the file path attached for diagnostics.
      throw new NogginError(`${e.message} (in ${filePath})`, { code: e.code, exitCode: e.exitCode });
    }
    throw e;
  }
}

function dumpStore(store) {
  return toYaml(store);
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

function positionOf(items, item) {
  if (!item) return null;
  const siblings = _childrenOf(items, item.parentKey);
  const index = siblings.findIndex((s) => s.key === item.key);
  return index >= 0 ? index + 1 : null;
}

/**
 * Compute the canonical absolute path string for an item: `/1/2/3`.
 *
 * The leading `/` is the contract marker that distinguishes an
 * absolute path from a relative one. Every absolute path emitted by
 * the API — `activePath`, `ItemView.path`, `parentPath`, error message
 * fragments — has this leading slash. (CLI input still accepts the
 * legacy bare-position form `1/2/3` for ergonomics.)
 */
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
  return '/' + parts.join('/');
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
 * Resolve a path string against a store. Path grammar:
 *
 *   Absolute (always starts with `/`):
 *     '/1/2/3'
 *
 *   Relative (anything else; resolved against the active item):
 *     '.'             active item
 *     '..'            parent of active
 *     '-'  / '+'      previous / next sibling of active
 *     './X/Y'         descend from active
 *     '../X'          sibling of active (child X of parent)
 *     '-/X' / '+/X'   descend from previous / next sibling
 *     '../../X'       walk up two and then down
 *     'X' / 'X/Y'     bare positions are short for './X' / './X/Y'
 *
 * Returns `{ ok: true, item } | { ok: false, error }`.
 */
function tryResolveDetailed(store, p) {
  if (!p) return { ok: false, error: `path: empty path` };
  const s = String(p);
  const active = store.active ? findByKey(store.items, store.active) : null;

  // Absolute. The leading `/` is the unambiguous marker.
  if (s.startsWith('/')) {
    const rest = s.slice(1);
    if (rest === '') return { ok: false, error: `path '${s}': empty absolute path` };
    return walkPath(store.items, null, rest, s);
  }

  // Relative special tokens.
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

  // Everything else is relative to active: `./X`, `../X`, or bare `X/Y`
  // (which is implicit `./X/Y`). Walk up for any leading `../` segments,
  // then strip the optional `./` and descend.
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
    createdAt: f.createdAt,
    notes: Array.isArray(f.notes) ? f.notes.map(normalizeNote) : [],
  };
}

/**
 * Build the CurrentTreeView shape — the unified payload returned by every
 * mutating verb and by `show`. Pure; does not mutate the store.
 *
 * Options (all default to "normal show" behavior):
 *   includeChildren  expand target.children; default true
 *                    (set false for --no-children)
 *   withSiblings     include the full sibling row at every ancestor
 *                    depth (default: ancestors are trimmed to the
 *                    single item on the spine)
 *   withDescendants  expand the target's subtree recursively instead
 *                    of just first-level kids (default: kids are leaves)
 *
 * Without options, the recursion walks the direct ancestor chain from
 * root to target. Each ancestor's `children` is a single-element array
 * (sibling-of-ancestors trimmed). The target's parent's `children` is
 * the full peer row. The target itself has `children` populated with
 * its first-level kids. Peers and grandkids are leaves — no `children`
 * field.
 *
 * With `withSiblings`, each intermediate ancestor's `children` is the full
 * sibling row at that depth, not just the spine item. Sibling subtrees
 * of those ancestors stay collapsed (leaves) so the spine is still
 * visible.
 *
 * With `withDescendants`, the target's subtree is fully expanded recursively;
 * every descendant has a `children` field describing its own subtree.
 *
 * If the target is itself a root, `items` is the target's full peer row
 * (the actual roots of the store).
 */
export function buildView(store, target, opts = {}) {
  if (!target) return null;
  const includeChildren = opts.includeChildren !== false;
  const withSiblings = opts.withSiblings === true;
  const withDescendants = opts.withDescendants === true;
  const activeItem = store.active ? findByKey(store.items, store.active) : null;
  const lineage = [...ancestorsOf(store.items, target), target];

  // Render a single item as a leaf (no `children` field).
  const leaf = (item) => toPublicItem(store.items, item);

  // Render an item with its full subtree expanded recursively.
  function expanded(item) {
    return {
      ...toPublicItem(store.items, item),
      children: _childrenOf(store.items, item.key).map(expanded),
    };
  }

  // Target node. Carries `children` only when --no-children wasn't passed.
  // With withDescendants, expand the whole subtree; otherwise grandkids are
  // leaves (no `children` field).
  let targetNode;
  if (!includeChildren) {
    targetNode = leaf(target);
  } else if (withDescendants) {
    targetNode = expanded(target);
  } else {
    targetNode = {
      ...toPublicItem(store.items, target),
      children: _childrenOf(store.items, target.key).map(leaf),
    };
  }

  // Target's full peer row. Peers other than the target are leaves.
  let level = _childrenOf(store.items, target.parentKey || null).map((it) =>
    it.key === target.key ? targetNode : leaf(it),
  );

  // Wrap each ancestor (root → target's parent) with a `children` slot
  // that descends into the level we just built.
  //
  // The lowest ancestor (target's parent) always gets the full peer row
  // as its children — that's the peer row of the target itself, which
  // we never trim. Higher ancestors get either just the single descent
  // path (default) or the full sibling row at that depth with sibling
  // subtrees collapsed (withSiblings).
  for (let i = lineage.length - 2; i >= 0; i--) {
    const ancestor = lineage[i];
    const isTargetParent = i === lineage.length - 2;
    let ancestorChildren;
    if (isTargetParent || !withSiblings) {
      ancestorChildren = level;
    } else {
      // Higher ancestor + withSiblings: include all of this ancestor's
      // children. The spine child (`level[0]`) keeps its expanded
      // subtree; the rest are leaves with no `children` field, so
      // sibling subtrees stay collapsed.
      const nextSpineKey = level[0].key;
      ancestorChildren = _childrenOf(store.items, ancestor.key).map((it) =>
        it.key === nextSpineKey ? level[0] : leaf(it),
      );
    }
    level = [{
      ...toPublicItem(store.items, ancestor),
      children: ancestorChildren,
    }];
  }

  // If the target is itself a root and withSiblings is on, the items array
  // is already the target's full peer row (= the actual store roots).
  // No further wrapping needed.

  return {
    activePath: activeItem ? _pathOf(store.items, activeItem) : null,
    activeKey: activeItem ? activeItem.key : null,
    targetKey: target.key,
    items: level,
  };
}

// ── JSON envelope ────────────────────────────────────────────────────────────

/**
 * Whitelist of fields whose default value is stripped from JSON output
 * to keep payloads focused. The predicate decides whether a given value
 * counts as "default" for that field name. Anything not listed here is
 * always emitted, even if null/false/empty — explicit beats implicit.
 *
 * Notable omissions:
 *   - `children`: encoded by presence rather than value (absent means
 *     "leaf of view"; present means "view renders this node's child
 *     level", possibly with `[]`). Pruning doesn't apply.
 *   - `path` / `position`: absent only when the item was just deleted;
 *     the absence is the signal, so don't suppress it.
 *   - envelope fields (`status`, `schemaVersion`, `verb`, `file`,
 *     `data`, `error`): always present; not data.
 */
const PRUNABLE_DEFAULTS = {
  parentKey: (v) => v === null,
  done: (v) => v === false,
  notes: (v) => Array.isArray(v) && v.length === 0,
  activePath: (v) => v === null,
  activeKey: (v) => v === null,
  descendantCount: (v) => v === 0,
  exists: (v) => v === false,
  env: (v) => v === null,
  view: (v) => v === null,
};

/**
 * Recursively strip whitelisted default values from `data`. Arrays and
 * plain objects are walked; everything else is returned as-is.
 */
function pruneDefaults(value) {
  if (Array.isArray(value)) return value.map(pruneDefaults);
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const predicate = PRUNABLE_DEFAULTS[key];
    if (predicate && predicate(raw)) continue;
    out[key] = pruneDefaults(raw);
  }
  return out;
}

/**
 * Wrap a successful verb result in the canonical JSON envelope. Used by
 * both the CLI `--json` flag and the VS Code extension's language-model
 * tools so the two surfaces emit byte-identical shapes.
 *
 * The envelope itself (status, schemaVersion, verb, file, data) is
 * always fully present. `data` is run through `pruneDefaults` so
 * whitelisted fields equal to their declared default are omitted.
 *
 * @param {object} opts
 * @param {string} [opts.verb]  Verb name (e.g. 'push', 'show').
 * @param {string|null} [opts.file]  Resolved noggin file path, or null.
 * @param {any} [opts.data]  Verb-specific payload (e.g. CurrentTreeView).
 */
export function formatSuccess({ verb, file, data } = {}) {
  return {
    status: 'ok',
    schemaVersion: JSON_SCHEMA_VERSION,
    verb: verb || null,
    file: file || null,
    data: data === undefined ? null : pruneDefaults(data),
  };
}

/**
 * Wrap an error in the canonical JSON envelope. Accepts a `NogginError`
 * (preserves its `code` and `exitCode`) or any other thrown value.
 *
 * @param {object} opts
 * @param {string} [opts.verb]
 * @param {string|null} [opts.file]
 * @param {unknown} [opts.error]
 */
export function formatError({ verb, file, error } = {}) {
  const isNoggin = error instanceof NogginError;
  const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
  const code = isNoggin ? error.code : 'noggin-error';
  const exitCode = isNoggin ? error.exitCode : 1;
  return {
    status: 'error',
    schemaVersion: JSON_SCHEMA_VERSION,
    verb: verb || null,
    file: file || null,
    error: { code, message, exitCode },
  };
}

// ── Internal verb helpers ────────────────────────────────────────────────────

function executeGotoOption(store, base, goto, commandName) {
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

function makeItem({ title, parentKey }, ctx) {
  return {
    key: newKey(),
    parentKey,
    title,
    done: false,
    createdAt: nowIso(ctx),
    notes: [],
  };
}

/** Append the system-generated close note. */
function appendCloseNote(item, ctx) {
  if (!Array.isArray(item.notes)) item.notes = [];
  item.notes.push({ timestamp: nowIso(ctx), text: CLOSE_NOTE_TEXT });
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

// ── Pure verb functions ──────────────────────────────────────────────────────
//
// Each `applyX(doc, opts, ctx)` is a pure-ish function: it mutates the
// passed-in document and returns `{ doc, view }` (or `{ doc, result }`
// for delete). The document is mutated in place; callers that need to
// preserve the original should pass a copy.
//
// `ctx` is an optional context object. The only field currently
// supported is `now?: Date` — provide a fixed clock for deterministic
// timestamps in tests. Without `ctx`, `new Date()` is used.
//
// The thin `apiX(file, opts)` wrappers below load → applyX → save →
// return view, preserving the file-backed interface used by the CLI.

/** push: create a child of active (or a root if none) and become active. */
export function applyPush(doc, opts, ctx) {
  const title = (opts && opts.title || '').toString().trim();
  if (!title) usage('title-required', 'push: title required (--title or positional)');
  const activeItem = findByKey(doc.items, doc.active);
  const item = makeItem({ title, parentKey: activeItem ? activeItem.key : null }, ctx);
  doc.items.push(item);
  doc.active = item.key;
  return { doc, view: buildView(doc, item) };
}

/**
 * add: create an item. With no placement, becomes a child of active (or root).
 * Placement flags (`{ kind: 'before'|'after'|'into', anchor: path }`) override.
 * Active is unchanged unless `goto` is supplied.
 */
export function applyAdd(doc, opts = {}, ctx) {
  const title = (opts.title || '').toString().trim();
  if (!title) usage('title-required', 'add: title required (--title or positional)');
  const activeItem = findByKey(doc.items, doc.active);
  const placement = resolvePlacement(doc, opts.placement, 'add');

  let parentKey;
  let insertIndex;
  if (placement) {
    const { kind, anchor } = placement;
    if (kind === 'into') {
      parentKey = anchor.key;
      insertIndex = doc.items.length;
    } else {
      parentKey = anchor.parentKey;
      const anchorIdx = doc.items.indexOf(anchor);
      insertIndex = kind === 'before' ? anchorIdx : anchorIdx + 1;
    }
  } else {
    parentKey = activeItem ? activeItem.key : null;
    insertIndex = doc.items.length;
  }

  const item = makeItem({ title, parentKey }, ctx);
  doc.items.splice(insertIndex, 0, item);
  const outputTarget = opts.goto !== undefined ? executeGotoOption(doc, item, opts.goto, 'add') : item;
  return { doc, view: buildView(doc, outputTarget) };
}

/**
 * move: relocate an item. Default target = active. Placement is required.
 * Active pointer is preserved by key; cycles are rejected.
 */
export function applyMove(doc, opts = {}) {
  const placement = resolvePlacement(doc, opts.placement, 'move');
  if (!placement) usage('placement-missing', 'move: choose exactly one of --before, --after, or --into');
  const { kind, anchor } = placement;

  let target;
  if (opts.path) target = resolvePath(doc, opts.path);
  else {
    target = findByKey(doc.items, doc.active);
    if (!target) runtime('no-active-item', 'move: no active item; pass a path');
  }

  if (kind === 'into') {
    if (target.key === anchor.key) {
      runtime('cycle', `move: cannot move ${_pathOf(doc.items, target)} into itself (would create a cycle)`);
    }
    if (isDescendant(doc.items, anchor, target)) {
      runtime('cycle', `move: cannot move ${_pathOf(doc.items, target)} into its own subtree (would create a cycle)`);
    }
  } else {
    if (isDescendant(doc.items, anchor, target)) {
      runtime('cycle', `move: cannot move ${_pathOf(doc.items, target)} next to its own descendant (would create a cycle)`);
    }
    if (anchor.key === target.key) {
      // before/after self: same place. Silent no-op.
      const activeItem = findByKey(doc.items, doc.active);
      const outputTarget = opts.goto !== undefined ? executeGotoOption(doc, target, opts.goto, 'move') : (activeItem || target);
      return { doc, view: buildView(doc, outputTarget) };
    }
  }

  const newParentKey = kind === 'into' ? anchor.key : anchor.parentKey;
  const targetIdx = doc.items.indexOf(target);
  doc.items.splice(targetIdx, 1);

  let insertIndex;
  if (kind === 'into') {
    insertIndex = doc.items.length;
  } else {
    const anchorIdx = doc.items.indexOf(anchor);
    insertIndex = kind === 'before' ? anchorIdx : anchorIdx + 1;
  }

  target.parentKey = newParentKey;
  doc.items.splice(insertIndex, 0, target);

  const activeItem = findByKey(doc.items, doc.active);
  const outputTarget = opts.goto !== undefined ? executeGotoOption(doc, target, opts.goto, 'move') : (activeItem || target);
  return { doc, view: buildView(doc, outputTarget) };
}

/** goto: make the item at `path` active. */
export function applyGoto(doc, opts = {}) {
  if (!opts.path) usage('path-required', 'goto: path required');
  const target = resolvePath(doc, opts.path);
  doc.active = target.key;
  return { doc, view: buildView(doc, target) };
}

/**
 * Close `target` (and optionally its open descendants), enforcing the
 * open-descendant rule unless `force` or `closeAll` opts it out. Shared
 * by `applyDone`/`applyPop`/`applyEdit`. Mutates `store` in place; idempotent
 * when `target` is already done.
 *
 *   force      skip the open-descendant check; close just the target
 *              even though some kids remain open
 *   closeAll   walk descendants first; close every open one (each
 *              gets its own system "closed" note)
 *
 * Throws a runtime NogginError with code `open-descendants` if there
 * are open descendants and neither flag is set.
 */
function closeWithRules(store, target, opts, verb, ctx) {
  const force = opts.force === true;
  const closeAll = opts.closeAll === true;
  if (closeAll) {
    for (const d of collectDescendants(store.items, target)) {
      if (!d.done) {
        d.done = true;
        appendCloseNote(d, ctx);
      }
    }
  }
  if (!force && !closeAll) {
    const open = countOpenDescendants(store.items, target);
    if (open > 0) {
      runtime(
        'open-descendants',
        `${verb}: ${_pathOf(store.items, target)} has ${open} open descendant(s); ` +
          `pass --closeall to close them too, or --force to close ${target.title} anyway`,
      );
    }
  }
  if (!target.done) {
    target.done = true;
    appendCloseNote(target, ctx);
  }
}

/**
 * done: mark an item done, then move active to the target's parent.
 *
 * Idempotent — if the target is already done, no error and no extra
 * close note; the navigational side-effect (surface to parent) still
 * happens.
 *
 * `--force` skips the open-descendant safety check; `--closeall` first
 * closes every open descendant. Without either flag, an open
 * descendant blocks the call with a runtime error.
 */
export function applyDone(doc, opts = {}, ctx) {
  if (opts.goto !== undefined) usage('goto-unsupported', 'done: --goto is not supported; done always moves to the target parent');
  let target;
  if (opts.path) target = resolvePath(doc, opts.path);
  else {
    target = findByKey(doc.items, doc.active);
    if (!target) runtime('no-active-item', 'done: no active item; pass a path');
  }
  closeWithRules(doc, target, opts, 'done', ctx);
  const parent = target.parentKey ? findByKey(doc.items, target.parentKey) : null;
  doc.active = parent ? parent.key : null;
  return { doc, view: buildView(doc, parent || target) };
}

/** pop: shorthand for done() on the active item. Honors --force / --closeall. */
export function applyPop(doc, opts = {}, ctx) {
  if (opts && opts.path !== undefined) usage('pop-no-path', 'pop: takes no path; pop always operates on the active item');
  if (opts && opts.goto !== undefined) usage('goto-unsupported', 'pop: --goto is not supported; pop always moves to the active item\'s parent');
  if (!findByKey(doc.items, doc.active)) runtime('no-active-item', 'pop: no active item');
  return applyDone(doc, {
    force: opts.force === true,
    closeAll: opts.closeAll === true,
  }, ctx);
}

/**
 * edit: explicitly mutate one item's lifecycle state and/or title. Combines
 * the old `set-state` and `retitle` verbs. At least one of `done`/`title`
 * is required. Each operation is idempotent (no error if the value already
 * matches).
 *
 *   done       true  → close (subject to open-descendant rules below)
 *              false → reopen
 *              undefined → don't touch state
 *   title      new title (trimmed; empty string is ignored, not an error)
 *   force      when closing, skip the open-descendant check
 *   closeAll   when closing, first close every open descendant
 *   goto       standard reposition-after-write option
 *
 * Unlike `done`, `edit --done` does NOT surface active to the parent;
 * active is unchanged unless `--goto` is passed.
 */
export function applyEdit(doc, opts = {}, ctx) {
  const hasState = typeof opts.done === 'boolean';
  const rawTitle = opts.title;
  const hasTitle = typeof rawTitle === 'string' && rawTitle.trim() !== '';
  if (!hasState && !hasTitle) {
    usage('nothing-to-edit', 'edit: nothing to edit; pass at least one of --done, --open, --title');
  }
  const closing = hasState && opts.done === true;
  if (!closing && opts.force === true) {
    usage('option-misused', 'edit: --force only applies when closing (with --done)');
  }
  if (!closing && opts.closeAll === true) {
    usage('option-misused', 'edit: --close-all only applies when closing (with --done)');
  }

  let target;
  if (opts.path) target = resolvePath(doc, opts.path);
  else {
    target = findByKey(doc.items, doc.active);
    if (!target) runtime('no-active-item', 'edit: no active item; pass a path');
  }

  if (hasState) {
    if (opts.done) {
      closeWithRules(doc, target, opts, 'edit', ctx);
    } else if (target.done) {
      target.done = false;
    }
  }

  if (hasTitle) {
    const next = rawTitle.toString().trim();
    if (target.title !== next) target.title = next;
  }

  const outputTarget = opts.goto !== undefined ? executeGotoOption(doc, target, opts.goto, 'edit') : target;
  return { doc, view: buildView(doc, outputTarget) };
}

/**
 * show: detail for one item plus first-level children. Default target = active.
 * Returns null if no target can be resolved (no active item, no path given).
 *
 * Read-only unless `goto` is supplied, in which case active moves to the
 * goto path before the view is built.
 */
export function applyShow(doc, opts = {}) {
  const target = opts.path
    ? resolvePath(doc, opts.path)
    : findByKey(doc.items, doc.active);
  if (!target) return { doc, view: null };
  const outputTarget = opts.goto !== undefined ? executeGotoOption(doc, target, opts.goto, 'show') : target;
  const view = buildView(doc, outputTarget, {
    includeChildren: opts.includeChildren !== false,
    withSiblings: opts.withSiblings === true,
    withDescendants: opts.withDescendants === true,
  });
  return { doc, view };
}

/** note: append a timestamped note. Path defaults to active. */
export function applyNote(doc, opts = {}, ctx) {
  const text = (opts.text || '').toString().trim();
  if (!text) usage('text-required', 'note: text required');
  let target;
  if (opts.path) target = resolvePath(doc, opts.path);
  else {
    target = findByKey(doc.items, doc.active);
    if (!target) runtime('no-active-item', 'note: no active item and no path given');
  }
  if (!Array.isArray(target.notes)) target.notes = [];
  target.notes.push({ timestamp: nowIso(ctx), text });
  const outputTarget = opts.goto !== undefined ? executeGotoOption(doc, target, opts.goto, 'note') : target;
  return { doc, view: buildView(doc, outputTarget) };
}

/**
 * delete: remove an item. Refuses if it has descendants unless `recursive`.
 * If the deleted subtree contains the active item, active becomes the
 * deleted item's parent (or null if it was a root).
 */
export function applyDelete(doc, opts = {}) {
  if (opts.goto !== undefined) usage('goto-unsupported', 'delete: --goto is not supported');
  if (!opts.path) usage('path-required', 'delete: path required');
  const target = resolvePath(doc, opts.path);
  const targetPath = _pathOf(doc.items, target);
  const targetKey = target.key;
  const targetTitle = target.title;
  const descendants = collectDescendants(doc.items, target);
  if (descendants.length > 0 && opts.recursive !== true) {
    runtime(
      'has-descendants',
      `delete: ${targetPath} has ${descendants.length} descendant(s); ` +
        `pass --recursive to delete the whole subtree`,
    );
  }
  const removeKeys = new Set([target.key, ...descendants.map((d) => d.key)]);
  const activeWasRemoved = doc.active != null && removeKeys.has(doc.active);
  doc.items = doc.items.filter((i) => !removeKeys.has(i.key));
  if (activeWasRemoved) {
    doc.active = target.parentKey || null;
  }
  const newActive = findByKey(doc.items, doc.active);
  return {
    doc,
    result: {
      deleted: { key: targetKey, path: targetPath, title: targetTitle },
      descendantCount: descendants.length,
      view: newActive ? buildView(doc, newActive) : null,
    },
  };
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
/**
 * Long-lived handle over a single noggin file. Caches the parsed
 * document in memory, watches the file for external edits, and fires
 * onDidChange when the document changes (via a verb method or an
 * external edit).
 *
 * Read accessors are cheap and synchronous. Verbs are asynchronous:
 * each load → apply → save cycle runs to completion before the next
 * verb starts (per-noggin in-process serialization). Cross-process
 * locking is not yet implemented; concurrent processes mutating the
 * same file can lose updates.
 *
 * Internal: prefer the `fileNoggin()` factory from
 * `./backends/file.mjs` over `new Noggin(...)` directly.
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
    /** Promise chain that serializes verb calls on this noggin. */
    this._tail = Promise.resolve();
    this._watchOnInit = opts.watch === true;

    // Bind so they look like vscode.Event<T>: function-shaped subscribe.
    this.onDidChange = (handler) => {
      this._changeListeners.add(handler);
      return { dispose: () => this._changeListeners.delete(handler) };
    };
    this.onDidError = (handler) => {
      this._errorListeners.add(handler);
      return { dispose: () => this._errorListeners.delete(handler) };
    };
  }

  /**
   * Perform the initial load. Called by `fileNoggin()` factory before
   * handing the noggin back to callers. Sync I/O under the hood today;
   * async to keep the contract forward-compatible.
   */
  async _init() {
    try { this._store = freezeStore(loadStore(this.file)); }
    catch (e) {
      if (e instanceof NogginError) this._fireError(e);
      else throw e;
    }
    if (this._watchOnInit) this._startWatch();
    return this;
  }

  // ── Read accessors (synchronous) ────────────────────────────────────
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

  /** Reload from disk. Returns true if the cached document actually changed. */
  async reload() {
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

  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._reloadTimer) { clearTimeout(this._reloadTimer); this._reloadTimer = null; }
    if (this._watcher) { try { this._watcher.close(); } catch { /* ignore */ } this._watcher = null; }
    this._changeListeners.clear();
    this._errorListeners.clear();
    // Wait for any in-flight verb to finish before declaring dispose done.
    try { await this._tail; } catch { /* swallow */ }
  }

  // ── Verbs (async; serialized via _tail) ─────────────────────────────
  push(opts)        { return this._mutate(applyPush, opts); }
  add(opts)         { return this._mutate(applyAdd, opts); }
  move(opts)        { return this._mutate(applyMove, opts); }
  goto(p)           { return this._mutate(applyGoto, { path: p }); }
  done(opts)        { return this._mutate(applyDone, opts); }
  pop(opts)         { return this._mutate(applyPop, opts || {}); }
  edit(opts)        { return this._mutate(applyEdit, opts); }
  show(opts)        { return this._maybeMutate(applyShow, opts); }
  note(opts)        { return this._mutate(applyNote, opts); }
  delete(opts) {
    return this._enqueue(() => {
      const doc = loadStore(this.file);
      const { result } = applyDelete(doc, opts || {});
      saveStore(this.file, doc);
      this._store = freezeStore(doc);
      this._fireChange();
      return result;
    });
  }

  /**
   * Backend introspection. Returns a single human-readable string
   * describing where this noggin lives and any relevant backend state.
   * Format is backend-defined and *not* machine-parseable.
   */
  describe() {
    const exists = fs.existsSync(this.file);
    return `file: ${this.file}\n  exists: ${exists}`;
  }

  // ── Internals ───────────────────────────────────────────────────────

  /**
   * Enqueue `task` after any currently-pending verb on this noggin.
   * Returns a Promise that resolves with the task's return value or
   * rejects if the task throws. Tasks run sequentially.
   */
  _enqueue(task) {
    const prev = this._tail;
    const next = prev.then(() => task());
    // Update _tail synchronously so the next caller chains after THIS
    // task, not after the same prev. Swallow errors on the tail so one
    // failed verb doesn't poison subsequent verbs.
    this._tail = next.catch(() => {});
    return next;
  }

  /** Load → apply → save. Returns the verb's view. */
  _mutate(applyFn, opts) {
    return this._enqueue(() => {
      const doc = loadStore(this.file);
      const { view } = applyFn(doc, opts || {});
      saveStore(this.file, doc);
      this._store = freezeStore(doc);
      this._fireChange();
      return view;
    });
  }

  /**
   * Load → apply → maybe-save. `applyShow` mutates only when `--goto`
   * is passed; we skip the write otherwise to keep reads cheap.
   */
  _maybeMutate(applyFn, opts) {
    return this._enqueue(() => {
      const doc = loadStore(this.file);
      const { view } = applyFn(doc, opts || {});
      if (opts && opts.goto !== undefined) {
        saveStore(this.file, doc);
        this._store = freezeStore(doc);
        this._fireChange();
      }
      return view;
    });
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
      void this.reload();
    }, 50);
  }
}

/** Convenience constructor: opens a watched Noggin. Async because of the
 *  initial load. Prefer `fileNoggin()` from `./backends/file.mjs`. */
export async function openNoggin(file) {
  const n = new Noggin(file, { watch: true });
  await n._init();
  return n;
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
  if (a.createdAt !== b.createdAt) return false;
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