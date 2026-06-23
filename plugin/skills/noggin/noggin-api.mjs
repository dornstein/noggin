// AUTO-SYNCED FROM cli/noggin-api.mjs — DO NOT EDIT HERE.
// Edit the source and run: node scripts/sync-skill.mjs

// noggin-api — typed, in-process engine for the noggin working-memory tree.
//
// Three pillars:
//   1. `NogginDocument` and atomic ops (`AtomicOp`, `applyOps`) — the data
//      model and the only way to mutate it.
//   2. `verbs.*` — the user-facing verb behaviors (push, add, done, …)
//      implemented exactly once. Each verb reads state via a `Noggin`,
//      composes a list of `AtomicOp`s, and calls `noggin.apply(ops)`.
//   3. Factories + `openNoggin(location)` — backends register a scheme
//      prefix and an `open(location)` function. The engine never touches
//      a file or any other storage; backends do.
//
// Backends only implement the `Noggin` interface (a handful of read
// accessors + `apply(ops)` + lifecycle + events). Verb semantics are
// not per-backend; they live in `verbs.*` and call the backend through
// the small `apply` primitive.
//
// Every failure throws a `NogginError` with a stable `code` and a
// CLI-style `exitCode`. Nothing in here writes to process.stderr or
// calls process.exit.

/// <reference path="./noggin-api.d.mts" />

import crypto from 'node:crypto';

export const SCHEMA_VERSION = 1;

/**
 * Version stamped onto every response envelope this module produces
 * (via `formatSuccess` / `formatError`). Distinct from the on-disk
 * document `SCHEMA_VERSION`; bump when the envelope shape, the
 * `CurrentTreeView` shape, or any per-verb payload changes in a
 * breaking way.
 */
export const RESPONSE_ENVELOPE_VERSION = 3;

/** @deprecated Renamed to `RESPONSE_ENVELOPE_VERSION`. */
export const JSON_SCHEMA_VERSION = RESPONSE_ENVELOPE_VERSION;

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

function emptyDocument() {
  return { schemaVersion: SCHEMA_VERSION, active: null, items: [] };
}

/**
 * Normalize a single note object. Exported for the serializers, which
 * share this shape contract.
 */
export function normalizeNote(note) {
  if (note && typeof note === 'object' && note.text !== undefined) {
    return { timestamp: note.timestamp ? String(note.timestamp) : null, text: String(note.text) };
  }
  usage('invalid-note', 'internal: invalid note object');
}

/**
 * Normalize a parsed document in place: stamp schemaVersion, normalize
 * notes, strip legacy fields. Used by serializers and by `applyOps`.
 */
export function normalizeDocument(doc) {
  doc.schemaVersion = SCHEMA_VERSION;
  for (const f of doc.items) {
    if (!Array.isArray(f.notes)) usage('invalid-document', 'invalid contents: item notes must be an array');
    f.notes = f.notes.map(normalizeNote);
    // closedAt and pushedAt were both dropped before noggin shipped.
    // Strip them on load so a dev's pre-rename test file doesn't carry
    // dead fields forward into the new on-disk shape.
    if ('closedAt' in f) delete f.closedAt;
    if ('pushedAt' in f) delete f.pushedAt;
  }
  return doc;
}

/**
 * Validate a document's structural invariants. Throws `NogginError`
 * with code `'invalid-document'` if anything's wrong:
 *   - unique keys
 *   - parentKey references resolve
 *   - no cycles in the parent chain
 *   - active references an existing item (or is null)
 */
