#!/usr/bin/env node
// Noggin skill — working-memory tree CLI.
//
// Items form a tree. The spine is the path from a root to the currently
// active item. Children of an item can be lightweight todos (added but not
// entered) or substantive sub-work (pushed and worked on). Same primitive
// either way — they only differ in whether they ever became active.
//
// An item carries identity, a done flag, a title, and append-only notes.
// That's it. There is no fixed schema for "what info matters" — if it
// matters, write it as a note.
//
// Identifiers:
//   - key       opaque, immortal (e.g. i-20260616-180053-b669ca)
//   - position  computed, 1-based among siblings
//   - path      slash-joined positions from root (e.g. "1/2/3")
//
// All references in args use paths. All references on disk use opaque keys.
//
// Storage: a single YAML file. The path is resolved in this order:
//   1. --file <path>
//   2. $NOGGIN_FILE env var
//   3. ~/.noggin.yaml (the default).
// The VS Code extension sets NOGGIN_FILE in its terminals so that any CLI
// invocation in a chat session or terminal targets the noggin the user has
// open in the editor. Outside VS Code, the env var is absent and the CLI
// falls back to the home-dir default.
// Paths are slash-joined absolute positions (e.g. "1/2/3"), or relative to
// the active item: '.' (active), '..' (parent), '-' / '+' (previous/next
// sibling), './X' (child), '../X' (sibling), '-/X/Y' (previous sibling's
// descendant), '../../X/Y' (uncle/aunt's descendant), and so on.
//
// Dependencies: js-yaml. Stdlib only otherwise. No shells, no network, no env.

import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const SCHEMA_VERSION = 1;
const DEFAULT_FILE = path.join(os.homedir(), '.noggin.yaml');

// ── Helpers ──────────────────────────────────────────────────────────────────

function fail(msg, code = 2) {
  process.stderr.write(`noggin: ${msg}\n`);
  process.exit(code);
}

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

function loadStore(filePath) {
  if (!fs.existsSync(filePath)) return emptyStore();
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch (e) { fail(`failed to read ${filePath}: ${e.message}`); }
  if (!raw.trim()) return emptyStore();
  let data;
  try { data = yaml.load(raw); }
  catch (e) { fail(`failed to parse ${filePath}: ${e.message}`); }
  if (!data || typeof data !== 'object') {
    fail(`invalid contents in ${filePath}: expected a mapping`);
  }
  if (data.schemaVersion !== SCHEMA_VERSION) {
    fail(
      `schemaVersion ${data.schemaVersion} in ${filePath} not supported by this CLI ` +
        `(expected ${SCHEMA_VERSION}).`,
    );
  }
  if (!Array.isArray(data.items)) fail(`invalid contents in ${filePath}: expected items array`);
  if (data.active === undefined) fail(`invalid contents in ${filePath}: expected active field`);
  return normalizeStore(data);
}

function dumpStore(store) {
  return yaml.dump(store, { noRefs: true, lineWidth: 100, sortKeys: false });
}

function normalizeNote(note) {
  if (note && typeof note === 'object' && note.text !== undefined) {
    return { timestamp: note.timestamp ? String(note.timestamp) : null, text: String(note.text) };
  }
  fail('internal: invalid note object');
}

function normalizeStore(store) {
  store.schemaVersion = SCHEMA_VERSION;
  for (const f of store.items) {
    if (!Array.isArray(f.notes)) fail('invalid contents: item notes must be an array');
    f.notes = f.notes.map(normalizeNote);
  }
  return store;
}

function writeAtomic(filePath, contents) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, filePath);
}

function saveStore(filePath, store) {
  normalizeStore(store);
  validateStore(store);
  writeAtomic(filePath, dumpStore(store));
}

// ── Tree helpers ─────────────────────────────────────────────────────────────

function findByKey(items, key) {
  if (!key) return null;
  return items.find((f) => f.key === key) || null;
}

function childrenOf(items, parentKey) {
  return items.filter((f) => f.parentKey === parentKey);
}

function siblingsOf(items, item) {
  if (!item) return [];
  return childrenOf(items, item.parentKey).filter((f) => f.key !== item.key);
}

function positionOf(items, item) {
  if (!item) return null;
  const siblings = childrenOf(items, item.parentKey);
  const index = siblings.findIndex((s) => s.key === item.key);
  return index >= 0 ? index + 1 : null;
}