export function validateDocument(doc) {
  if (!doc || !Array.isArray(doc.items)) {
    usage('invalid-document', 'invalid contents: expected items array');
  }
  const keys = new Set();
  for (const f of doc.items) {
    if (!f.key) usage('invalid-document', 'internal: item missing key');
    if (keys.has(f.key)) usage('invalid-document', 'internal: duplicate item key detected');
    keys.add(f.key);
  }
  for (const f of doc.items) {
    if (f.parentKey != null && !keys.has(f.parentKey)) {
      usage('invalid-document', `internal: item '${f.key}' has unknown parent reference '${f.parentKey}'`);
    }
  }
  // Cycle check: walk parent chain from each item, bound by item count.
  const limit = doc.items.length + 1;
  for (const f of doc.items) {
    let n = f;
    let steps = 0;
    while (n.parentKey != null) {
      if (++steps > limit) {
        usage('invalid-document', `internal: parent chain cycle detected at '${f.key}'`);
      }
      n = doc.items.find((x) => x.key === n.parentKey);
      if (!n) break; // already caught above; defensive
    }
  }
  if (doc.active != null && !keys.has(doc.active)) {
    usage('invalid-document', `internal: active points to unknown item '${doc.active}'`);
  }
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
 * Wrap a successful verb result in the canonical response envelope.
 * Used by both the CLI `--json` flag and the VS Code extension's
 * language-model tools so the two surfaces emit byte-identical shapes.
 *
 * The envelope itself (status, envelopeVersion, verb, data) is always
 * fully present. `data` is run through `pruneDefaults` so whitelisted
 * fields equal to their declared default are omitted.
 *
 * @param {object} opts
 * @param {string} [opts.verb]  Verb name (e.g. 'push', 'show').
 * @param {any} [opts.data]     Verb-specific payload (e.g. CurrentTreeView).
 */
export function formatSuccess({ verb, data } = {}) {
  return {
    status: 'ok',
    envelopeVersion: RESPONSE_ENVELOPE_VERSION,
    verb: verb || null,
    data: data === undefined ? null : pruneDefaults(data),
  };
}

/**
 * Wrap an error in the canonical response envelope. Accepts a
 * `NogginError` (preserves its `code` and `exitCode`) or any other
 * thrown value.
 *
 * @param {object} opts
 * @param {string} [opts.verb]
 * @param {unknown} [opts.error]
 */
export function formatError({ verb, error } = {}) {
  const isNoggin = error instanceof NogginError;
  const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
  const code = isNoggin ? error.code : 'noggin-error';
  const exitCode = isNoggin ? error.exitCode : 1;
  return {
    status: 'error',
    envelopeVersion: RESPONSE_ENVELOPE_VERSION,
    verb: verb || null,
    error: { code, message, exitCode },
  };
}

// ── Internal verb helpers ────────────────────────────────────────────────────

function executeGotoOption(snapshot, base, goto, commandName) {
  if (goto === undefined) return base;
  if (!base) runtime('goto-base-missing', `${commandName}: --goto has no base item`);
  const gotoPath = goto === true ? '.' : goto;
  if (!gotoPath) runtime('goto-path-required', `${commandName}: --goto requires a path`);
  const scopedDoc = { ...snapshot, active: base.key };
  const resolved = tryResolveDetailed(scopedDoc, gotoPath);
  if (!resolved.ok) runtime('goto-unresolved', `${commandName}: --goto ${resolved.error}`);
  return resolved.item;
}

function makeItem({ title, parentKey }, ctx) {
  return {
    key: newKey(),
    parentKey: parentKey ?? null,
    title,
    done: false,
    createdAt: nowIso(ctx),
    notes: [],
  };
}

function resolvePlacement(snapshot, placement, commandName) {
  if (!placement) return null;
  const { kind, anchor } = placement;
  if (!kind || !anchor) {
    usage('placement-missing', `${commandName}: placement requires both kind and anchor`);
  }
  if (kind !== 'before' && kind !== 'after' && kind !== 'into') {
    usage('placement-invalid', `${commandName}: unknown placement kind '${kind}'`);
  }
  const anchorItem = resolvePath(snapshot, anchor);
  return { kind, anchor: anchorItem };
}

/** Compute (parentKey, position) for a placement spec against the current snapshot. */
function placementToTarget(snapshot, placement) {
  const { kind, anchor } = placement;
  if (kind === 'into') {
    return { parentKey: anchor.key, position: 'end' };
  }
  const siblings = _childrenOf(snapshot.items, anchor.parentKey ?? null);
  const idx = siblings.findIndex((s) => s.key === anchor.key);
  return {
    parentKey: anchor.parentKey ?? null,
    position: kind === 'before' ? idx : idx + 1,
  };
}

/** Snapshot the noggin's live state into a doc-shaped {items, active} object. */
function nogginSnapshot(noggin) {
  return {
    items: noggin.items,
    active: noggin.active ? noggin.active.key : null,
  };
}

// ── Atomic ops ───────────────────────────────────────────────────────────────

/**
 * Apply a list of `AtomicOp`s to a NogginDocument in-place, then
 * validate the result. Throws `NogginError` if any op references a
 * missing item or the resulting document violates invariants.
 *
 * Op vocabulary:
 *   { type: 'add',       item, parentKey, position }
 *   { type: 'remove',    keys }
 *   { type: 'set',       key, patch: { title?, done? } }
 *   { type: 'note',      key, note: { timestamp, text } }
 *   { type: 'move',      key, parentKey, position }
 *   { type: 'setActive', key }
 *
 * `position` is the 0-based index among siblings of `parentKey`, or
 * the string 'end' for append.
 *
 * This is the single mutation primitive every backend's `apply()`
 * delegates to. Verbs build the op list; backends execute it.
 */
export function applyOps(doc, ops) {
  if (!Array.isArray(ops)) usage('invalid-op', 'applyOps: ops must be an array');
  for (const op of ops) applyOp(doc, op);
  validateDocument(doc);
  return doc;
}

function applyOp(doc, op) {
  if (!op || typeof op !== 'object') usage('invalid-op', 'applyOps: op must be an object');
  switch (op.type) {
    case 'add':       return opAdd(doc, op);
    case 'remove':    return opRemove(doc, op);
    case 'set':       return opSet(doc, op);
    case 'note':      return opNote(doc, op);
    case 'move':      return opMove(doc, op);
    case 'setActive': return opSetActive(doc, op);
    default: usage('invalid-op', `applyOps: unknown op type '${op && op.type}'`);
  }
}

function insertAtPosition(items, item, parentKey, position) {
  const pkey = parentKey ?? null;
  if (position === 'end') {
    items.push(item);
    return;
  }
  if (typeof position !== 'number' || position < 0) {
    usage('invalid-op', `add/move: invalid position ${JSON.stringify(position)}`);
  }
  const siblings = items.filter((i) => (i.parentKey ?? null) === pkey);
  if (position >= siblings.length) {
    if (siblings.length === 0) { items.push(item); return; }
    const last = siblings[siblings.length - 1];
    items.splice(items.indexOf(last) + 1, 0, item);
    return;
  }
  const before = siblings[position];
  items.splice(items.indexOf(before), 0, item);
}

function opAdd(doc, op) {
  if (!op.item || !op.item.key) usage('invalid-op', 'add: op.item with key required');
  if (doc.items.some((i) => i.key === op.item.key)) {
    usage('invalid-op', `add: item with key '${op.item.key}' already exists`);
  }
  const item = {
    key: op.item.key,
    parentKey: op.parentKey ?? null,
    title: op.item.title,
    done: Boolean(op.item.done),
    createdAt: op.item.createdAt,
    notes: Array.isArray(op.item.notes) ? op.item.notes.map(normalizeNote) : [],
  };
  insertAtPosition(doc.items, item, op.parentKey, op.position);
}

function opRemove(doc, op) {
  if (!Array.isArray(op.keys)) usage('invalid-op', 'remove: op.keys array required');
  const removeSet = new Set(op.keys);
  doc.items = doc.items.filter((i) => !removeSet.has(i.key));
}

function opSet(doc, op) {
  if (!op.key) usage('invalid-op', 'set: op.key required');
  const item = doc.items.find((i) => i.key === op.key);
  if (!item) usage('invalid-op', `set: item with key '${op.key}' not found`);
  if (!op.patch || typeof op.patch !== 'object') usage('invalid-op', 'set: op.patch object required');
  if (op.patch.title !== undefined) item.title = op.patch.title;
  if (op.patch.done !== undefined) item.done = Boolean(op.patch.done);
}

function opNote(doc, op) {
  if (!op.key) usage('invalid-op', 'note: op.key required');
  const item = doc.items.find((i) => i.key === op.key);
  if (!item) usage('invalid-op', `note: item with key '${op.key}' not found`);
  if (!op.note || op.note.text === undefined) usage('invalid-op', 'note: op.note.text required');
  if (!Array.isArray(item.notes)) item.notes = [];
  item.notes.push(normalizeNote(op.note));
}

function opMove(doc, op) {
  if (!op.key) usage('invalid-op', 'move: op.key required');
  const item = doc.items.find((i) => i.key === op.key);
  if (!item) usage('invalid-op', `move: item with key '${op.key}' not found`);
  const idx = doc.items.indexOf(item);
  doc.items.splice(idx, 1);
  item.parentKey = op.parentKey ?? null;
  insertAtPosition(doc.items, item, op.parentKey, op.position);
}

function opSetActive(doc, op) {
  doc.active = op.key ?? null;
}

/**
 * Apply ops to a clone of the current state without persisting, so a
 * verb can resolve a `--goto` path against the projected post-apply
 * state before submitting the real apply.
 */
function projectOps(noggin, ops) {
  const doc = {
    schemaVersion: SCHEMA_VERSION,
    active: noggin.active ? noggin.active.key : null,
    items: noggin.items.map((i) => ({
      key: i.key,
      parentKey: i.parentKey ?? null,
      title: i.title,
      done: Boolean(i.done),
      createdAt: i.createdAt,
      notes: (i.notes || []).map((n) => ({ timestamp: n.timestamp, text: n.text })),
    })),
  };
  for (const op of ops) applyOp(doc, op);
  return doc;
}

// ── Verbs ────────────────────────────────────────────────────────────────────

/**
 * The single verb implementation, shared by every backend. Each verb
 * takes a `Noggin`, reads state via its accessors, composes the
 * appropriate `AtomicOp[]`, calls `noggin.apply(ops)` once, and returns
 * a `CurrentTreeView` (or a `DeleteResult` for delete).
 *
 * Verb behavior contracts — push moves active; add does not unless
 * --goto; done appends a close note and surfaces to parent; --force
 * vs --close-all close semantics; cycle protection on move; etc. —
 * live here. Backends do not implement verbs.
 */
export const verbs = {
  push: verbPush,
  add: verbAdd,
  move: verbMove,
  goto: verbGoto,
  done: verbDone,
  pop: verbPop,
  edit: verbEdit,
  show: verbShow,
  note: verbNote,
  delete: verbDelete,
};

/** push: create a child of active (or a root if none) and become active. */
async function verbPush(noggin, opts, ctx) {
  const title = (opts && opts.title || '').toString().trim();
  if (!title) usage('title-required', 'push: title required (--title or positional)');
  const active = noggin.active;
  const item = makeItem({ title, parentKey: active ? active.key : null }, ctx);
  const ops = [
    { type: 'add', item, parentKey: active ? active.key : null, position: 'end' },
    { type: 'setActive', key: item.key },
  ];
  await noggin.apply(ops);
  return buildView(nogginSnapshot(noggin), noggin.findByKey(item.key), {});
}

/** add: capture an item without making it active (unless --goto). */
async function verbAdd(noggin, opts = {}, ctx) {
  const title = (opts.title || '').toString().trim();
  if (!title) usage('title-required', 'add: title required (--title or positional)');
  const snap = nogginSnapshot(noggin);
  const active = noggin.active;
  const placement = resolvePlacement(snap, opts.placement, 'add');

  let parentKey, position;
  if (placement) {
    ({ parentKey, position } = placementToTarget(snap, placement));
  } else {
    parentKey = active ? active.key : null;
    position = 'end';
  }

  const item = makeItem({ title, parentKey }, ctx);
  const ops = [{ type: 'add', item, parentKey, position }];

  let viewTargetKey = item.key;
  if (opts.goto !== undefined) {
    const projected = projectOps(noggin, ops);
    const projectedNew = findByKey(projected.items, item.key);
    const target = executeGotoOption(projected, projectedNew, opts.goto, 'add');
    ops.push({ type: 'setActive', key: target.key });
    viewTargetKey = target.key;
  }

  await noggin.apply(ops);
  return buildView(nogginSnapshot(noggin), noggin.findByKey(viewTargetKey), {});
}

/** move: relocate an item. Required placement; cycle-checked. */
async function verbMove(noggin, opts = {}) {
  const snap = nogginSnapshot(noggin);
  const placement = resolvePlacement(snap, opts.placement, 'move');
  if (!placement) usage('placement-missing', 'move: choose exactly one of --before, --after, or --into');
  const { kind, anchor } = placement;

  let target;
  if (opts.path) target = noggin.resolvePath(opts.path);
  else {
    target = noggin.active;
    if (!target) runtime('no-active-item', 'move: no active item; pass a path');
  }

  // Cycle checks.
  if (kind === 'into') {
    if (target.key === anchor.key) {
      runtime('cycle', `move: cannot move ${noggin.pathOf(target)} into itself (would create a cycle)`);
    }
    if (isDescendant(noggin.items, anchor, target)) {
      runtime('cycle', `move: cannot move ${noggin.pathOf(target)} into its own subtree (would create a cycle)`);
    }
  } else {
    if (isDescendant(noggin.items, anchor, target)) {
      runtime('cycle', `move: cannot move ${noggin.pathOf(target)} next to its own descendant (would create a cycle)`);
    }
  }

  // Compute new parentKey + position. For before/after we exclude the
  // target itself from the sibling list so its current position doesn't
  // shift the anchor index.
  let parentKey, position;
  if (kind === 'into') {
    parentKey = anchor.key;
    position = 'end';
  } else if (anchor.key === target.key) {
    // before/after self → silent no-op. Submit a redundant move op
    // anyway so the verb still goes through the normal apply path
    // (keeps event semantics consistent).
    parentKey = target.parentKey ?? null;
    const siblings = _childrenOf(noggin.items, parentKey);
    position = siblings.findIndex((s) => s.key === target.key);
  } else {
    parentKey = anchor.parentKey ?? null;
    const siblings = _childrenOf(noggin.items, parentKey).filter((s) => s.key !== target.key);
    const anchorIdx = siblings.findIndex((s) => s.key === anchor.key);
    position = kind === 'before' ? anchorIdx : anchorIdx + 1;
  }

  const ops = [{ type: 'move', key: target.key, parentKey, position }];

  let viewTargetKey;
  if (opts.goto !== undefined) {
    const projected = projectOps(noggin, ops);
    const projectedTarget = findByKey(projected.items, target.key);
    const gotoTarget = executeGotoOption(projected, projectedTarget, opts.goto, 'move');
    ops.push({ type: 'setActive', key: gotoTarget.key });
    viewTargetKey = gotoTarget.key;
  } else {
    // Default view target: active (preserved by key) if still exists, else the moved target.
    viewTargetKey = noggin.active ? noggin.active.key : target.key;
  }

  await noggin.apply(ops);
  return buildView(nogginSnapshot(noggin), noggin.findByKey(viewTargetKey), {});
}

/** goto: make `path` active. */
async function verbGoto(noggin, opts = {}) {
  if (!opts.path) usage('path-required', 'goto: path required');
  const target = noggin.resolvePath(opts.path);
  const ops = [{ type: 'setActive', key: target.key }];
  await noggin.apply(ops);
  return buildView(nogginSnapshot(noggin), noggin.findByKey(target.key), {});
}

/** done: mark target done, then surface active to parent. Idempotent. */
async function verbDone(noggin, opts = {}, ctx) {
  if (opts.goto !== undefined) usage('goto-unsupported', 'done: --goto is not supported; done always moves to the target parent');

  let target;
  if (opts.path) target = noggin.resolvePath(opts.path);
  else {
    target = noggin.active;
    if (!target) runtime('no-active-item', 'done: no active item; pass a path');
  }

  const closeOps = buildCloseOps(noggin, target, opts, 'done', ctx);
  const parentKey = target.parentKey ?? null;
  const ops = [...closeOps, { type: 'setActive', key: parentKey }];

  await noggin.apply(ops);
  const newActive = noggin.active;
  const viewTarget = newActive || noggin.findByKey(target.key);
  return buildView(nogginSnapshot(noggin), viewTarget, {});
}

/** pop: done on active, no path argument. */
async function verbPop(noggin, opts = {}, ctx) {
  if (opts && opts.path !== undefined) usage('pop-no-path', 'pop: takes no path; pop always operates on the active item');
  if (opts && opts.goto !== undefined) usage('goto-unsupported', "pop: --goto is not supported; pop always moves to the active item's parent");
  if (!noggin.active) runtime('no-active-item', 'pop: no active item');
  return verbDone(noggin, {
    force: opts.force === true,
    closeAll: opts.closeAll === true,
  }, ctx);
}

/** edit: idempotent mutation of state and/or title. */
async function verbEdit(noggin, opts = {}, ctx) {
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
  if (opts.path) target = noggin.resolvePath(opts.path);
  else {
    target = noggin.active;
    if (!target) runtime('no-active-item', 'edit: no active item; pass a path');
  }

  const ops = [];

  if (hasState) {
    if (opts.done) {
      ops.push(...buildCloseOps(noggin, target, opts, 'edit', ctx));
    } else if (target.done) {
      ops.push({ type: 'set', key: target.key, patch: { done: false } });
    }
  }

  if (hasTitle) {
    const next = rawTitle.toString().trim();
    if (target.title !== next) {
      ops.push({ type: 'set', key: target.key, patch: { title: next } });
    }
  }

  let viewTargetKey = target.key;
  if (opts.goto !== undefined) {
    const projected = projectOps(noggin, ops);
    const projectedTarget = findByKey(projected.items, target.key);
    const gotoTarget = executeGotoOption(projected, projectedTarget, opts.goto, 'edit');
    ops.push({ type: 'setActive', key: gotoTarget.key });
    viewTargetKey = gotoTarget.key;
  }

  if (ops.length > 0) await noggin.apply(ops);
  return buildView(nogginSnapshot(noggin), noggin.findByKey(viewTargetKey), {});
}

/** show: read-only view; --goto activates after. */
async function verbShow(noggin, opts = {}) {
  const target = opts.path ? noggin.resolvePath(opts.path) : noggin.active;
  if (!target) return null;

  let viewTargetKey = target.key;
  if (opts.goto !== undefined) {
    const gotoTarget = executeGotoOption(nogginSnapshot(noggin), target, opts.goto, 'show');
    if (gotoTarget.key !== (noggin.active ? noggin.active.key : null)) {
      await noggin.apply([{ type: 'setActive', key: gotoTarget.key }]);
    }
    viewTargetKey = gotoTarget.key;
  }

  return buildView(nogginSnapshot(noggin), noggin.findByKey(viewTargetKey), {
    includeChildren: opts.includeChildren !== false,
    withSiblings: opts.withSiblings === true,
    withDescendants: opts.withDescendants === true,
  });
}

/** note: append a timestamped note. */
async function verbNote(noggin, opts = {}, ctx) {
  const text = (opts.text || '').toString().trim();
  if (!text) usage('text-required', 'note: text required');

  let target;
  if (opts.path) target = noggin.resolvePath(opts.path);
  else {
    target = noggin.active;
    if (!target) runtime('no-active-item', 'note: no active item and no path given');
  }

  const ops = [{
    type: 'note',
    key: target.key,
    note: { timestamp: nowIso(ctx), text },
  }];

  let viewTargetKey = target.key;
  if (opts.goto !== undefined) {
    const projected = projectOps(noggin, ops);
    const projectedTarget = findByKey(projected.items, target.key);
    const gotoTarget = executeGotoOption(projected, projectedTarget, opts.goto, 'note');
    ops.push({ type: 'setActive', key: gotoTarget.key });
    viewTargetKey = gotoTarget.key;
  }

  await noggin.apply(ops);
  return buildView(nogginSnapshot(noggin), noggin.findByKey(viewTargetKey), {});
}

/** delete: remove item; --recursive for subtree. */
async function verbDelete(noggin, opts = {}) {
  if (opts.goto !== undefined) usage('goto-unsupported', 'delete: --goto is not supported');
  if (!opts.path) usage('path-required', 'delete: path required');
  const target = noggin.resolvePath(opts.path);
  const targetKey = target.key;
  const targetPath = noggin.pathOf(target);
  const targetTitle = target.title;
  const descendants = collectDescendants(noggin.items, target);

  if (descendants.length > 0 && opts.recursive !== true) {
    runtime(
      'has-descendants',
      `delete: ${targetPath} has ${descendants.length} descendant(s); pass --recursive to delete the whole subtree`,
    );
  }

  const removeKeys = [target.key, ...descendants.map((d) => d.key)];
  const ops = [{ type: 'remove', keys: removeKeys }];

  const activeWasRemoved = noggin.active != null && removeKeys.includes(noggin.active.key);
  if (activeWasRemoved) {
    ops.push({ type: 'setActive', key: target.parentKey ?? null });
  }

  await noggin.apply(ops);

  const newActive = noggin.active;
  return {
    deleted: { key: targetKey, path: targetPath, title: targetTitle },
    descendantCount: descendants.length,
    view: newActive ? buildView(nogginSnapshot(noggin), newActive, {}) : null,
  };
}

/**
 * Build the op list for closing `target`, enforcing the open-descendant
 * rule unless `force` or `closeAll` opts it out. Shared by `done`,
 * `pop` (via done), and `edit --done`. Does NOT include the setActive
 * op — callers add that if their verb surfaces active.
 */
function buildCloseOps(noggin, target, opts, verb, ctx) {
  const force = opts.force === true;
  const closeAll = opts.closeAll === true;
  const ops = [];
  const ts = nowIso(ctx);

  if (closeAll) {
    for (const d of collectDescendants(noggin.items, target)) {
      if (!d.done) {
        ops.push({ type: 'set', key: d.key, patch: { done: true } });
        ops.push({ type: 'note', key: d.key, note: { timestamp: ts, text: CLOSE_NOTE_TEXT } });
      }
    }
  }
  if (!force && !closeAll) {
    const open = countOpenDescendants(noggin.items, target);
    if (open > 0) {
      runtime(
        'open-descendants',
        `${verb}: ${noggin.pathOf(target)} has ${open} open descendant(s); ` +
          `pass --closeall to close them too, or --force to close ${target.title} anyway`,
      );
    }
  }
  if (!target.done) {
    ops.push({ type: 'set', key: target.key, patch: { done: true } });
    ops.push({ type: 'note', key: target.key, note: { timestamp: ts, text: CLOSE_NOTE_TEXT } });
  }
  return ops;
}

// ── Factory registry ─────────────────────────────────────────────────────────

function createRegistry() {
  /** @type {Map<string, any>} */
  const byScheme = new Map();
  /** @type {string|null} */
  let defaultScheme = null;
  return {
    register(factory, opts = {}) {
      if (!factory || typeof factory.scheme !== 'string' || !factory.scheme) {
        throw new TypeError('factories.register: factory.scheme (non-empty string) required');
      }
      if (typeof factory.open !== 'function') {
        throw new TypeError('factories.register: factory.open function required');
      }
      byScheme.set(factory.scheme, factory);
      if (opts.default) defaultScheme = factory.scheme;
    },
    unregister(scheme) {
      const had = byScheme.delete(scheme);
      if (defaultScheme === scheme) defaultScheme = null;
      return had;
    },
    get(scheme) { return byScheme.get(scheme) || null; },
    getDefault() {
      return defaultScheme ? byScheme.get(defaultScheme) || null : null;
    },
    list() {
      return Array.from(byScheme.values()).map((f) => ({
        scheme: f.scheme,
        default: f.scheme === defaultScheme,
      }));
    },
  };
}

/**
 * The process-wide noggin factory registry. Backends call
 * `factories.register({scheme, open})` (typically on import side-effect).
 * `openNoggin(location)` consults this registry to pick a factory by
 * scheme prefix; bare locations go to whichever factory was registered
 * with `{default: true}`.
 */
export const factories = createRegistry();

function parseLocation(s) {
  const m = String(s == null ? '' : s).match(/^([a-z][a-z0-9+.-]*):\/\/(.*)$/i);
  return m ? { scheme: m[1].toLowerCase(), rest: m[2] } : { scheme: null, rest: String(s == null ? '' : s) };
}

/**
 * Open a noggin by location. The scheme prefix (e.g. `file://`,
 * `localstorage://`) selects the factory; a bare location goes to
 * the default factory.
 *
 * @param {string} location
 * @param {object} [opts]  Forwarded to the factory.
 * @returns {Promise<any>}
 */
export async function openNoggin(location, opts) {
  if (!location) {
    throw new NogginError('openNoggin: location required', { code: 'no-location', exitCode: 2 });
  }
  const { scheme, rest } = parseLocation(location);
  const factory = scheme ? factories.get(scheme) : factories.getDefault();
  if (!factory) {
    if (scheme) usage('no-factory', `no factory registered for scheme '${scheme}://'`);
    usage('no-factory', `no default factory registered; cannot open '${location}'`);
  }
  // Forward the original location so backends can preserve it for
  // round-trippable `where` output. Backends still receive `rest` (the
  // post-scheme portion) as the resolution input.
  return factory.open(rest, { ...opts, location });
}

// ── Snapshot helpers (used by backends) ──────────────────────────────────────

/** Structural equality between two NogginDocuments. */
export function documentsEqual(a, b) {
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

/**
 * Deep-freeze a noggin document. Backends call this on the in-memory
 * cache that's exposed via accessors so consumers can't accidentally
 * mutate it.
 */
export function freezeDocument(doc) {
  for (const item of doc.items) {
    for (const note of item.notes || []) Object.freeze(note);
    Object.freeze(item.notes);
    Object.freeze(item);
  }
  Object.freeze(doc.items);
  Object.freeze(doc);
  return doc;
}