function pathOf(items, item) {
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

function resolvePath(store, p) {
  const r = tryResolveDetailed(store, p);
  if (r.ok) return r.item;
  fail(r.error, 1);
}

function tryResolve(store, p) {
  const r = tryResolveDetailed(store, p);
  return r.ok ? r.item : null;
}

// Path syntax:
//   '.'         -> active item
//   '..'        -> parent of active item
//   '-' / '+'   -> previous / next sibling of active item
//   './X/Y'     -> child Y of child X of active item
//   '../X'      -> sibling of active item (child X of parent)
//   '-/X/Y'     -> child Y of child X under previous sibling
//   '../../X'   -> walk up twice, then down to X
//   'X/Y/Z'     -> absolute (from a root)
function tryResolveDetailed(store, p) {
  if (!p) return { ok: false, error: `path: empty path` };
  const s = String(p);
  const active = store.active ? findByKey(store.items, store.active) : null;

  // Pure relative tokens.
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

  // Relative path from adjacent sibling: '-/X/Y' or '+/X/Y'.
  if (s.startsWith('-/') || s.startsWith('+/')) {
    if (!active) return { ok: false, error: `path '${s}' is relative but no active item` };
    const direction = s[0] === '-' ? -1 : 1;
    const sibling = siblingRelative(store.items, active, direction, s);
    if (!sibling.ok) return sibling;
    const rest = s.slice(2);
    if (rest === '') return { ok: false, error: `path '${s}': trailing slash with no descendant` };
    return walkPath(store.items, sibling.item, rest, s);
  }

  // Relative path with prefix.
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

  // Absolute path from a root.
  return walkPath(store.items, null, s, s);
}

function siblingRelative(items, item, delta, originalForError) {
  const peers = childrenOf(items, item.parentKey || null);
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
    const match = childrenOf(items, parentKey)[position - 1];
    if (!match) {
      const where = current ? `under '${pathOf(items, current)}'` : 'at root';
      return { ok: false, error: `path not found: ${originalForError} (no position ${position} ${where})` };
    }
    current = match;
  }
  return { ok: true, item: current };
}

function countOpenDescendants(items, root) {
  let n = 0;
  const stack = childrenOf(items, root.key);
  while (stack.length) {
    const f = stack.pop();
    if (!f.done) n++;
    for (const c of childrenOf(items, f.key)) stack.push(c);
  }
  return n;
}

function validateStore(store) {
  const keys = new Set();
  for (const f of store.items) {
    if (!f.key) fail('internal: item missing key');
    if (keys.has(f.key)) fail('internal: duplicate item key detected');
    keys.add(f.key);
  }
  for (const f of store.items) {
    if (f.parentKey && !keys.has(f.parentKey)) {
      fail('internal: item has unknown parent reference');
    }
  }
  if (store.active && !keys.has(store.active)) {
    fail('internal: active points to unknown item');
  }
}

// ── Argument parsing ─────────────────────────────────────────────────────────

const VALUE_FLAGS = new Set(['file', 'title', 'before', 'after', 'into']);
const OPTIONAL_VALUE_FLAGS = new Set(['goto']);
const BOOL_FLAGS = new Set(['json', 'debug', 'help', 'nokids', 'notes', 'done', 'undone', 'recursive']);

function looksLikePath(value) {
  const text = String(value ?? '');
  if (text === '.' || text === '..' || text === '-' || text === '+') return true;
  if (text.startsWith('./') || text.startsWith('../')) return true;
  if (text.startsWith('-/') || text.startsWith('+/')) return true;
  if (/^\d+(?:\/\d+)*$/.test(text)) return true;
  return false;
}

function parseFlagToken(token) {
  const eq = token.indexOf('=');
  if (eq < 0) return { key: token.slice(2), value: undefined, hasInlineValue: false };
  return { key: token.slice(2, eq), value: token.slice(eq + 1), hasInlineValue: true };
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { flags.help = true; continue; }
    if (a.startsWith('--')) {
      const { key, value, hasInlineValue } = parseFlagToken(a);
      if (BOOL_FLAGS.has(key)) { flags[key] = true; continue; }
      if (OPTIONAL_VALUE_FLAGS.has(key)) {
        if (hasInlineValue) {
          flags[key] = value || true;
        } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') && looksLikePath(argv[i + 1])) {
          flags[key] = argv[i + 1];
          i++;
        } else {
          flags[key] = true;
        }
        continue;
      }
      if (VALUE_FLAGS.has(key)) {
        const val = hasInlineValue ? value : argv[i + 1];
        if (val === undefined || val.startsWith('--')) {
          fail(`flag --${key} requires a value`);
        }
        flags[key] = val;
        if (!hasInlineValue) i++;
        continue;
      }
      fail(`unknown flag: --${key}`);
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function splitCommand(argv) {
  const leading = [];
  let i = 0;
  while (i < argv.length && (argv[i].startsWith('--') || argv[i] === '-h')) {
    const a = argv[i];
    leading.push(a);
    const parsedFlag = a.startsWith('--') ? parseFlagToken(a) : null;
    const key = a === '--help' || a === '-h' ? 'help' : parsedFlag ? parsedFlag.key : null;
    if (key && VALUE_FLAGS.has(key)) {
      if (parsedFlag?.hasInlineValue) {
        i++;
      } else if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) {
        fail(`flag --${key} requires a value`);
      } else {
        leading.push(argv[i + 1]);
        i += 2;
      }
    } else if (key && OPTIONAL_VALUE_FLAGS.has(key) && !parsedFlag?.hasInlineValue &&
      argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') && looksLikePath(argv[i + 1])) {
      leading.push(argv[i + 1]);
      i += 2;
    } else {
      i++;
    }
  }
  return {
    verb: argv[i],
    args: [...leading, ...argv.slice(i + 1)],
  };
}

// ── Output ───────────────────────────────────────────────────────────────────

function formatItemLine(items, f, activeKey, indent) {
  const position = positionOf(items, f);
  const indicators = [];
  if (f.key === activeKey) indicators.push('📍');
  if (f.done) indicators.push('✅');
  if (Array.isArray(f.notes) && f.notes.length) indicators.push('✏️');
  return `${indent}[${position}${indicators.join('')}] ${f.title}`;
}

function printItem(items, f, opts = {}) {
  if (!f) { process.stdout.write('(no item)\n'); return; }
  const lineage = opts.includeAncestors ? [...ancestorsOf(items, f), f] : [f];
  const lines = [];

  function appendItemDetails(item, depth) {
    const detailIndent = '  '.repeat(depth);
    if (item.closedAt) lines.push(`${detailIndent}  closed:  ${item.closedAt}`);
    if (opts.includeChildren) {
      const kids = childrenOf(items, item.key);
      const childIndent = '  '.repeat(depth + 1);
      for (const k of kids) {
        lines.push(formatItemLine(items, k, opts.activeKey, childIndent));
      }
    }
    if (opts.includeNotes) {
      const notes = Array.isArray(item.notes) ? item.notes.map(normalizeNote) : [];
      lines.push(`${detailIndent}  notes:${notes.length ? '' : ' (none)'}`);
      for (const note of notes) {
        lines.push(`${detailIndent}    - ${note.timestamp || '(no timestamp)'}`);
        for (const ln of note.text.split('\n')) lines.push(`${detailIndent}      ${ln}`);
      }
    }
  }

  function appendSpine(depth) {
    const currentAtDepth = lineage[depth];
    const indent = '  '.repeat(depth);
    const peers = opts.includeSiblings
      ? childrenOf(items, currentAtDepth.parentKey || null)
      : [currentAtDepth];
    for (const peer of peers) {
      lines.push(formatItemLine(items, peer, opts.activeKey, indent));
      if (peer.key !== currentAtDepth.key) continue;
      if (depth === lineage.length - 1) {
        appendItemDetails(currentAtDepth, depth);
      } else {
        appendSpine(depth + 1);
      }
    }
  }

  appendSpine(0);
  process.stdout.write(lines.join('\n') + '\n');
}

function printJson(data) {
  process.stdout.write(JSON.stringify(pruneDefaults({ status: 'ok', data }), null, 2) + '\n');
}

function pruneDefaults(value) {
  if (Array.isArray(value)) return value.map(pruneDefaults);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    const v = pruneDefaults(raw);
    if (v === null || v === undefined) continue;
    if (v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && Object.keys(v).length === 0) continue;
    result[key] = v;
  }
  return result;
}

function emitOutput(flags, human, data) {
  if (flags.json) {
    printJson(data);
    return;
  }
  human();
  if (flags.debug) {
    process.stdout.write('\n');
    printJson(data);
  }
}

function toPublicItem(items, f) {
  return {
    key: f.key,
    parentKey: f.parentKey || null,
    path: pathOf(items, f),
    position: positionOf(items, f),
    title: f.title,
    done: Boolean(f.done),
    pushedAt: f.pushedAt,
    closedAt: f.closedAt,
    notes: Array.isArray(f.notes) ? f.notes.map(normalizeNote) : [],
  };
}

function currentTreeData(store, target, flags = {}) {
  if (!target) return null;
  const kids = flags.nokids
    ? undefined
    : childrenOf(store.items, target.key)
        .map((k) => toPublicItem(store.items, k));
  const sibs = siblingsOf(store.items, target)
    .map((s) => toPublicItem(store.items, s));
  return {
    ...toPublicItem(store.items, target),
    active: store.active ? pathOf(store.items, findByKey(store.items, store.active)) : null,
    ancestors: ancestorsOf(store.items, target).map((a) => toPublicItem(store.items, a)),
    siblings: sibs,
    ...(kids ? { children: kids } : {}),
  };
}

function emitCurrentTree(store, target, flags, options = {}) {
  emitOutput(
    flags,
    () => printItem(store.items, target, {
      activeKey: store.active,
      includeAncestors: true,
      includeSiblings: true,
      includeChildren: !flags.nokids,
      includeNotes: Boolean(options.includeNotes),
    }),
    currentTreeData(store, target, flags),
  );
}

// ── Commands ─────────────────────────────────────────────────────────────────

function resolveStoreFile(flags) {
  if (flags.file) return { file: flags.file, source: 'flag' };
  if (process.env.NOGGIN_FILE) return { file: process.env.NOGGIN_FILE, source: 'env' };
  return { file: DEFAULT_FILE, source: 'default' };
}

function getStoreFile(flags) {
  return resolveStoreFile(flags).file;
}

function hasGoto(flags) {
  return Object.prototype.hasOwnProperty.call(flags, 'goto');
}

function resolveGotoTarget(store, base, gotoPath, commandName) {
  if (!base) fail(`${commandName}: --goto has no base item`, 1);
  const scopedStore = { ...store, active: base.key };
  const resolved = tryResolveDetailed(scopedStore, gotoPath);
  if (!resolved.ok) fail(`${commandName}: --goto ${resolved.error}`, 1);
  return resolved.item;
}

function applyGoto(store, base, flags, defaultPath, commandName) {
  if (!hasGoto(flags)) return base;
  const gotoPath = flags.goto === true ? defaultPath : flags.goto;
  if (!gotoPath) fail(`${commandName}: --goto requires a path`, 1);
  const target = resolveGotoTarget(store, base, gotoPath, commandName);
  store.active = target.key;
  return target;
}

function moveActiveTo(store, target) {
  store.active = target ? target.key : null;
  return target;
}

function isDescendant(items, candidate, root) {
  if (!candidate || !root) return false;
  let node = candidate;
  while (node && node.parentKey) {
    if (node.parentKey === root.key) return true;
    node = findByKey(items, node.parentKey);
  }
  return false;
}

// Resolve --before / --after / --into into { kind, anchor }, or null when none given.
// Errors if multiple are given or the flag value is missing.
function parsePlacement(store, flags, commandName) {
  const present = ['before', 'after', 'into'].filter((k) => flags[k] !== undefined);
  if (present.length === 0) return null;
  if (present.length > 1) {
    fail(`${commandName}: --before, --after, and --into are mutually exclusive`);
  }
  const kind = present[0];
  const anchorPath = flags[kind];
  if (typeof anchorPath !== 'string' || anchorPath === '') {
    fail(`${commandName}: --${kind} requires a path value`);
  }
  const anchor = resolvePath(store, anchorPath);
  return { kind, anchor };
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

// push: child of active (or root if none), becomes active.
function cmdPush({ positional, flags }) {
  const title = flags.title || positional.join(' ').trim();
  if (!title) fail('push: title required (--title or positional)');
  const file = getStoreFile(flags);
  const store = loadStore(file);
  const activeItem = findByKey(store.items, store.active);
  const parentKey = activeItem ? activeItem.key : null;
  const item = makeItem({
    title,
    parentKey,
  });
  store.items.push(item);
  store.active = item.key;
  saveStore(file, store);
  emitCurrentTree(store, item, flags);
}

// add: child of active (or root if none) by default. --before/--after/--into
// place the new item as a sibling of, or last child of, an explicit anchor.
// Active does NOT change unless --goto is used.
function cmdAdd({ positional, flags }) {
  const title = flags.title || positional.join(' ').trim();
  if (!title) fail('add: title required (--title or positional)');
  const file = getStoreFile(flags);
  const store = loadStore(file);
  const activeItem = findByKey(store.items, store.active);
  const placement = parsePlacement(store, flags, 'add');

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
  const outputTarget = hasGoto(flags) ? applyGoto(store, item, flags, '.', 'add') : item;
  saveStore(file, store);
  emitCurrentTree(store, outputTarget, flags);
}

// move [path] (--before|--after|--into <anchor>): relocate an item.
// Default target = active. Exactly one placement flag is required.
// Active pointer is preserved by key; cycles are rejected.
function cmdMove({ positional, flags }) {
  if (positional.length > 1) fail('move: accepts at most one path');
  const file = getStoreFile(flags);
  const store = loadStore(file);
  const placement = parsePlacement(store, flags, 'move');
  if (!placement) {
    fail('move: choose exactly one of --before, --after, or --into');
  }
  const { kind, anchor } = placement;

  let target;
  if (positional[0]) target = resolvePath(store, positional[0]);
  else {
    target = findByKey(store.items, store.active);
    if (!target) fail('move: no active item; pass a path', 1);
  }

  if (kind === 'into') {
    if (target.key === anchor.key) {
      fail(`move: cannot move ${pathOf(store.items, target)} into itself (would create a cycle)`, 1);
    }
    if (isDescendant(store.items, anchor, target)) {
      fail(`move: cannot move ${pathOf(store.items, target)} into its own subtree (would create a cycle)`, 1);
    }
  } else {
    if (isDescendant(store.items, anchor, target)) {
      fail(`move: cannot move ${pathOf(store.items, target)} next to its own descendant (would create a cycle)`, 1);
    }
    if (anchor.key === target.key) {
      // before/after self: same place. Silent no-op success.
      const activeItem = findByKey(store.items, store.active);
      const outputTarget = hasGoto(flags) ? applyGoto(store, target, flags, '.', 'move') : (activeItem || target);
      saveStore(file, store);
      emitCurrentTree(store, outputTarget, flags);
      return;
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
  const outputTarget = hasGoto(flags) ? applyGoto(store, target, flags, '.', 'move') : (activeItem || target);
  saveStore(file, store);
  emitCurrentTree(store, outputTarget, flags);
}

// goto <path>: switch active to that item.
function cmdGoto({ positional, flags }) {
  const p = positional[0];
  if (!p) fail('goto: path required');
  const file = getStoreFile(flags);
  const store = loadStore(file);
  const target = resolvePath(store, p);
  store.active = target.key;
  saveStore(file, store);
  emitCurrentTree(store, target, flags);
}

// done [path]: mark an item done, then move active to the target's parent.
// Refuses if there are open descendants.
function cmdDone({ positional, flags }) {
  if (hasGoto(flags)) fail('done: --goto is not supported; done always moves to the target parent');
  const p = positional[0];
  if (positional.length > 1) fail('done: accepts at most one path');
  const file = getStoreFile(flags);
  const store = loadStore(file);
  let target;
  if (p) target = resolvePath(store, p);
  else {
    target = findByKey(store.items, store.active);
    if (!target) fail('done: no active item; pass a path', 1);
  }
  if (target.done) fail(`done: ${pathOf(store.items, target)} already done`, 1);
  const open = countOpenDescendants(store.items, target);
  if (open > 0) fail(`done: ${pathOf(store.items, target)} has ${open} open descendant(s); mark them done first`, 1);
  target.done = true;
  target.closedAt = nowIso();
  const parent = target.parentKey ? findByKey(store.items, target.parentKey) : null;
  moveActiveTo(store, parent);
  saveStore(file, store);
  emitCurrentTree(store, parent || target, flags);
}

// pop: same as `done` with no path — finish the active item and surface to its parent.
function cmdPop({ positional, flags }) {
  if (positional.length > 0) fail('pop: takes no path; pop always operates on the active item');
  if (hasGoto(flags)) fail('pop: --goto is not supported; pop always moves to the active item\'s parent');
  const file = getStoreFile(flags);
  const store = loadStore(file);
  if (!findByKey(store.items, store.active)) fail('pop: no active item', 1);
  return cmdDone({ positional: [], flags });
}

// set-state [path] (--done|--undone): explicitly set lifecycle state.
// Default target = active. Active is not moved unless --goto is used.
function cmdSetState({ positional, flags }) {
  if (flags.done === true && flags.undone === true) {
    fail('set-state: choose exactly one of --done or --undone');
  }
  if (flags.done !== true && flags.undone !== true) {
    fail('set-state: choose exactly one of --done or --undone');
  }
  if (positional.length > 1) fail('set-state: accepts at most one path');
  const p = positional[0];
  const file = getStoreFile(flags);
  const store = loadStore(file);
  let target;
  if (p) target = resolvePath(store, p);
  else {
    target = findByKey(store.items, store.active);
    if (!target) fail('set-state: no active item; pass a path', 1);
  }

  if (flags.done === true) {
    const open = countOpenDescendants(store.items, target);
    if (open > 0) fail(`set-state: ${pathOf(store.items, target)} has ${open} open descendant(s); mark them done first`, 1);
    if (!target.done) target.closedAt = nowIso();
    target.done = true;
  } else {
    target.done = false;
    target.closedAt = null;
  }

  const outputTarget = applyGoto(store, target, flags, '.', 'set-state');
  saveStore(file, store);
  emitCurrentTree(store, outputTarget, flags);
}

// show [path]: detail for one item plus its first-level children.
// Default target = active item. --nokids skips the children list.
function cmdShow({ positional, flags }) {
  const file = getStoreFile(flags);
  const store = loadStore(file);
  const target = positional[0]
    ? resolvePath(store, positional[0])
    : findByKey(store.items, store.active);
  if (!target) {
    emitOutput(flags, () => process.stdout.write('(no active item; pass a path)\n'), null);
    return;
  }
  const outputTarget = applyGoto(store, target, flags, '.', 'show');
  if (hasGoto(flags)) saveStore(file, store);
  emitCurrentTree(store, outputTarget, flags, { includeNotes: flags.notes === true });
}

// delete <path> [--recursive]: remove an item from the tree.
// Refuses if the item has any descendants unless --recursive is passed.
// If the deleted subtree contains the active item, active becomes the
// deleted item's parent (or null if it was a root). Done and open items
// are both deletable; notes and timestamps go with the item.
function cmdDelete({ positional, flags }) {
  if (hasGoto(flags)) fail('delete: --goto is not supported');
  if (positional.length === 0) fail('delete: path required');
  if (positional.length > 1) fail('delete: accepts at most one path');
  const file = getStoreFile(flags);
  const store = loadStore(file);
  const target = resolvePath(store, positional[0]);
  const targetPath = pathOf(store.items, target);
  const descendants = collectDescendants(store.items, target);
  if (descendants.length > 0 && flags.recursive !== true) {
    fail(
      `delete: ${targetPath} has ${descendants.length} descendant(s); ` +
        `pass --recursive to delete the whole subtree`,
      1,
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
  if (newActive) {
    emitCurrentTree(store, newActive, flags);
  } else {
    emitOutput(
      flags,
      () => process.stdout.write(`deleted ${targetPath}${descendants.length ? ` and ${descendants.length} descendant(s)` : ''}\n`),
      { deleted: targetPath, descendantCount: descendants.length, active: null },
    );
  }
}

function collectDescendants(items, root) {
  const out = [];
  const stack = [...childrenOf(items, root.key)];
  while (stack.length) {
    const f = stack.pop();
    out.push(f);
    for (const c of childrenOf(items, f.key)) stack.push(c);
  }
  return out;
}

function cmdNote({ positional, flags }) {
  const file = getStoreFile(flags);
  const store = loadStore(file);
  let target = findByKey(store.items, store.active);
  let textParts = positional;
  if (positional.length > 0) {
    const resolved = tryResolve(store, positional[0]);
    if (resolved) {
      target = resolved;
      textParts = positional.slice(1);
    }
  }
  if (!target) fail('note: no active item and no path given', 1);
  const text = textParts.join(' ').trim();
  if (!text) fail('note: text required');
  if (!Array.isArray(target.notes)) target.notes = [];
  target.notes.push({ timestamp: nowIso(), text });
  const outputTarget = applyGoto(store, target, flags, '.', 'note');
  saveStore(file, store);
  emitCurrentTree(store, outputTarget, flags);
}

function cmdRetitle({ positional, flags }) {
  // Usage: retitle [<path>] <new title…>  OR  retitle [<path>] --title "<T>"
  const file = getStoreFile(flags);
  const store = loadStore(file);
  let target = null;
  let textStart = 0;
  if (positional.length > 0) {
    const resolved = tryResolve(store, positional[0]);
    if (resolved) { target = resolved; textStart = 1; }
  }
  if (!target) target = findByKey(store.items, store.active);
  if (!target) fail('retitle: no active item and no path given', 1);
  const newTitle = flags.title || positional.slice(textStart).join(' ').trim();
  if (!newTitle) fail('retitle: new title required');
  target.title = newTitle;
  const outputTarget = applyGoto(store, target, flags, '.', 'retitle');
  saveStore(file, store);
  emitCurrentTree(store, outputTarget, flags);
}

function cmdWhere({ flags }) {
  const { file, source } = resolveStoreFile(flags);
  const exists = fs.existsSync(file);
  emitOutput(
    flags,
    () => {
      process.stdout.write(`${file}\n`);
      process.stdout.write(`  source: ${source}\n`);
      process.stdout.write(`  exists: ${exists}\n`);
    },
    { file, source, exists, defaultFile: DEFAULT_FILE, env: process.env.NOGGIN_FILE || null },
  );
}

function cmdHelp() {
  process.stdout.write([
    'noggin — working-memory tree CLI',
    '',
    'An item has: title, done flag, timestamps, and append-only notes.',
    'No fixed schema for content. Anything worth saying goes in a note.',
    '',
    'Addressing:',
    '  path   absolute 1-based positions, e.g. "1/2/3"',
    '         or relative to active: ".", "..", "-", "+", "./X/Y", "../X", "-/X/Y", "+/X/Y"',
    '  tree   bracket indicators: 📍 active, ✅ done, ✏️ has notes',
    '',
    'Verbs:',
    '  push <title>                    child of active, becomes active',
    '  add  <title> [--before|--after|--into <path>] [--goto [path]]',
    '                                  child of active by default; placement flags pick a different spot',
    '  move [<path>] (--before|--after|--into <path>) [--goto [path]]',
    '                                  relocate an item; required placement flag picks the destination',
    '  goto <path>                     make <path> the active item',
    '  done [<path>]                   mark done, then make the parent active',
    '  pop                             same as `done` on the active item (no path)',
    '  set-state [<path>] (--done|--undone) [--goto [path]]',
    '                                  explicitly set state; --goto with no path activates target',
    '  show [<path>] [--nokids] [--notes] [--goto [path]]',
    '                                  current tree view; add --notes to include note bodies',
    '  note [<path>] <text…> [--goto [path]]',
    '                                  append a timestamped note',
    '  retitle [<path>] <new title…> [--goto [path]]',
    '                                  change an item title',
    '  delete <path> [--recursive]     remove an item; --recursive also removes its subtree',
    '  where                           print which noggin file would be used and why',
    '  help',
    '',
    'Item creation flags (push/add):',
    '  --title T                       title (alternative to positional)',
    '',
    'Common:',
    '  --file <path>                   override the file resolution (highest priority)',
    '  --goto [path]                   move after command; relative paths resolve from target',
    '  --json                          structured output',
    '  --debug                         human output followed by structured output',
    '',
    'File resolution (highest first):',
    '  1. --file <path>',
    `  2. $NOGGIN_FILE env var`,
    `  3. ${DEFAULT_FILE}`,
    '',
  ].join('\n'));
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) { cmdHelp(); process.exit(0); }
  const { verb, args } = splitCommand(argv);
  const parsed = parseArgs(args);
  if (parsed.flags.help) { cmdHelp(); process.exit(0); }
  switch (verb) {
    case 'push':     return cmdPush(parsed);
    case 'add':      return cmdAdd(parsed);
    case 'move':     return cmdMove(parsed);
    case 'goto':     return cmdGoto(parsed);
    case 'done':     return cmdDone(parsed);
    case 'pop':      return cmdPop(parsed);
    case 'set-state': return cmdSetState(parsed);
    case 'show':     return cmdShow(parsed);
    case 'note':     return cmdNote(parsed);
    case 'retitle':  return cmdRetitle(parsed);
    case 'delete':   return cmdDelete(parsed);
    case 'where':    return cmdWhere(parsed);
    case 'help':
    case '--help':
    case '-h':       cmdHelp(); return;
    default:         fail(`unknown command: ${verb} (try 'help')`);
  }
}

main();
