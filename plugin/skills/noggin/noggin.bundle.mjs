#!/usr/bin/env node
// AUTO-GENERATED BUNDLE — DO NOT EDIT.
// Source: cli/noggin.mjs (+ inlined deps).
// Rebuild: node scripts/sync-skill.mjs

var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// engine/noggin-api.mjs
var noggin_api_exports = {};
__export(noggin_api_exports, {
  CLOSE_NOTE_TEXT: () => CLOSE_NOTE_TEXT,
  JSON_SCHEMA_VERSION: () => JSON_SCHEMA_VERSION,
  NogginError: () => NogginError,
  RESPONSE_ENVELOPE_VERSION: () => RESPONSE_ENVELOPE_VERSION,
  SCHEMA_VERSION: () => SCHEMA_VERSION,
  applyOps: () => applyOps,
  buildView: () => buildView,
  childrenOf: () => childrenOf,
  diffDocuments: () => diffDocuments,
  documentsEqual: () => documentsEqual,
  factories: () => factories,
  formatError: () => formatError,
  formatSuccess: () => formatSuccess,
  freezeDocument: () => freezeDocument,
  normalizeDocument: () => normalizeDocument,
  normalizeNote: () => normalizeNote,
  openNoggin: () => openNoggin,
  pathOf: () => pathOf,
  resolvePath: () => resolvePath,
  tryResolvePath: () => tryResolvePath,
  validateDocument: () => validateDocument,
  verbs: () => verbs
});
import crypto from "node:crypto";
function randomBytesHex(n) {
  const gc = globalThis.crypto;
  if (gc && typeof gc.getRandomValues === "function") {
    const buf = new Uint8Array(n);
    gc.getRandomValues(buf);
    let s = "";
    for (let i = 0; i < n; i++) s += buf[i].toString(16).padStart(2, "0");
    return s;
  }
  return crypto.randomBytes(n).toString("hex");
}
function usage(code, message) {
  throw new NogginError(message, { code, exitCode: 2 });
}
function runtime(code, message) {
  throw new NogginError(message, { code, exitCode: 1 });
}
function nowIso(ctx) {
  return (ctx && ctx.now || /* @__PURE__ */ new Date()).toISOString();
}
function newKey() {
  const d = /* @__PURE__ */ new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const slug = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  const hex = randomBytesHex(3);
  return `i-${slug}-${hex}`;
}
function normalizeNote(note) {
  if (note && typeof note === "object" && note.text !== void 0) {
    return { timestamp: note.timestamp ? String(note.timestamp) : null, text: String(note.text) };
  }
  usage("invalid-note", "internal: invalid note object");
}
function normalizeDocument(doc) {
  doc.schemaVersion = SCHEMA_VERSION;
  for (const f of doc.items) {
    if (!Array.isArray(f.notes)) usage("invalid-document", "invalid contents: item notes must be an array");
    f.notes = f.notes.map(normalizeNote);
    if ("closedAt" in f) delete f.closedAt;
    if ("pushedAt" in f) delete f.pushedAt;
  }
  return doc;
}
function validateDocument(doc) {
  if (!doc || !Array.isArray(doc.items)) {
    usage("invalid-document", "invalid contents: expected items array");
  }
  const keys = /* @__PURE__ */ new Set();
  for (const f of doc.items) {
    if (!f.key) usage("invalid-document", "internal: item missing key");
    if (keys.has(f.key)) usage("invalid-document", "internal: duplicate item key detected");
    keys.add(f.key);
  }
  for (const f of doc.items) {
    if (f.parentKey != null && !keys.has(f.parentKey)) {
      usage("invalid-document", `internal: item '${f.key}' has unknown parent reference '${f.parentKey}'`);
    }
  }
  const limit = doc.items.length + 1;
  for (const f of doc.items) {
    let n = f;
    let steps = 0;
    while (n.parentKey != null) {
      if (++steps > limit) {
        usage("invalid-document", `internal: parent chain cycle detected at '${f.key}'`);
      }
      n = doc.items.find((x) => x.key === n.parentKey);
      if (!n) break;
    }
  }
  if (doc.active != null && !keys.has(doc.active)) {
    usage("invalid-document", `internal: active points to unknown item '${doc.active}'`);
  }
}
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
  return "/" + parts.join("/");
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
function siblingRelative(items, item, delta, originalForError) {
  const peers = _childrenOf(items, item.parentKey || null);
  const index = peers.findIndex((p) => p.key === item.key);
  const target = peers[index + delta];
  if (!target) {
    const direction = delta < 0 ? "previous" : "next";
    return { ok: false, error: `path '${originalForError}': active item has no ${direction} sibling` };
  }
  return { ok: true, item: target };
}
function walkPath(items, base, segPath, originalForError) {
  const segments = segPath.split("/").filter(Boolean);
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
      const where = current ? `under '${_pathOf(items, current)}'` : "at root";
      return { ok: false, error: `path not found: ${originalForError} (no position ${position} ${where})` };
    }
    current = match;
  }
  return { ok: true, item: current };
}
function tryResolveDetailed(store, p) {
  if (!p) return { ok: false, error: `path: empty path` };
  const s = String(p);
  const active = store.active ? findByKey(store.items, store.active) : null;
  if (s.startsWith("/")) {
    const rest2 = s.slice(1);
    if (rest2 === "") return { ok: false, error: `path '${s}': empty absolute path` };
    return walkPath(store.items, null, rest2, s);
  }
  if (s === ".") {
    if (!active) return { ok: false, error: `path '.': no active item` };
    return { ok: true, item: active };
  }
  if (s === "..") {
    if (!active) return { ok: false, error: `path '..': no active item` };
    if (!active.parentKey) return { ok: false, error: `path '..': active item has no parent` };
    return { ok: true, item: findByKey(store.items, active.parentKey) };
  }
  if (s === "-" || s === "+") {
    if (!active) return { ok: false, error: `path '${s}': no active item` };
    return siblingRelative(store.items, active, s === "-" ? -1 : 1, s);
  }
  if (s.startsWith("-/") || s.startsWith("+/")) {
    if (!active) return { ok: false, error: `path '${s}' is relative but no active item` };
    const direction = s[0] === "-" ? -1 : 1;
    const sibling = siblingRelative(store.items, active, direction, s);
    if (!sibling.ok) return sibling;
    const rest2 = s.slice(2);
    if (rest2 === "") return { ok: false, error: `path '${s}': trailing slash with no descendant` };
    return walkPath(store.items, sibling.item, rest2, s);
  }
  if (!active) return { ok: false, error: `path '${s}' is relative but no active item` };
  let base = active;
  let rest = s;
  while (rest === ".." || rest.startsWith("../")) {
    if (!base.parentKey) return { ok: false, error: `path '${s}': cannot go above root` };
    base = findByKey(store.items, base.parentKey);
    rest = rest === ".." ? "" : rest.slice(3);
  }
  if (rest.startsWith("./")) rest = rest.slice(2);
  if (rest === "") return { ok: true, item: base };
  return walkPath(store.items, base, rest, s);
}
function resolvePath(store, p) {
  const r = tryResolveDetailed(store, p);
  if (r.ok) return r.item;
  runtime("path-not-found", r.error);
}
function tryResolvePath(store, p) {
  const r = tryResolveDetailed(store, p);
  return r.ok ? r.item : null;
}
function pathOf(store, item) {
  return _pathOf(store.items, item);
}
function childrenOf(store, parentKey) {
  return _childrenOf(store.items, parentKey || null);
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
function toPublicItem(items, f) {
  return {
    key: f.key,
    parentKey: f.parentKey || null,
    path: _pathOf(items, f),
    position: positionOf(items, f),
    title: f.title,
    done: Boolean(f.done),
    createdAt: f.createdAt,
    notes: Array.isArray(f.notes) ? f.notes.map(normalizeNote) : []
  };
}
function buildView(store, target, opts = {}) {
  if (!target) return null;
  const includeChildren = opts.includeChildren !== false;
  const withSiblings = opts.withSiblings === true;
  const withDescendants = opts.withDescendants === true;
  const activeItem = store.active ? findByKey(store.items, store.active) : null;
  const lineage = [...ancestorsOf(store.items, target), target];
  const leaf = (item) => toPublicItem(store.items, item);
  function expanded(item) {
    return {
      ...toPublicItem(store.items, item),
      children: _childrenOf(store.items, item.key).map(expanded)
    };
  }
  let targetNode;
  if (!includeChildren) {
    targetNode = leaf(target);
  } else if (withDescendants) {
    targetNode = expanded(target);
  } else {
    targetNode = {
      ...toPublicItem(store.items, target),
      children: _childrenOf(store.items, target.key).map(leaf)
    };
  }
  let level = _childrenOf(store.items, target.parentKey || null).map(
    (it) => it.key === target.key ? targetNode : leaf(it)
  );
  for (let i = lineage.length - 2; i >= 0; i--) {
    const ancestor = lineage[i];
    const isTargetParent = i === lineage.length - 2;
    let ancestorChildren;
    if (isTargetParent || !withSiblings) {
      ancestorChildren = level;
    } else {
      const nextSpineKey = level[0].key;
      ancestorChildren = _childrenOf(store.items, ancestor.key).map(
        (it) => it.key === nextSpineKey ? level[0] : leaf(it)
      );
    }
    level = [{
      ...toPublicItem(store.items, ancestor),
      children: ancestorChildren
    }];
  }
  return {
    activePath: activeItem ? _pathOf(store.items, activeItem) : null,
    activeKey: activeItem ? activeItem.key : null,
    targetKey: target.key,
    items: level
  };
}
function pruneDefaults(value) {
  if (Array.isArray(value)) return value.map(pruneDefaults);
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const predicate = PRUNABLE_DEFAULTS[key];
    if (predicate && predicate(raw)) continue;
    out[key] = pruneDefaults(raw);
  }
  return out;
}
function formatSuccess({ verb, data } = {}) {
  return {
    status: "ok",
    envelopeVersion: RESPONSE_ENVELOPE_VERSION,
    verb: verb || null,
    data: data === void 0 ? null : pruneDefaults(data)
  };
}
function formatError({ verb, error } = {}) {
  const isNoggin = error instanceof NogginError;
  const message = error instanceof Error ? error.message : String(error ?? "unknown error");
  const code = isNoggin ? error.code : "noggin-error";
  const exitCode = isNoggin ? error.exitCode : 1;
  return {
    status: "error",
    envelopeVersion: RESPONSE_ENVELOPE_VERSION,
    verb: verb || null,
    error: { code, message, exitCode }
  };
}
function executeGotoOption(snapshot, base, goto, commandName) {
  if (goto === void 0) return base;
  if (!base) runtime("goto-base-missing", `${commandName}: --goto has no base item`);
  const gotoPath = goto === true ? "." : goto;
  if (!gotoPath) runtime("goto-path-required", `${commandName}: --goto requires a path`);
  const scopedDoc = { ...snapshot, active: base.key };
  const resolved = tryResolveDetailed(scopedDoc, gotoPath);
  if (!resolved.ok) runtime("goto-unresolved", `${commandName}: --goto ${resolved.error}`);
  return resolved.item;
}
function makeItem({ title, parentKey }, ctx) {
  return {
    key: newKey(),
    parentKey: parentKey ?? null,
    title,
    done: false,
    createdAt: nowIso(ctx),
    notes: []
  };
}
function resolvePlacement(snapshot, placement, commandName) {
  if (!placement) return null;
  const { kind, anchor } = placement;
  if (!kind || !anchor) {
    usage("placement-missing", `${commandName}: placement requires both kind and anchor`);
  }
  if (kind !== "before" && kind !== "after" && kind !== "into") {
    usage("placement-invalid", `${commandName}: unknown placement kind '${kind}'`);
  }
  const anchorItem = resolvePath(snapshot, anchor);
  return { kind, anchor: anchorItem };
}
function placementToTarget(snapshot, placement) {
  const { kind, anchor } = placement;
  if (kind === "into") {
    return { parentKey: anchor.key, position: "end" };
  }
  const siblings = _childrenOf(snapshot.items, anchor.parentKey ?? null);
  const idx = siblings.findIndex((s) => s.key === anchor.key);
  return {
    parentKey: anchor.parentKey ?? null,
    position: kind === "before" ? idx : idx + 1
  };
}
function nogginSnapshot(noggin) {
  return {
    items: noggin.items,
    active: noggin.active ? noggin.active.key : null
  };
}
function applyOps(doc, ops) {
  if (!Array.isArray(ops)) usage("invalid-op", "applyOps: ops must be an array");
  for (const op of ops) applyOp(doc, op);
  validateDocument(doc);
  return doc;
}
function applyOp(doc, op) {
  if (!op || typeof op !== "object") usage("invalid-op", "applyOps: op must be an object");
  switch (op.type) {
    case "add":
      return opAdd(doc, op);
    case "remove":
      return opRemove(doc, op);
    case "set":
      return opSet(doc, op);
    case "note":
      return opNote(doc, op);
    case "move":
      return opMove(doc, op);
    case "setActive":
      return opSetActive(doc, op);
    default:
      usage("invalid-op", `applyOps: unknown op type '${op && op.type}'`);
  }
}
function insertAtPosition(items, item, parentKey, position) {
  const pkey = parentKey ?? null;
  if (position === "end") {
    items.push(item);
    return;
  }
  if (typeof position !== "number" || position < 0) {
    usage("invalid-op", `add/move: invalid position ${JSON.stringify(position)}`);
  }
  const siblings = items.filter((i) => (i.parentKey ?? null) === pkey);
  if (position >= siblings.length) {
    if (siblings.length === 0) {
      items.push(item);
      return;
    }
    const last = siblings[siblings.length - 1];
    items.splice(items.indexOf(last) + 1, 0, item);
    return;
  }
  const before = siblings[position];
  items.splice(items.indexOf(before), 0, item);
}
function opAdd(doc, op) {
  if (!op.item || !op.item.key) usage("invalid-op", "add: op.item with key required");
  if (doc.items.some((i) => i.key === op.item.key)) {
    usage("invalid-op", `add: item with key '${op.item.key}' already exists`);
  }
  const item = {
    key: op.item.key,
    parentKey: op.parentKey ?? null,
    title: op.item.title,
    done: Boolean(op.item.done),
    createdAt: op.item.createdAt,
    notes: Array.isArray(op.item.notes) ? op.item.notes.map(normalizeNote) : []
  };
  insertAtPosition(doc.items, item, op.parentKey, op.position);
}
function opRemove(doc, op) {
  if (!Array.isArray(op.keys)) usage("invalid-op", "remove: op.keys array required");
  const removeSet = new Set(op.keys);
  doc.items = doc.items.filter((i) => !removeSet.has(i.key));
}
function opSet(doc, op) {
  if (!op.key) usage("invalid-op", "set: op.key required");
  const item = doc.items.find((i) => i.key === op.key);
  if (!item) usage("invalid-op", `set: item with key '${op.key}' not found`);
  if (!op.patch || typeof op.patch !== "object") usage("invalid-op", "set: op.patch object required");
  if (op.patch.title !== void 0) item.title = op.patch.title;
  if (op.patch.done !== void 0) item.done = Boolean(op.patch.done);
}
function opNote(doc, op) {
  if (!op.key) usage("invalid-op", "note: op.key required");
  const item = doc.items.find((i) => i.key === op.key);
  if (!item) usage("invalid-op", `note: item with key '${op.key}' not found`);
  if (!op.note || op.note.text === void 0) usage("invalid-op", "note: op.note.text required");
  if (!Array.isArray(item.notes)) item.notes = [];
  item.notes.push(normalizeNote(op.note));
}
function opMove(doc, op) {
  if (!op.key) usage("invalid-op", "move: op.key required");
  const item = doc.items.find((i) => i.key === op.key);
  if (!item) usage("invalid-op", `move: item with key '${op.key}' not found`);
  const idx = doc.items.indexOf(item);
  doc.items.splice(idx, 1);
  item.parentKey = op.parentKey ?? null;
  insertAtPosition(doc.items, item, op.parentKey, op.position);
}
function opSetActive(doc, op) {
  doc.active = op.key ?? null;
}
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
      notes: (i.notes || []).map((n) => ({ timestamp: n.timestamp, text: n.text }))
    }))
  };
  for (const op of ops) applyOp(doc, op);
  return doc;
}
async function verbPush(noggin, opts, ctx) {
  const title = (opts && opts.title || "").toString();
  const active = noggin.active;
  const item = makeItem({ title, parentKey: active ? active.key : null }, ctx);
  const ops = [
    { type: "add", item, parentKey: active ? active.key : null, position: "end" },
    { type: "setActive", key: item.key }
  ];
  await noggin.apply(ops);
  return buildView(nogginSnapshot(noggin), noggin.findByKey(item.key), {});
}
async function verbAdd(noggin, opts = {}, ctx) {
  const title = (opts.title || "").toString();
  const snap = nogginSnapshot(noggin);
  const active = noggin.active;
  const placement = resolvePlacement(snap, opts.placement, "add");
  let parentKey, position;
  if (placement) {
    ({ parentKey, position } = placementToTarget(snap, placement));
  } else {
    parentKey = active ? active.key : null;
    position = "end";
  }
  const item = makeItem({ title, parentKey }, ctx);
  const ops = [{ type: "add", item, parentKey, position }];
  let viewTargetKey = item.key;
  if (opts.goto !== void 0) {
    const projected = projectOps(noggin, ops);
    const projectedNew = findByKey(projected.items, item.key);
    const target = executeGotoOption(projected, projectedNew, opts.goto, "add");
    ops.push({ type: "setActive", key: target.key });
    viewTargetKey = target.key;
  }
  await noggin.apply(ops);
  return buildView(nogginSnapshot(noggin), noggin.findByKey(viewTargetKey), {});
}
async function verbMove(noggin, opts = {}) {
  const snap = nogginSnapshot(noggin);
  const placement = resolvePlacement(snap, opts.placement, "move");
  if (!placement) usage("placement-missing", "move: choose exactly one of --before, --after, or --into");
  const { kind, anchor } = placement;
  let target;
  if (opts.path) target = noggin.resolvePath(opts.path);
  else {
    target = noggin.active;
    if (!target) runtime("no-active-item", "move: no active item; pass a path");
  }
  if (kind === "into") {
    if (target.key === anchor.key) {
      runtime("cycle", `move: cannot move ${noggin.pathOf(target)} into itself (would create a cycle)`);
    }
    if (isDescendant(noggin.items, anchor, target)) {
      runtime("cycle", `move: cannot move ${noggin.pathOf(target)} into its own subtree (would create a cycle)`);
    }
  } else {
    if (isDescendant(noggin.items, anchor, target)) {
      runtime("cycle", `move: cannot move ${noggin.pathOf(target)} next to its own descendant (would create a cycle)`);
    }
  }
  let parentKey, position;
  if (kind === "into") {
    parentKey = anchor.key;
    position = "end";
  } else if (anchor.key === target.key) {
    parentKey = target.parentKey ?? null;
    const siblings = _childrenOf(noggin.items, parentKey);
    position = siblings.findIndex((s) => s.key === target.key);
  } else {
    parentKey = anchor.parentKey ?? null;
    const siblings = _childrenOf(noggin.items, parentKey).filter((s) => s.key !== target.key);
    const anchorIdx = siblings.findIndex((s) => s.key === anchor.key);
    position = kind === "before" ? anchorIdx : anchorIdx + 1;
  }
  const ops = [{ type: "move", key: target.key, parentKey, position }];
  let viewTargetKey;
  if (opts.goto !== void 0) {
    const projected = projectOps(noggin, ops);
    const projectedTarget = findByKey(projected.items, target.key);
    const gotoTarget = executeGotoOption(projected, projectedTarget, opts.goto, "move");
    ops.push({ type: "setActive", key: gotoTarget.key });
    viewTargetKey = gotoTarget.key;
  } else {
    viewTargetKey = noggin.active ? noggin.active.key : target.key;
  }
  await noggin.apply(ops);
  return buildView(nogginSnapshot(noggin), noggin.findByKey(viewTargetKey), {});
}
async function verbGoto(noggin, opts = {}) {
  if (!opts.path) usage("path-required", "goto: path required");
  const target = noggin.resolvePath(opts.path);
  const ops = [{ type: "setActive", key: target.key }];
  await noggin.apply(ops);
  return buildView(nogginSnapshot(noggin), noggin.findByKey(target.key), {});
}
async function verbDone(noggin, opts = {}, ctx) {
  if (opts.goto !== void 0) usage("goto-unsupported", "done: --goto is not supported; done always moves to the target parent");
  let target;
  if (opts.path) target = noggin.resolvePath(opts.path);
  else {
    target = noggin.active;
    if (!target) runtime("no-active-item", "done: no active item; pass a path");
  }
  const closeOps = buildCloseOps(noggin, target, opts, "done", ctx);
  const parentKey = target.parentKey ?? null;
  const ops = [...closeOps, { type: "setActive", key: parentKey }];
  await noggin.apply(ops);
  const newActive = noggin.active;
  const viewTarget = newActive || noggin.findByKey(target.key);
  return buildView(nogginSnapshot(noggin), viewTarget, {});
}
async function verbPop(noggin, opts = {}, ctx) {
  if (opts && opts.path !== void 0) usage("pop-no-path", "pop: takes no path; pop always operates on the active item");
  if (opts && opts.goto !== void 0) usage("goto-unsupported", "pop: --goto is not supported; pop always moves to the active item's parent");
  if (!noggin.active) runtime("no-active-item", "pop: no active item");
  return verbDone(noggin, {
    force: opts.force === true,
    closeAll: opts.closeAll === true
  }, ctx);
}
async function verbEdit(noggin, opts = {}, ctx) {
  const hasState = typeof opts.done === "boolean";
  const rawTitle = opts.title;
  const hasTitle = typeof rawTitle === "string" && rawTitle.trim() !== "";
  if (!hasState && !hasTitle) {
    usage("nothing-to-edit", "edit: nothing to edit; pass at least one of --done, --open, --title");
  }
  const closing = hasState && opts.done === true;
  if (!closing && opts.force === true) {
    usage("option-misused", "edit: --force only applies when closing (with --done)");
  }
  if (!closing && opts.closeAll === true) {
    usage("option-misused", "edit: --close-all only applies when closing (with --done)");
  }
  let target;
  if (opts.path) target = noggin.resolvePath(opts.path);
  else {
    target = noggin.active;
    if (!target) runtime("no-active-item", "edit: no active item; pass a path");
  }
  const ops = [];
  if (hasState) {
    if (opts.done) {
      ops.push(...buildCloseOps(noggin, target, opts, "edit", ctx));
    } else if (target.done) {
      ops.push({ type: "set", key: target.key, patch: { done: false } });
    }
  }
  if (hasTitle) {
    const next = rawTitle.toString().trim();
    if (target.title !== next) {
      ops.push({ type: "set", key: target.key, patch: { title: next } });
    }
  }
  let viewTargetKey = target.key;
  if (opts.goto !== void 0) {
    const projected = projectOps(noggin, ops);
    const projectedTarget = findByKey(projected.items, target.key);
    const gotoTarget = executeGotoOption(projected, projectedTarget, opts.goto, "edit");
    ops.push({ type: "setActive", key: gotoTarget.key });
    viewTargetKey = gotoTarget.key;
  }
  if (ops.length > 0) await noggin.apply(ops);
  return buildView(nogginSnapshot(noggin), noggin.findByKey(viewTargetKey), {});
}
async function verbShow(noggin, opts = {}) {
  const target = opts.path ? noggin.resolvePath(opts.path) : noggin.active;
  if (!target) return null;
  let viewTargetKey = target.key;
  if (opts.goto !== void 0) {
    const gotoTarget = executeGotoOption(nogginSnapshot(noggin), target, opts.goto, "show");
    if (gotoTarget.key !== (noggin.active ? noggin.active.key : null)) {
      await noggin.apply([{ type: "setActive", key: gotoTarget.key }]);
    }
    viewTargetKey = gotoTarget.key;
  }
  return buildView(nogginSnapshot(noggin), noggin.findByKey(viewTargetKey), {
    includeChildren: opts.includeChildren !== false,
    withSiblings: opts.withSiblings === true,
    withDescendants: opts.withDescendants === true
  });
}
async function verbNote(noggin, opts = {}, ctx) {
  const text = (opts.text || "").toString().trim();
  if (!text) usage("text-required", "note: text required");
  let target;
  if (opts.path) target = noggin.resolvePath(opts.path);
  else {
    target = noggin.active;
    if (!target) runtime("no-active-item", "note: no active item and no path given");
  }
  const ops = [{
    type: "note",
    key: target.key,
    note: { timestamp: nowIso(ctx), text }
  }];
  let viewTargetKey = target.key;
  if (opts.goto !== void 0) {
    const projected = projectOps(noggin, ops);
    const projectedTarget = findByKey(projected.items, target.key);
    const gotoTarget = executeGotoOption(projected, projectedTarget, opts.goto, "note");
    ops.push({ type: "setActive", key: gotoTarget.key });
    viewTargetKey = gotoTarget.key;
  }
  await noggin.apply(ops);
  return buildView(nogginSnapshot(noggin), noggin.findByKey(viewTargetKey), {});
}
async function verbDelete(noggin, opts = {}) {
  if (opts.goto !== void 0) usage("goto-unsupported", "delete: --goto is not supported");
  if (!opts.path) usage("path-required", "delete: path required");
  const target = noggin.resolvePath(opts.path);
  const targetKey = target.key;
  const targetPath = noggin.pathOf(target);
  const targetTitle = target.title;
  const descendants = collectDescendants(noggin.items, target);
  if (descendants.length > 0 && opts.recursive !== true) {
    runtime(
      "has-descendants",
      `delete: ${targetPath} has ${descendants.length} descendant(s); pass --recursive to delete the whole subtree`
    );
  }
  const removeKeys = [target.key, ...descendants.map((d) => d.key)];
  const ops = [{ type: "remove", keys: removeKeys }];
  const activeWasRemoved = noggin.active != null && removeKeys.includes(noggin.active.key);
  if (activeWasRemoved) {
    ops.push({ type: "setActive", key: target.parentKey ?? null });
  }
  await noggin.apply(ops);
  const newActive = noggin.active;
  return {
    deleted: { key: targetKey, path: targetPath, title: targetTitle },
    descendantCount: descendants.length,
    view: newActive ? buildView(nogginSnapshot(noggin), newActive, {}) : null
  };
}
async function verbCopy(source, dest, opts = {}, ctx) {
  if (!source || typeof source.apply !== "function") usage("source-required", "copy: source noggin required");
  if (!dest || typeof dest.apply !== "function") usage("dest-required", "copy: dest noggin required");
  const srcItems = source.items.map((it) => ({
    key: it.key,
    parentKey: it.parentKey ?? null,
    title: it.title,
    done: Boolean(it.done),
    createdAt: it.createdAt,
    notes: (it.notes || []).map((n) => ({ timestamp: n.timestamp, text: n.text }))
  }));
  if (srcItems.length === 0) {
    return { copied: 0, mapping: {} };
  }
  const childrenByParent = /* @__PURE__ */ new Map();
  for (const it of srcItems) {
    const parent = it.parentKey ?? null;
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(it);
  }
  const ordered = [];
  function walk(parentKey) {
    const kids = childrenByParent.get(parentKey) || [];
    for (const kid of kids) {
      ordered.push(kid);
      walk(kid.key);
    }
  }
  walk(null);
  const mapping = /* @__PURE__ */ Object.create(null);
  for (const it of ordered) mapping[it.key] = newKey();
  const ops = ordered.map((it) => {
    const newParentKey = it.parentKey ? mapping[it.parentKey] : null;
    return {
      type: "add",
      item: {
        key: mapping[it.key],
        parentKey: newParentKey,
        title: it.title,
        done: it.done,
        createdAt: it.createdAt,
        notes: it.notes
      },
      parentKey: newParentKey,
      position: "end"
    };
  });
  await dest.apply(ops);
  return { copied: ordered.length, mapping };
}
function buildCloseOps(noggin, target, opts, verb, ctx) {
  const force = opts.force === true;
  const closeAll = opts.closeAll === true;
  const ops = [];
  const ts = nowIso(ctx);
  if (closeAll) {
    for (const d of collectDescendants(noggin.items, target)) {
      if (!d.done) {
        ops.push({ type: "set", key: d.key, patch: { done: true } });
        ops.push({ type: "note", key: d.key, note: { timestamp: ts, text: CLOSE_NOTE_TEXT } });
      }
    }
  }
  if (!force && !closeAll) {
    const open = countOpenDescendants(noggin.items, target);
    if (open > 0) {
      runtime(
        "open-descendants",
        `${verb}: ${noggin.pathOf(target)} has ${open} open descendant(s); pass --closeall to close them too, or --force to close ${target.title} anyway`
      );
    }
  }
  if (!target.done) {
    ops.push({ type: "set", key: target.key, patch: { done: true } });
    ops.push({ type: "note", key: target.key, note: { timestamp: ts, text: CLOSE_NOTE_TEXT } });
  }
  return ops;
}
function createRegistry() {
  const byScheme = /* @__PURE__ */ new Map();
  let defaultScheme = null;
  return {
    register(factory, opts = {}) {
      if (!factory || typeof factory.scheme !== "string" || !factory.scheme) {
        throw new TypeError("factories.register: factory.scheme (non-empty string) required");
      }
      if (typeof factory.open !== "function") {
        throw new TypeError("factories.register: factory.open function required");
      }
      byScheme.set(factory.scheme, factory);
      if (opts.default) defaultScheme = factory.scheme;
    },
    unregister(scheme) {
      const had = byScheme.delete(scheme);
      if (defaultScheme === scheme) defaultScheme = null;
      return had;
    },
    get(scheme) {
      return byScheme.get(scheme) || null;
    },
    getDefault() {
      return defaultScheme ? byScheme.get(defaultScheme) || null : null;
    },
    list() {
      return Array.from(byScheme.values()).map((f) => ({
        scheme: f.scheme,
        default: f.scheme === defaultScheme
      }));
    }
  };
}
function parseLocation(s) {
  const m = String(s == null ? "" : s).match(/^([a-z][a-z0-9+.-]*):\/\/(.*)$/i);
  return m ? { scheme: m[1].toLowerCase(), rest: m[2] } : { scheme: null, rest: String(s == null ? "" : s) };
}
async function openNoggin(location, opts) {
  if (!location) {
    throw new NogginError("openNoggin: location required", { code: "no-location", exitCode: 2 });
  }
  const { scheme, rest } = parseLocation(location);
  const factory = scheme ? factories.get(scheme) : factories.getDefault();
  if (!factory) {
    if (scheme) usage("no-factory", `no factory registered for scheme '${scheme}://'`);
    usage("no-factory", `no default factory registered; cannot open '${location}'`);
  }
  return factory.open(rest, { ...opts, location });
}
function documentsEqual(a, b) {
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
function freezeDocument(doc) {
  for (const item of doc.items) {
    for (const note of item.notes || []) Object.freeze(note);
    Object.freeze(item.notes);
    Object.freeze(item);
  }
  Object.freeze(doc.items);
  Object.freeze(doc);
  return doc;
}
function diffDocuments(prev, next) {
  const changes = [];
  const prevItems = prev && prev.items || [];
  const nextItems = next && next.items || [];
  const prevByKey = new Map(prevItems.map((it) => [it.key, it]));
  const nextByKey = new Map(nextItems.map((it) => [it.key, it]));
  function positionIn(items, item) {
    let pos = 0;
    for (const it of items) {
      if ((it.parentKey ?? null) !== (item.parentKey ?? null)) continue;
      if (it.key === item.key) return pos;
      pos++;
    }
    return -1;
  }
  for (const [key] of prevByKey) {
    if (!nextByKey.has(key)) changes.push({ kind: "removed", key });
  }
  for (const [key, nextItem] of nextByKey) {
    const prevItem = prevByKey.get(key);
    if (!prevItem) {
      changes.push({
        kind: "added",
        key,
        parentKey: nextItem.parentKey ?? null,
        position: positionIn(nextItems, nextItem)
      });
      continue;
    }
    const prevParent = prevItem.parentKey ?? null;
    const nextParent = nextItem.parentKey ?? null;
    const prevPos = positionIn(prevItems, prevItem);
    const nextPos = positionIn(nextItems, nextItem);
    if (prevParent !== nextParent || prevPos !== nextPos) {
      changes.push({
        kind: "moved",
        key,
        from: { parentKey: prevParent, position: prevPos },
        to: { parentKey: nextParent, position: nextPos }
      });
    }
    const fields = [];
    if (prevItem.title !== nextItem.title) fields.push("title");
    if (Boolean(prevItem.done) !== Boolean(nextItem.done)) fields.push("done");
    if (!notesEqual(prevItem.notes, nextItem.notes)) fields.push("notes");
    if (fields.length) changes.push({ kind: "updated", key, fields });
  }
  const prevActive = prev && prev.active || null;
  const nextActive = next && next.active || null;
  if (prevActive !== nextActive) {
    changes.push({ kind: "activeChanged", from: prevActive, to: nextActive });
  }
  return changes;
}
function notesEqual(a, b) {
  const an = a || [];
  const bn = b || [];
  if (an.length !== bn.length) return false;
  for (let i = 0; i < an.length; i++) {
    if (an[i].timestamp !== bn[i].timestamp) return false;
    if (an[i].text !== bn[i].text) return false;
  }
  return true;
}
var SCHEMA_VERSION, RESPONSE_ENVELOPE_VERSION, JSON_SCHEMA_VERSION, CLOSE_NOTE_TEXT, NogginError, PRUNABLE_DEFAULTS, verbs, factories;
var init_noggin_api = __esm({
  "engine/noggin-api.mjs"() {
    SCHEMA_VERSION = 1;
    RESPONSE_ENVELOPE_VERSION = 3;
    JSON_SCHEMA_VERSION = RESPONSE_ENVELOPE_VERSION;
    CLOSE_NOTE_TEXT = "closed";
    NogginError = class extends Error {
      /**
       * @param {string} message
       * @param {{ code?: string, exitCode?: number }} [opts]
       */
      constructor(message, opts = {}) {
        super(message);
        this.name = "NogginError";
        this.code = opts.code || "noggin-error";
        this.exitCode = typeof opts.exitCode === "number" ? opts.exitCode : 2;
      }
    };
    PRUNABLE_DEFAULTS = {
      parentKey: (v) => v === null,
      done: (v) => v === false,
      notes: (v) => Array.isArray(v) && v.length === 0,
      activePath: (v) => v === null,
      activeKey: (v) => v === null,
      descendantCount: (v) => v === 0,
      exists: (v) => v === false,
      env: (v) => v === null,
      view: (v) => v === null
    };
    verbs = {
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
      copy: verbCopy
    };
    factories = createRegistry();
  }
});

// engine/node_modules/js-yaml/dist/js-yaml.mjs
var __create, __defProp2, __getOwnPropDesc, __getOwnPropNames2, __getProtoOf, __hasOwnProp, __commonJSMin, __copyProps, __toESM, require_common, require_exception, require_snippet, require_type, require_schema, require_str, require_seq, require_map, require_failsafe, require_null, require_bool, require_int, require_float, require_json, require_core, require_timestamp, require_merge, require_binary, require_omap, require_pairs, require_set, require_default, require_loader, require_dumper, import_js_yaml, Type, Schema, FAILSAFE_SCHEMA, JSON_SCHEMA, CORE_SCHEMA, DEFAULT_SCHEMA, load, loadAll, dump, YAMLException, types, safeLoad, safeLoadAll, safeDump, index_vite_proxy_tmp_default;
var init_js_yaml = __esm({
  "engine/node_modules/js-yaml/dist/js-yaml.mjs"() {
    __create = Object.create;
    __defProp2 = Object.defineProperty;
    __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    __getOwnPropNames2 = Object.getOwnPropertyNames;
    __getProtoOf = Object.getPrototypeOf;
    __hasOwnProp = Object.prototype.hasOwnProperty;
    __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
    __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames2(from), i = 0, n = keys.length, key; i < n; i++) {
        key = keys[i];
        if (!__hasOwnProp.call(to, key) && key !== except) __defProp2(to, key, {
          get: ((k) => from[k]).bind(null, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
      }
      return to;
    };
    __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp2(target, "default", {
      value: mod,
      enumerable: true
    }) : target, mod));
    require_common = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      function isNothing(subject) {
        return typeof subject === "undefined" || subject === null;
      }
      function isObject(subject) {
        return typeof subject === "object" && subject !== null;
      }
      function toArray(sequence) {
        if (Array.isArray(sequence)) return sequence;
        else if (isNothing(sequence)) return [];
        return [sequence];
      }
      function extend(target, source) {
        if (source) {
          const sourceKeys = Object.keys(source);
          for (let index = 0, length = sourceKeys.length; index < length; index += 1) {
            const key = sourceKeys[index];
            target[key] = source[key];
          }
        }
        return target;
      }
      function repeat(string, count) {
        let result = "";
        for (let cycle = 0; cycle < count; cycle += 1) result += string;
        return result;
      }
      function isNegativeZero(number) {
        return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
      }
      module.exports.isNothing = isNothing;
      module.exports.isObject = isObject;
      module.exports.toArray = toArray;
      module.exports.repeat = repeat;
      module.exports.isNegativeZero = isNegativeZero;
      module.exports.extend = extend;
    }));
    require_exception = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      function formatError2(exception, compact) {
        let where = "";
        const message = exception.reason || "(unknown reason)";
        if (!exception.mark) return message;
        if (exception.mark.name) where += 'in "' + exception.mark.name + '" ';
        where += "(" + (exception.mark.line + 1) + ":" + (exception.mark.column + 1) + ")";
        if (!compact && exception.mark.snippet) where += "\n\n" + exception.mark.snippet;
        return message + " " + where;
      }
      function YAMLException2(reason, mark) {
        Error.call(this);
        this.name = "YAMLException";
        this.reason = reason;
        this.mark = mark;
        this.message = formatError2(this, false);
        if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
        else this.stack = (/* @__PURE__ */ new Error()).stack || "";
      }
      YAMLException2.prototype = Object.create(Error.prototype);
      YAMLException2.prototype.constructor = YAMLException2;
      YAMLException2.prototype.toString = function toString(compact) {
        return this.name + ": " + formatError2(this, compact);
      };
      module.exports = YAMLException2;
    }));
    require_snippet = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      var common = require_common();
      function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
        let head = "";
        let tail = "";
        const maxHalfLength = Math.floor(maxLineLength / 2) - 1;
        if (position - lineStart > maxHalfLength) {
          head = " ... ";
          lineStart = position - maxHalfLength + head.length;
        }
        if (lineEnd - position > maxHalfLength) {
          tail = " ...";
          lineEnd = position + maxHalfLength - tail.length;
        }
        return {
          str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "\u2192") + tail,
          pos: position - lineStart + head.length
        };
      }
      function padStart(string, max) {
        return common.repeat(" ", max - string.length) + string;
      }
      function makeSnippet(mark, options) {
        options = Object.create(options || null);
        if (!mark.buffer) return null;
        if (!options.maxLength) options.maxLength = 79;
        if (typeof options.indent !== "number") options.indent = 1;
        if (typeof options.linesBefore !== "number") options.linesBefore = 3;
        if (typeof options.linesAfter !== "number") options.linesAfter = 2;
        const re = /\r?\n|\r|\0/g;
        const lineStarts = [0];
        const lineEnds = [];
        let match;
        let foundLineNo = -1;
        while (match = re.exec(mark.buffer)) {
          lineEnds.push(match.index);
          lineStarts.push(match.index + match[0].length);
          if (mark.position <= match.index && foundLineNo < 0) foundLineNo = lineStarts.length - 2;
        }
        if (foundLineNo < 0) foundLineNo = lineStarts.length - 1;
        let result = "";
        const lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
        const maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
        for (let i = 1; i <= options.linesBefore; i++) {
          if (foundLineNo - i < 0) break;
          const line2 = getLine(mark.buffer, lineStarts[foundLineNo - i], lineEnds[foundLineNo - i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]), maxLineLength);
          result = common.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line2.str + "\n" + result;
        }
        const line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
        result += common.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + "\n";
        result += common.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^\n";
        for (let i = 1; i <= options.linesAfter; i++) {
          if (foundLineNo + i >= lineEnds.length) break;
          const line2 = getLine(mark.buffer, lineStarts[foundLineNo + i], lineEnds[foundLineNo + i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]), maxLineLength);
          result += common.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line2.str + "\n";
        }
        return result.replace(/\n$/, "");
      }
      module.exports = makeSnippet;
    }));
    require_type = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      var YAMLException2 = require_exception();
      var TYPE_CONSTRUCTOR_OPTIONS = [
        "kind",
        "multi",
        "resolve",
        "construct",
        "instanceOf",
        "predicate",
        "represent",
        "representName",
        "defaultStyle",
        "styleAliases"
      ];
      var YAML_NODE_KINDS = [
        "scalar",
        "sequence",
        "mapping"
      ];
      function compileStyleAliases(map) {
        const result = {};
        if (map !== null) Object.keys(map).forEach(function(style) {
          map[style].forEach(function(alias) {
            result[String(alias)] = style;
          });
        });
        return result;
      }
      function Type2(tag, options) {
        options = options || {};
        Object.keys(options).forEach(function(name) {
          if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) throw new YAMLException2('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
        });
        this.options = options;
        this.tag = tag;
        this.kind = options["kind"] || null;
        this.resolve = options["resolve"] || function() {
          return true;
        };
        this.construct = options["construct"] || function(data) {
          return data;
        };
        this.instanceOf = options["instanceOf"] || null;
        this.predicate = options["predicate"] || null;
        this.represent = options["represent"] || null;
        this.representName = options["representName"] || null;
        this.defaultStyle = options["defaultStyle"] || null;
        this.multi = options["multi"] || false;
        this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
        if (YAML_NODE_KINDS.indexOf(this.kind) === -1) throw new YAMLException2('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
      }
      module.exports = Type2;
    }));
    require_schema = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      var YAMLException2 = require_exception();
      var Type2 = require_type();
      function compileList(schema, name) {
        const result = [];
        schema[name].forEach(function(currentType) {
          let newIndex = result.length;
          result.forEach(function(previousType, previousIndex) {
            if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) newIndex = previousIndex;
          });
          result[newIndex] = currentType;
        });
        return result;
      }
      function compileMap() {
        const result = {
          scalar: {},
          sequence: {},
          mapping: {},
          fallback: {},
          multi: {
            scalar: [],
            sequence: [],
            mapping: [],
            fallback: []
          }
        };
        function collectType(type) {
          if (type.multi) {
            result.multi[type.kind].push(type);
            result.multi["fallback"].push(type);
          } else result[type.kind][type.tag] = result["fallback"][type.tag] = type;
        }
        for (let index = 0, length = arguments.length; index < length; index += 1) arguments[index].forEach(collectType);
        return result;
      }
      function Schema2(definition) {
        return this.extend(definition);
      }
      Schema2.prototype.extend = function extend(definition) {
        let implicit = [];
        let explicit = [];
        if (definition instanceof Type2) explicit.push(definition);
        else if (Array.isArray(definition)) explicit = explicit.concat(definition);
        else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
          if (definition.implicit) implicit = implicit.concat(definition.implicit);
          if (definition.explicit) explicit = explicit.concat(definition.explicit);
        } else throw new YAMLException2("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
        implicit.forEach(function(type) {
          if (!(type instanceof Type2)) throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
          if (type.loadKind && type.loadKind !== "scalar") throw new YAMLException2("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
          if (type.multi) throw new YAMLException2("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
        });
        explicit.forEach(function(type) {
          if (!(type instanceof Type2)) throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
        });
        const result = Object.create(Schema2.prototype);
        result.implicit = (this.implicit || []).concat(implicit);
        result.explicit = (this.explicit || []).concat(explicit);
        result.compiledImplicit = compileList(result, "implicit");
        result.compiledExplicit = compileList(result, "explicit");
        result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
        return result;
      };
      module.exports = Schema2;
    }));
    require_str = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      module.exports = new (require_type())("tag:yaml.org,2002:str", {
        kind: "scalar",
        construct: function(data) {
          return data !== null ? data : "";
        }
      });
    }));
    require_seq = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      module.exports = new (require_type())("tag:yaml.org,2002:seq", {
        kind: "sequence",
        construct: function(data) {
          return data !== null ? data : [];
        }
      });
    }));
    require_map = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      module.exports = new (require_type())("tag:yaml.org,2002:map", {
        kind: "mapping",
        construct: function(data) {
          return data !== null ? data : {};
        }
      });
    }));
    require_failsafe = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      module.exports = new (require_schema())({ explicit: [
        require_str(),
        require_seq(),
        require_map()
      ] });
    }));
    require_null = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      var Type2 = require_type();
      function resolveYamlNull(data) {
        if (data === null) return true;
        const max = data.length;
        return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
      }
      function constructYamlNull() {
        return null;
      }
      function isNull(object) {
        return object === null;
      }
      module.exports = new Type2("tag:yaml.org,2002:null", {
        kind: "scalar",
        resolve: resolveYamlNull,
        construct: constructYamlNull,
        predicate: isNull,
        represent: {
          canonical: function() {
            return "~";
          },
          lowercase: function() {
            return "null";
          },
          uppercase: function() {
            return "NULL";
          },
          camelcase: function() {
            return "Null";
          },
          empty: function() {
            return "";
          }
        },
        defaultStyle: "lowercase"
      });
    }));
    require_bool = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      var Type2 = require_type();
      function resolveYamlBoolean(data) {
        if (data === null) return false;
        const max = data.length;
        return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
      }
      function constructYamlBoolean(data) {
        return data === "true" || data === "True" || data === "TRUE";
      }
      function isBoolean(object) {
        return Object.prototype.toString.call(object) === "[object Boolean]";
      }
      module.exports = new Type2("tag:yaml.org,2002:bool", {
        kind: "scalar",
        resolve: resolveYamlBoolean,
        construct: constructYamlBoolean,
        predicate: isBoolean,
        represent: {
          lowercase: function(object) {
            return object ? "true" : "false";
          },
          uppercase: function(object) {
            return object ? "TRUE" : "FALSE";
          },
          camelcase: function(object) {
            return object ? "True" : "False";
          }
        },
        defaultStyle: "lowercase"
      });
    }));
    require_int = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      var common = require_common();
      var Type2 = require_type();
      function isHexCode(c) {
        return c >= 48 && c <= 57 || c >= 65 && c <= 70 || c >= 97 && c <= 102;
      }
      function isOctCode(c) {
        return c >= 48 && c <= 55;
      }
      function isDecCode(c) {
        return c >= 48 && c <= 57;
      }
      function resolveYamlInteger(data) {
        if (data === null) return false;
        const max = data.length;
        let index = 0;
        let hasDigits = false;
        if (!max) return false;
        let ch = data[index];
        if (ch === "-" || ch === "+") ch = data[++index];
        if (ch === "0") {
          if (index + 1 === max) return true;
          ch = data[++index];
          if (ch === "b") {
            index++;
            for (; index < max; index++) {
              ch = data[index];
              if (ch !== "0" && ch !== "1") return false;
              hasDigits = true;
            }
            return hasDigits && Number.isFinite(parseYamlInteger(data));
          }
          if (ch === "x") {
            index++;
            for (; index < max; index++) {
              if (!isHexCode(data.charCodeAt(index))) return false;
              hasDigits = true;
            }
            return hasDigits && Number.isFinite(parseYamlInteger(data));
          }
          if (ch === "o") {
            index++;
            for (; index < max; index++) {
              if (!isOctCode(data.charCodeAt(index))) return false;
              hasDigits = true;
            }
            return hasDigits && Number.isFinite(parseYamlInteger(data));
          }
        }
        for (; index < max; index++) {
          if (!isDecCode(data.charCodeAt(index))) return false;
          hasDigits = true;
        }
        if (!hasDigits) return false;
        return Number.isFinite(parseYamlInteger(data));
      }
      function parseYamlInteger(data) {
        let value = data;
        let sign = 1;
        let ch = value[0];
        if (ch === "-" || ch === "+") {
          if (ch === "-") sign = -1;
          value = value.slice(1);
          ch = value[0];
        }
        if (value === "0") return 0;
        if (ch === "0") {
          if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
          if (value[1] === "x") return sign * parseInt(value.slice(2), 16);
          if (value[1] === "o") return sign * parseInt(value.slice(2), 8);
        }
        return sign * parseInt(value, 10);
      }
      function constructYamlInteger(data) {
        return parseYamlInteger(data);
      }
      function isInteger(object) {
        return Object.prototype.toString.call(object) === "[object Number]" && object % 1 === 0 && !common.isNegativeZero(object);
      }
      module.exports = new Type2("tag:yaml.org,2002:int", {
        kind: "scalar",
        resolve: resolveYamlInteger,
        construct: constructYamlInteger,
        predicate: isInteger,
        represent: {
          binary: function(obj) {
            return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
          },
          octal: function(obj) {
            return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
          },
          decimal: function(obj) {
            return obj.toString(10);
          },
          hexadecimal: function(obj) {
            return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
          }
        },
        defaultStyle: "decimal",
        styleAliases: {
          binary: [2, "bin"],
          octal: [8, "oct"],
          decimal: [10, "dec"],
          hexadecimal: [16, "hex"]
        }
      });
    }));
    require_float = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      var common = require_common();
      var Type2 = require_type();
      var YAML_FLOAT_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?(?:[0-9]+)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
      var YAML_FLOAT_SPECIAL_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
      function resolveYamlFloat(data) {
        if (data === null) return false;
        if (!YAML_FLOAT_PATTERN.test(data)) return false;
        if (Number.isFinite(parseFloat(data, 10))) return true;
        return YAML_FLOAT_SPECIAL_PATTERN.test(data);
      }
      function constructYamlFloat(data) {
        let value = data.toLowerCase();
        const sign = value[0] === "-" ? -1 : 1;
        if ("+-".indexOf(value[0]) >= 0) value = value.slice(1);
        if (value === ".inf") return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
        else if (value === ".nan") return NaN;
        return sign * parseFloat(value, 10);
      }
      var SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
      function representYamlFloat(object, style) {
        if (isNaN(object)) switch (style) {
          case "lowercase":
            return ".nan";
          case "uppercase":
            return ".NAN";
          case "camelcase":
            return ".NaN";
        }
        else if (Number.POSITIVE_INFINITY === object) switch (style) {
          case "lowercase":
            return ".inf";
          case "uppercase":
            return ".INF";
          case "camelcase":
            return ".Inf";
        }
        else if (Number.NEGATIVE_INFINITY === object) switch (style) {
          case "lowercase":
            return "-.inf";
          case "uppercase":
            return "-.INF";
          case "camelcase":
            return "-.Inf";
        }
        else if (common.isNegativeZero(object)) return "-0.0";
        const res = object.toString(10);
        return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
      }
      function isFloat(object) {
        return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common.isNegativeZero(object));
      }
      module.exports = new Type2("tag:yaml.org,2002:float", {
        kind: "scalar",
        resolve: resolveYamlFloat,
        construct: constructYamlFloat,
        predicate: isFloat,
        represent: representYamlFloat,
        defaultStyle: "lowercase"
      });
    }));
    require_json = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      module.exports = require_failsafe().extend({ implicit: [
        require_null(),
        require_bool(),
        require_int(),
        require_float()
      ] });
    }));
    require_core = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      module.exports = require_json();
    }));
    require_timestamp = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      var Type2 = require_type();
      var YAML_DATE_REGEXP = /* @__PURE__ */ new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$");
      var YAML_TIMESTAMP_REGEXP = /* @__PURE__ */ new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$");
      function resolveYamlTimestamp(data) {
        if (data === null) return false;
        if (YAML_DATE_REGEXP.exec(data) !== null) return true;
        if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
        return false;
      }
      function constructYamlTimestamp(data) {
        let fraction = 0;
        let delta = null;
        let match = YAML_DATE_REGEXP.exec(data);
        if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
        if (match === null) throw new Error("Date resolve error");
        const year = +match[1];
        const month = +match[2] - 1;
        const day = +match[3];
        if (!match[4]) return new Date(Date.UTC(year, month, day));
        const hour = +match[4];
        const minute = +match[5];
        const second = +match[6];
        if (match[7]) {
          fraction = match[7].slice(0, 3);
          while (fraction.length < 3) fraction += "0";
          fraction = +fraction;
        }
        if (match[9]) {
          const tzHour = +match[10];
          const tzMinute = +(match[11] || 0);
          delta = (tzHour * 60 + tzMinute) * 6e4;
          if (match[9] === "-") delta = -delta;
        }
        const date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
        if (delta) date.setTime(date.getTime() - delta);
        return date;
      }
      function representYamlTimestamp(object) {
        return object.toISOString();
      }
      module.exports = new Type2("tag:yaml.org,2002:timestamp", {
        kind: "scalar",
        resolve: resolveYamlTimestamp,
        construct: constructYamlTimestamp,
        instanceOf: Date,
        represent: representYamlTimestamp
      });
    }));
    require_merge = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      var Type2 = require_type();
      function resolveYamlMerge(data) {
        return data === "<<" || data === null;
      }
      module.exports = new Type2("tag:yaml.org,2002:merge", {
        kind: "scalar",
        resolve: resolveYamlMerge
      });
    }));
    require_binary = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      var Type2 = require_type();
      var BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
      function resolveYamlBinary(data) {
        if (data === null) return false;
        let bitlen = 0;
        const max = data.length;
        const map = BASE64_MAP;
        for (let idx = 0; idx < max; idx++) {
          const code = map.indexOf(data.charAt(idx));
          if (code > 64) continue;
          if (code < 0) return false;
          bitlen += 6;
        }
        return bitlen % 8 === 0;
      }
      function constructYamlBinary(data) {
        const input = data.replace(/[\r\n=]/g, "");
        const max = input.length;
        const map = BASE64_MAP;
        let bits = 0;
        const result = [];
        for (let idx = 0; idx < max; idx++) {
          if (idx % 4 === 0 && idx) {
            result.push(bits >> 16 & 255);
            result.push(bits >> 8 & 255);
            result.push(bits & 255);
          }
          bits = bits << 6 | map.indexOf(input.charAt(idx));
        }
        const tailbits = max % 4 * 6;
        if (tailbits === 0) {
          result.push(bits >> 16 & 255);
          result.push(bits >> 8 & 255);
          result.push(bits & 255);
        } else if (tailbits === 18) {
          result.push(bits >> 10 & 255);
          result.push(bits >> 2 & 255);
        } else if (tailbits === 12) result.push(bits >> 4 & 255);
        return new Uint8Array(result);
      }
      function representYamlBinary(object) {
        let result = "";
        let bits = 0;
        const max = object.length;
        const map = BASE64_MAP;
        for (let idx = 0; idx < max; idx++) {
          if (idx % 3 === 0 && idx) {
            result += map[bits >> 18 & 63];
            result += map[bits >> 12 & 63];
            result += map[bits >> 6 & 63];
            result += map[bits & 63];
          }
          bits = (bits << 8) + object[idx];
        }
        const tail = max % 3;
        if (tail === 0) {
          result += map[bits >> 18 & 63];
          result += map[bits >> 12 & 63];
          result += map[bits >> 6 & 63];
          result += map[bits & 63];
        } else if (tail === 2) {
          result += map[bits >> 10 & 63];
          result += map[bits >> 4 & 63];
          result += map[bits << 2 & 63];
          result += map[64];
        } else if (tail === 1) {
          result += map[bits >> 2 & 63];
          result += map[bits << 4 & 63];
          result += map[64];
          result += map[64];
        }
        return result;
      }
      function isBinary(obj) {
        return Object.prototype.toString.call(obj) === "[object Uint8Array]";
      }
      module.exports = new Type2("tag:yaml.org,2002:binary", {
        kind: "scalar",
        resolve: resolveYamlBinary,
        construct: constructYamlBinary,
        predicate: isBinary,
        represent: representYamlBinary
      });
    }));
    require_omap = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      var Type2 = require_type();
      var _hasOwnProperty = Object.prototype.hasOwnProperty;
      var _toString = Object.prototype.toString;
      function resolveYamlOmap(data) {
        if (data === null) return true;
        const objectKeys = [];
        const object = data;
        for (let index = 0, length = object.length; index < length; index += 1) {
          const pair = object[index];
          let pairHasKey = false;
          if (_toString.call(pair) !== "[object Object]") return false;
          let pairKey;
          for (pairKey in pair) if (_hasOwnProperty.call(pair, pairKey)) if (!pairHasKey) pairHasKey = true;
          else return false;
          if (!pairHasKey) return false;
          if (objectKeys.indexOf(pairKey) === -1) objectKeys.push(pairKey);
          else return false;
        }
        return true;
      }
      function constructYamlOmap(data) {
        return data !== null ? data : [];
      }
      module.exports = new Type2("tag:yaml.org,2002:omap", {
        kind: "sequence",
        resolve: resolveYamlOmap,
        construct: constructYamlOmap
      });
    }));
    require_pairs = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      var Type2 = require_type();
      var _toString = Object.prototype.toString;
      function resolveYamlPairs(data) {
        if (data === null) return true;
        const object = data;
        const result = new Array(object.length);
        for (let index = 0, length = object.length; index < length; index += 1) {
          const pair = object[index];
          if (_toString.call(pair) !== "[object Object]") return false;
          const keys = Object.keys(pair);
          if (keys.length !== 1) return false;
          result[index] = [keys[0], pair[keys[0]]];
        }
        return true;
      }
      function constructYamlPairs(data) {
        if (data === null) return [];
        const object = data;
        const result = new Array(object.length);
        for (let index = 0, length = object.length; index < length; index += 1) {
          const pair = object[index];
          const keys = Object.keys(pair);
          result[index] = [keys[0], pair[keys[0]]];
        }
        return result;
      }
      module.exports = new Type2("tag:yaml.org,2002:pairs", {
        kind: "sequence",
        resolve: resolveYamlPairs,
        construct: constructYamlPairs
      });
    }));
    require_set = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      var Type2 = require_type();
      var _hasOwnProperty = Object.prototype.hasOwnProperty;
      function resolveYamlSet(data) {
        if (data === null) return true;
        const object = data;
        for (const key in object) if (_hasOwnProperty.call(object, key)) {
          if (object[key] !== null) return false;
        }
        return true;
      }
      function constructYamlSet(data) {
        return data !== null ? data : {};
      }
      module.exports = new Type2("tag:yaml.org,2002:set", {
        kind: "mapping",
        resolve: resolveYamlSet,
        construct: constructYamlSet
      });
    }));
    require_default = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      module.exports = require_core().extend({
        implicit: [require_timestamp(), require_merge()],
        explicit: [
          require_binary(),
          require_omap(),
          require_pairs(),
          require_set()
        ]
      });
    }));
    require_loader = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      var common = require_common();
      var YAMLException2 = require_exception();
      var makeSnippet = require_snippet();
      var DEFAULT_SCHEMA2 = require_default();
      var _hasOwnProperty = Object.prototype.hasOwnProperty;
      var CONTEXT_FLOW_IN = 1;
      var CONTEXT_FLOW_OUT = 2;
      var CONTEXT_BLOCK_IN = 3;
      var CONTEXT_BLOCK_OUT = 4;
      var CHOMPING_CLIP = 1;
      var CHOMPING_STRIP = 2;
      var CHOMPING_KEEP = 3;
      var PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
      var PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
      var PATTERN_FLOW_INDICATORS = /[,\[\]{}]/;
      var PATTERN_TAG_HANDLE = /^(?:!|!!|![0-9A-Za-z-]+!)$/;
      var PATTERN_TAG_URI = /^(?:!|[^,\[\]{}])(?:%[0-9a-f]{2}|[0-9a-z\-#;/?:@&=+$,_.!~*'()\[\]])*$/i;
      function _class(obj) {
        return Object.prototype.toString.call(obj);
      }
      function isEol(c) {
        return c === 10 || c === 13;
      }
      function isWhiteSpace(c) {
        return c === 9 || c === 32;
      }
      function isWsOrEol(c) {
        return c === 9 || c === 32 || c === 10 || c === 13;
      }
      function isFlowIndicator(c) {
        return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
      }
      function fromHexCode(c) {
        if (c >= 48 && c <= 57) return c - 48;
        const lc = c | 32;
        if (lc >= 97 && lc <= 102) return lc - 97 + 10;
        return -1;
      }
      function escapedHexLen(c) {
        if (c === 120) return 2;
        if (c === 117) return 4;
        if (c === 85) return 8;
        return 0;
      }
      function fromDecimalCode(c) {
        if (c >= 48 && c <= 57) return c - 48;
        return -1;
      }
      function simpleEscapeSequence(c) {
        switch (c) {
          case 48:
            return "\0";
          case 97:
            return "\x07";
          case 98:
            return "\b";
          case 116:
            return "	";
          case 9:
            return "	";
          case 110:
            return "\n";
          case 118:
            return "\v";
          case 102:
            return "\f";
          case 114:
            return "\r";
          case 101:
            return "\x1B";
          case 32:
            return " ";
          case 34:
            return '"';
          case 47:
            return "/";
          case 92:
            return "\\";
          case 78:
            return "\x85";
          case 95:
            return "\xA0";
          case 76:
            return "\u2028";
          case 80:
            return "\u2029";
          default:
            return "";
        }
      }
      function charFromCodepoint(c) {
        if (c <= 65535) return String.fromCharCode(c);
        return String.fromCharCode((c - 65536 >> 10) + 55296, (c - 65536 & 1023) + 56320);
      }
      function setProperty(object, key, value) {
        if (key === "__proto__") Object.defineProperty(object, key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value
        });
        else object[key] = value;
      }
      var simpleEscapeCheck = new Array(256);
      var simpleEscapeMap = new Array(256);
      for (let i = 0; i < 256; i++) {
        simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
        simpleEscapeMap[i] = simpleEscapeSequence(i);
      }
      function State(input, options) {
        this.input = input;
        this.filename = options["filename"] || null;
        this.schema = options["schema"] || DEFAULT_SCHEMA2;
        this.onWarning = options["onWarning"] || null;
        this.legacy = options["legacy"] || false;
        this.json = options["json"] || false;
        this.listener = options["listener"] || null;
        this.maxDepth = typeof options["maxDepth"] === "number" ? options["maxDepth"] : 100;
        this.maxMergeSeqLength = typeof options["maxMergeSeqLength"] === "number" ? options["maxMergeSeqLength"] : 20;
        this.implicitTypes = this.schema.compiledImplicit;
        this.typeMap = this.schema.compiledTypeMap;
        this.length = input.length;
        this.position = 0;
        this.line = 0;
        this.lineStart = 0;
        this.lineIndent = 0;
        this.depth = 0;
        this.firstTabInLine = -1;
        this.documents = [];
        this.anchorMapTransactions = [];
      }
      function generateError(state, message) {
        const mark = {
          name: state.filename,
          buffer: state.input.slice(0, -1),
          position: state.position,
          line: state.line,
          column: state.position - state.lineStart
        };
        mark.snippet = makeSnippet(mark);
        return new YAMLException2(message, mark);
      }
      function throwError(state, message) {
        throw generateError(state, message);
      }
      function throwWarning(state, message) {
        if (state.onWarning) state.onWarning.call(null, generateError(state, message));
      }
      function storeAnchor(state, name, value) {
        const transactions = state.anchorMapTransactions;
        if (transactions.length !== 0) {
          const transaction = transactions[transactions.length - 1];
          if (!_hasOwnProperty.call(transaction, name)) transaction[name] = {
            existed: _hasOwnProperty.call(state.anchorMap, name),
            value: state.anchorMap[name]
          };
        }
        state.anchorMap[name] = value;
      }
      function beginAnchorTransaction(state) {
        state.anchorMapTransactions.push(/* @__PURE__ */ Object.create(null));
      }
      function commitAnchorTransaction(state) {
        const transaction = state.anchorMapTransactions.pop();
        const transactions = state.anchorMapTransactions;
        if (transactions.length === 0) return;
        const parent = transactions[transactions.length - 1];
        const names = Object.keys(transaction);
        for (let index = 0, length = names.length; index < length; index += 1) {
          const name = names[index];
          if (!_hasOwnProperty.call(parent, name)) parent[name] = transaction[name];
        }
      }
      function rollbackAnchorTransaction(state) {
        const transaction = state.anchorMapTransactions.pop();
        const names = Object.keys(transaction);
        for (let index = names.length - 1; index >= 0; index -= 1) {
          const entry = transaction[names[index]];
          if (entry.existed) state.anchorMap[names[index]] = entry.value;
          else delete state.anchorMap[names[index]];
        }
      }
      function snapshotState(state) {
        return {
          position: state.position,
          line: state.line,
          lineStart: state.lineStart,
          lineIndent: state.lineIndent,
          firstTabInLine: state.firstTabInLine,
          tag: state.tag,
          anchor: state.anchor,
          kind: state.kind,
          result: state.result
        };
      }
      function restoreState(state, snapshot) {
        state.position = snapshot.position;
        state.line = snapshot.line;
        state.lineStart = snapshot.lineStart;
        state.lineIndent = snapshot.lineIndent;
        state.firstTabInLine = snapshot.firstTabInLine;
        state.tag = snapshot.tag;
        state.anchor = snapshot.anchor;
        state.kind = snapshot.kind;
        state.result = snapshot.result;
      }
      var directiveHandlers = {
        YAML: function handleYamlDirective(state, name, args) {
          if (state.version !== null) throwError(state, "duplication of %YAML directive");
          if (args.length !== 1) throwError(state, "YAML directive accepts exactly one argument");
          const match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
          if (match === null) throwError(state, "ill-formed argument of the YAML directive");
          const major = parseInt(match[1], 10);
          const minor = parseInt(match[2], 10);
          if (major !== 1) throwError(state, "unacceptable YAML version of the document");
          state.version = args[0];
          state.checkLineBreaks = minor < 2;
          if (minor !== 1 && minor !== 2) throwWarning(state, "unsupported YAML version of the document");
        },
        TAG: function handleTagDirective(state, name, args) {
          let prefix;
          if (args.length !== 2) throwError(state, "TAG directive accepts exactly two arguments");
          const handle = args[0];
          prefix = args[1];
          if (!PATTERN_TAG_HANDLE.test(handle)) throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
          if (_hasOwnProperty.call(state.tagMap, handle)) throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
          if (!PATTERN_TAG_URI.test(prefix)) throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
          try {
            prefix = decodeURIComponent(prefix);
          } catch (err) {
            throwError(state, "tag prefix is malformed: " + prefix);
          }
          state.tagMap[handle] = prefix;
        }
      };
      function captureSegment(state, start, end, checkJson) {
        if (start < end) {
          const _result = state.input.slice(start, end);
          if (checkJson) for (let _position = 0, _length = _result.length; _position < _length; _position += 1) {
            const _character = _result.charCodeAt(_position);
            if (!(_character === 9 || _character >= 32 && _character <= 1114111)) throwError(state, "expected valid JSON character");
          }
          else if (PATTERN_NON_PRINTABLE.test(_result)) throwError(state, "the stream contains non-printable characters");
          state.result += _result;
        }
      }
      function mergeMappings(state, destination, source, overridableKeys) {
        if (!common.isObject(source)) throwError(state, "cannot merge mappings; the provided source object is unacceptable");
        const sourceKeys = Object.keys(source);
        for (let index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
          const key = sourceKeys[index];
          if (!_hasOwnProperty.call(destination, key)) {
            setProperty(destination, key, source[key]);
            overridableKeys[key] = true;
          }
        }
      }
      function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
        if (Array.isArray(keyNode)) {
          keyNode = Array.prototype.slice.call(keyNode);
          for (let index = 0, quantity = keyNode.length; index < quantity; index += 1) {
            if (Array.isArray(keyNode[index])) throwError(state, "nested arrays are not supported inside keys");
            if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") keyNode[index] = "[object Object]";
          }
        }
        if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") keyNode = "[object Object]";
        keyNode = String(keyNode);
        if (_result === null) _result = {};
        if (keyTag === "tag:yaml.org,2002:merge") if (Array.isArray(valueNode)) {
          if (valueNode.length > state.maxMergeSeqLength) throwError(state, "merge sequence length exceeded maxMergeSeqLength (" + state.maxMergeSeqLength + ")");
          const seen = /* @__PURE__ */ new Set();
          for (let index = 0, quantity = valueNode.length; index < quantity; index += 1) {
            const src = valueNode[index];
            if (seen.has(src)) continue;
            seen.add(src);
            mergeMappings(state, _result, src, overridableKeys);
          }
        } else mergeMappings(state, _result, valueNode, overridableKeys);
        else {
          if (!state.json && !_hasOwnProperty.call(overridableKeys, keyNode) && _hasOwnProperty.call(_result, keyNode)) {
            state.line = startLine || state.line;
            state.lineStart = startLineStart || state.lineStart;
            state.position = startPos || state.position;
            throwError(state, "duplicated mapping key");
          }
          setProperty(_result, keyNode, valueNode);
          delete overridableKeys[keyNode];
        }
        return _result;
      }
      function readLineBreak(state) {
        const ch = state.input.charCodeAt(state.position);
        if (ch === 10) state.position++;
        else if (ch === 13) {
          state.position++;
          if (state.input.charCodeAt(state.position) === 10) state.position++;
        } else throwError(state, "a line break is expected");
        state.line += 1;
        state.lineStart = state.position;
        state.firstTabInLine = -1;
      }
      function skipSeparationSpace(state, allowComments, checkIndent) {
        let lineBreaks = 0;
        let ch = state.input.charCodeAt(state.position);
        while (ch !== 0) {
          while (isWhiteSpace(ch)) {
            if (ch === 9 && state.firstTabInLine === -1) state.firstTabInLine = state.position;
            ch = state.input.charCodeAt(++state.position);
          }
          if (allowComments && ch === 35) do
            ch = state.input.charCodeAt(++state.position);
          while (ch !== 10 && ch !== 13 && ch !== 0);
          if (isEol(ch)) {
            readLineBreak(state);
            ch = state.input.charCodeAt(state.position);
            lineBreaks++;
            state.lineIndent = 0;
            while (ch === 32) {
              state.lineIndent++;
              ch = state.input.charCodeAt(++state.position);
            }
          } else break;
        }
        if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) throwWarning(state, "deficient indentation");
        return lineBreaks;
      }
      function testDocumentSeparator(state) {
        let _position = state.position;
        let ch = state.input.charCodeAt(_position);
        if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
          _position += 3;
          ch = state.input.charCodeAt(_position);
          if (ch === 0 || isWsOrEol(ch)) return true;
        }
        return false;
      }
      function writeFoldedLines(state, count) {
        if (count === 1) state.result += " ";
        else if (count > 1) state.result += common.repeat("\n", count - 1);
      }
      function readPlainScalar(state, nodeIndent, withinFlowCollection) {
        let captureStart;
        let captureEnd;
        let hasPendingContent;
        let _line;
        let _lineStart;
        let _lineIndent;
        const _kind = state.kind;
        const _result = state.result;
        let ch = state.input.charCodeAt(state.position);
        if (isWsOrEol(ch) || isFlowIndicator(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) return false;
        if (ch === 63 || ch === 45) {
          const following = state.input.charCodeAt(state.position + 1);
          if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) return false;
        }
        state.kind = "scalar";
        state.result = "";
        captureStart = captureEnd = state.position;
        hasPendingContent = false;
        while (ch !== 0) {
          if (ch === 58) {
            const following = state.input.charCodeAt(state.position + 1);
            if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) break;
          } else if (ch === 35) {
            if (isWsOrEol(state.input.charCodeAt(state.position - 1))) break;
          } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && isFlowIndicator(ch)) break;
          else if (isEol(ch)) {
            _line = state.line;
            _lineStart = state.lineStart;
            _lineIndent = state.lineIndent;
            skipSeparationSpace(state, false, -1);
            if (state.lineIndent >= nodeIndent) {
              hasPendingContent = true;
              ch = state.input.charCodeAt(state.position);
              continue;
            } else {
              state.position = captureEnd;
              state.line = _line;
              state.lineStart = _lineStart;
              state.lineIndent = _lineIndent;
              break;
            }
          }
          if (hasPendingContent) {
            captureSegment(state, captureStart, captureEnd, false);
            writeFoldedLines(state, state.line - _line);
            captureStart = captureEnd = state.position;
            hasPendingContent = false;
          }
          if (!isWhiteSpace(ch)) captureEnd = state.position + 1;
          ch = state.input.charCodeAt(++state.position);
        }
        captureSegment(state, captureStart, captureEnd, false);
        if (state.result) return true;
        state.kind = _kind;
        state.result = _result;
        return false;
      }
      function readSingleQuotedScalar(state, nodeIndent) {
        let captureStart;
        let captureEnd;
        let ch = state.input.charCodeAt(state.position);
        if (ch !== 39) return false;
        state.kind = "scalar";
        state.result = "";
        state.position++;
        captureStart = captureEnd = state.position;
        while ((ch = state.input.charCodeAt(state.position)) !== 0) if (ch === 39) {
          captureSegment(state, captureStart, state.position, true);
          ch = state.input.charCodeAt(++state.position);
          if (ch === 39) {
            captureStart = state.position;
            state.position++;
            captureEnd = state.position;
          } else return true;
        } else if (isEol(ch)) {
          captureSegment(state, captureStart, captureEnd, true);
          writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
          captureStart = captureEnd = state.position;
        } else if (state.position === state.lineStart && testDocumentSeparator(state)) throwError(state, "unexpected end of the document within a single quoted scalar");
        else {
          state.position++;
          if (!isWhiteSpace(ch)) captureEnd = state.position;
        }
        throwError(state, "unexpected end of the stream within a single quoted scalar");
      }
      function readDoubleQuotedScalar(state, nodeIndent) {
        let captureStart;
        let captureEnd;
        let tmp;
        let ch = state.input.charCodeAt(state.position);
        if (ch !== 34) return false;
        state.kind = "scalar";
        state.result = "";
        state.position++;
        captureStart = captureEnd = state.position;
        while ((ch = state.input.charCodeAt(state.position)) !== 0) if (ch === 34) {
          captureSegment(state, captureStart, state.position, true);
          state.position++;
          return true;
        } else if (ch === 92) {
          captureSegment(state, captureStart, state.position, true);
          ch = state.input.charCodeAt(++state.position);
          if (isEol(ch)) skipSeparationSpace(state, false, nodeIndent);
          else if (ch < 256 && simpleEscapeCheck[ch]) {
            state.result += simpleEscapeMap[ch];
            state.position++;
          } else if ((tmp = escapedHexLen(ch)) > 0) {
            let hexLength = tmp;
            let hexResult = 0;
            for (; hexLength > 0; hexLength--) {
              ch = state.input.charCodeAt(++state.position);
              if ((tmp = fromHexCode(ch)) >= 0) hexResult = (hexResult << 4) + tmp;
              else throwError(state, "expected hexadecimal character");
            }
            state.result += charFromCodepoint(hexResult);
            state.position++;
          } else throwError(state, "unknown escape sequence");
          captureStart = captureEnd = state.position;
        } else if (isEol(ch)) {
          captureSegment(state, captureStart, captureEnd, true);
          writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
          captureStart = captureEnd = state.position;
        } else if (state.position === state.lineStart && testDocumentSeparator(state)) throwError(state, "unexpected end of the document within a double quoted scalar");
        else {
          state.position++;
          if (!isWhiteSpace(ch)) captureEnd = state.position;
        }
        throwError(state, "unexpected end of the stream within a double quoted scalar");
      }
      function readFlowCollection(state, nodeIndent) {
        let readNext = true;
        let _line;
        let _lineStart;
        let _pos;
        const _tag = state.tag;
        let _result;
        const _anchor = state.anchor;
        let terminator;
        let isPair;
        let isExplicitPair;
        let isMapping;
        const overridableKeys = /* @__PURE__ */ Object.create(null);
        let keyNode;
        let keyTag;
        let valueNode;
        let ch = state.input.charCodeAt(state.position);
        if (ch === 91) {
          terminator = 93;
          isMapping = false;
          _result = [];
        } else if (ch === 123) {
          terminator = 125;
          isMapping = true;
          _result = {};
        } else return false;
        if (state.anchor !== null) storeAnchor(state, state.anchor, _result);
        ch = state.input.charCodeAt(++state.position);
        while (ch !== 0) {
          skipSeparationSpace(state, true, nodeIndent);
          ch = state.input.charCodeAt(state.position);
          if (ch === terminator) {
            state.position++;
            state.tag = _tag;
            state.anchor = _anchor;
            state.kind = isMapping ? "mapping" : "sequence";
            state.result = _result;
            return true;
          } else if (!readNext) throwError(state, "missed comma between flow collection entries");
          else if (ch === 44) throwError(state, "expected the node content, but found ','");
          keyTag = keyNode = valueNode = null;
          isPair = isExplicitPair = false;
          if (ch === 63) {
            if (isWsOrEol(state.input.charCodeAt(state.position + 1))) {
              isPair = isExplicitPair = true;
              state.position++;
              skipSeparationSpace(state, true, nodeIndent);
            }
          }
          _line = state.line;
          _lineStart = state.lineStart;
          _pos = state.position;
          composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
          keyTag = state.tag;
          keyNode = state.result;
          skipSeparationSpace(state, true, nodeIndent);
          ch = state.input.charCodeAt(state.position);
          if ((isExplicitPair || state.line === _line) && ch === 58) {
            isPair = true;
            ch = state.input.charCodeAt(++state.position);
            skipSeparationSpace(state, true, nodeIndent);
            composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
            valueNode = state.result;
          }
          if (isMapping) storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
          else if (isPair) _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
          else _result.push(keyNode);
          skipSeparationSpace(state, true, nodeIndent);
          ch = state.input.charCodeAt(state.position);
          if (ch === 44) {
            readNext = true;
            ch = state.input.charCodeAt(++state.position);
          } else readNext = false;
        }
        throwError(state, "unexpected end of the stream within a flow collection");
      }
      function readBlockScalar(state, nodeIndent) {
        let folding;
        let chomping = CHOMPING_CLIP;
        let didReadContent = false;
        let detectedIndent = false;
        let textIndent = nodeIndent;
        let emptyLines = 0;
        let atMoreIndented = false;
        let tmp;
        let ch = state.input.charCodeAt(state.position);
        if (ch === 124) folding = false;
        else if (ch === 62) folding = true;
        else return false;
        state.kind = "scalar";
        state.result = "";
        while (ch !== 0) {
          ch = state.input.charCodeAt(++state.position);
          if (ch === 43 || ch === 45) if (CHOMPING_CLIP === chomping) chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
          else throwError(state, "repeat of a chomping mode identifier");
          else if ((tmp = fromDecimalCode(ch)) >= 0) if (tmp === 0) throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
          else if (!detectedIndent) {
            textIndent = nodeIndent + tmp - 1;
            detectedIndent = true;
          } else throwError(state, "repeat of an indentation width identifier");
          else break;
        }
        if (isWhiteSpace(ch)) {
          do
            ch = state.input.charCodeAt(++state.position);
          while (isWhiteSpace(ch));
          if (ch === 35) do
            ch = state.input.charCodeAt(++state.position);
          while (!isEol(ch) && ch !== 0);
        }
        while (ch !== 0) {
          readLineBreak(state);
          state.lineIndent = 0;
          ch = state.input.charCodeAt(state.position);
          while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
            state.lineIndent++;
            ch = state.input.charCodeAt(++state.position);
          }
          if (!detectedIndent && state.lineIndent > textIndent) textIndent = state.lineIndent;
          if (isEol(ch)) {
            emptyLines++;
            continue;
          }
          if (!detectedIndent && textIndent === 0) throwError(state, "missing indentation for block scalar");
          if (state.lineIndent < textIndent) {
            if (chomping === CHOMPING_KEEP) state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
            else if (chomping === CHOMPING_CLIP) {
              if (didReadContent) state.result += "\n";
            }
            break;
          }
          if (folding) if (isWhiteSpace(ch)) {
            atMoreIndented = true;
            state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
          } else if (atMoreIndented) {
            atMoreIndented = false;
            state.result += common.repeat("\n", emptyLines + 1);
          } else if (emptyLines === 0) {
            if (didReadContent) state.result += " ";
          } else state.result += common.repeat("\n", emptyLines);
          else state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
          didReadContent = true;
          detectedIndent = true;
          emptyLines = 0;
          const captureStart = state.position;
          while (!isEol(ch) && ch !== 0) ch = state.input.charCodeAt(++state.position);
          captureSegment(state, captureStart, state.position, false);
        }
        return true;
      }
      function readBlockSequence(state, nodeIndent) {
        const _tag = state.tag;
        const _anchor = state.anchor;
        const _result = [];
        let detected = false;
        if (state.firstTabInLine !== -1) return false;
        if (state.anchor !== null) storeAnchor(state, state.anchor, _result);
        let ch = state.input.charCodeAt(state.position);
        while (ch !== 0) {
          if (state.firstTabInLine !== -1) {
            state.position = state.firstTabInLine;
            throwError(state, "tab characters must not be used in indentation");
          }
          if (ch !== 45) break;
          if (!isWsOrEol(state.input.charCodeAt(state.position + 1))) break;
          detected = true;
          state.position++;
          if (skipSeparationSpace(state, true, -1)) {
            if (state.lineIndent <= nodeIndent) {
              _result.push(null);
              ch = state.input.charCodeAt(state.position);
              continue;
            }
          }
          const _line = state.line;
          composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
          _result.push(state.result);
          skipSeparationSpace(state, true, -1);
          ch = state.input.charCodeAt(state.position);
          if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) throwError(state, "bad indentation of a sequence entry");
          else if (state.lineIndent < nodeIndent) break;
        }
        if (detected) {
          state.tag = _tag;
          state.anchor = _anchor;
          state.kind = "sequence";
          state.result = _result;
          return true;
        }
        return false;
      }
      function readBlockMapping(state, nodeIndent, flowIndent) {
        let allowCompact;
        let _keyLine;
        let _keyLineStart;
        let _keyPos;
        const _tag = state.tag;
        const _anchor = state.anchor;
        const _result = {};
        const overridableKeys = /* @__PURE__ */ Object.create(null);
        let keyTag = null;
        let keyNode = null;
        let valueNode = null;
        let atExplicitKey = false;
        let detected = false;
        if (state.firstTabInLine !== -1) return false;
        if (state.anchor !== null) storeAnchor(state, state.anchor, _result);
        let ch = state.input.charCodeAt(state.position);
        while (ch !== 0) {
          if (!atExplicitKey && state.firstTabInLine !== -1) {
            state.position = state.firstTabInLine;
            throwError(state, "tab characters must not be used in indentation");
          }
          const following = state.input.charCodeAt(state.position + 1);
          const _line = state.line;
          if ((ch === 63 || ch === 58) && isWsOrEol(following)) {
            if (ch === 63) {
              if (atExplicitKey) {
                storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
                keyTag = keyNode = valueNode = null;
              }
              detected = true;
              atExplicitKey = true;
              allowCompact = true;
            } else if (atExplicitKey) {
              atExplicitKey = false;
              allowCompact = true;
            } else throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
            state.position += 1;
            ch = following;
          } else {
            _keyLine = state.line;
            _keyLineStart = state.lineStart;
            _keyPos = state.position;
            if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) break;
            if (state.line === _line) {
              ch = state.input.charCodeAt(state.position);
              while (isWhiteSpace(ch)) ch = state.input.charCodeAt(++state.position);
              if (ch === 58) {
                ch = state.input.charCodeAt(++state.position);
                if (!isWsOrEol(ch)) throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
                if (atExplicitKey) {
                  storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
                  keyTag = keyNode = valueNode = null;
                }
                detected = true;
                atExplicitKey = false;
                allowCompact = false;
                keyTag = state.tag;
                keyNode = state.result;
              } else if (detected) throwError(state, "can not read an implicit mapping pair; a colon is missed");
              else {
                state.tag = _tag;
                state.anchor = _anchor;
                return true;
              }
            } else if (detected) throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
            else {
              state.tag = _tag;
              state.anchor = _anchor;
              return true;
            }
          }
          if (state.line === _line || state.lineIndent > nodeIndent) {
            if (atExplicitKey) {
              _keyLine = state.line;
              _keyLineStart = state.lineStart;
              _keyPos = state.position;
            }
            if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) if (atExplicitKey) keyNode = state.result;
            else valueNode = state.result;
            if (!atExplicitKey) {
              storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
              keyTag = keyNode = valueNode = null;
            }
            skipSeparationSpace(state, true, -1);
            ch = state.input.charCodeAt(state.position);
          }
          if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) throwError(state, "bad indentation of a mapping entry");
          else if (state.lineIndent < nodeIndent) break;
        }
        if (atExplicitKey) storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
        if (detected) {
          state.tag = _tag;
          state.anchor = _anchor;
          state.kind = "mapping";
          state.result = _result;
        }
        return detected;
      }
      function readTagProperty(state) {
        let isVerbatim = false;
        let isNamed = false;
        let tagHandle;
        let tagName;
        let ch = state.input.charCodeAt(state.position);
        if (ch !== 33) return false;
        if (state.tag !== null) throwError(state, "duplication of a tag property");
        ch = state.input.charCodeAt(++state.position);
        if (ch === 60) {
          isVerbatim = true;
          ch = state.input.charCodeAt(++state.position);
        } else if (ch === 33) {
          isNamed = true;
          tagHandle = "!!";
          ch = state.input.charCodeAt(++state.position);
        } else tagHandle = "!";
        let _position = state.position;
        if (isVerbatim) {
          do
            ch = state.input.charCodeAt(++state.position);
          while (ch !== 0 && ch !== 62);
          if (state.position < state.length) {
            tagName = state.input.slice(_position, state.position);
            ch = state.input.charCodeAt(++state.position);
          } else throwError(state, "unexpected end of the stream within a verbatim tag");
        } else {
          while (ch !== 0 && !isWsOrEol(ch)) {
            if (ch === 33) if (!isNamed) {
              tagHandle = state.input.slice(_position - 1, state.position + 1);
              if (!PATTERN_TAG_HANDLE.test(tagHandle)) throwError(state, "named tag handle cannot contain such characters");
              isNamed = true;
              _position = state.position + 1;
            } else throwError(state, "tag suffix cannot contain exclamation marks");
            ch = state.input.charCodeAt(++state.position);
          }
          tagName = state.input.slice(_position, state.position);
          if (PATTERN_FLOW_INDICATORS.test(tagName)) throwError(state, "tag suffix cannot contain flow indicator characters");
        }
        if (tagName && !PATTERN_TAG_URI.test(tagName)) throwError(state, "tag name cannot contain such characters: " + tagName);
        try {
          tagName = decodeURIComponent(tagName);
        } catch (err) {
          throwError(state, "tag name is malformed: " + tagName);
        }
        if (isVerbatim) state.tag = tagName;
        else if (_hasOwnProperty.call(state.tagMap, tagHandle)) state.tag = state.tagMap[tagHandle] + tagName;
        else if (tagHandle === "!") state.tag = "!" + tagName;
        else if (tagHandle === "!!") state.tag = "tag:yaml.org,2002:" + tagName;
        else throwError(state, 'undeclared tag handle "' + tagHandle + '"');
        return true;
      }
      function readAnchorProperty(state) {
        let ch = state.input.charCodeAt(state.position);
        if (ch !== 38) return false;
        if (state.anchor !== null) throwError(state, "duplication of an anchor property");
        ch = state.input.charCodeAt(++state.position);
        const _position = state.position;
        while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) ch = state.input.charCodeAt(++state.position);
        if (state.position === _position) throwError(state, "name of an anchor node must contain at least one character");
        state.anchor = state.input.slice(_position, state.position);
        return true;
      }
      function readAlias(state) {
        let ch = state.input.charCodeAt(state.position);
        if (ch !== 42) return false;
        ch = state.input.charCodeAt(++state.position);
        const _position = state.position;
        while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) ch = state.input.charCodeAt(++state.position);
        if (state.position === _position) throwError(state, "name of an alias node must contain at least one character");
        const alias = state.input.slice(_position, state.position);
        if (!_hasOwnProperty.call(state.anchorMap, alias)) throwError(state, 'unidentified alias "' + alias + '"');
        state.result = state.anchorMap[alias];
        skipSeparationSpace(state, true, -1);
        return true;
      }
      function tryReadBlockMappingFromProperty(state, propertyStart, nodeIndent, flowIndent) {
        const fallbackState = snapshotState(state);
        beginAnchorTransaction(state);
        restoreState(state, propertyStart);
        state.tag = null;
        state.anchor = null;
        state.kind = null;
        state.result = null;
        if (readBlockMapping(state, nodeIndent, flowIndent) && state.kind === "mapping") {
          commitAnchorTransaction(state);
          return true;
        }
        rollbackAnchorTransaction(state);
        restoreState(state, fallbackState);
        return false;
      }
      function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
        let allowBlockScalars;
        let allowBlockCollections;
        let indentStatus = 1;
        let atNewLine = false;
        let hasContent = false;
        let propertyStart = null;
        let type;
        let flowIndent;
        let blockIndent;
        if (state.depth >= state.maxDepth) throwError(state, "nesting exceeded maxDepth (" + state.maxDepth + ")");
        state.depth += 1;
        if (state.listener !== null) state.listener("open", state);
        state.tag = null;
        state.anchor = null;
        state.kind = null;
        state.result = null;
        const allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
        if (allowToSeek) {
          if (skipSeparationSpace(state, true, -1)) {
            atNewLine = true;
            if (state.lineIndent > parentIndent) indentStatus = 1;
            else if (state.lineIndent === parentIndent) indentStatus = 0;
            else if (state.lineIndent < parentIndent) indentStatus = -1;
          }
        }
        if (indentStatus === 1) while (true) {
          const ch = state.input.charCodeAt(state.position);
          const propertyState = snapshotState(state);
          if (atNewLine && (ch === 33 && state.tag !== null || ch === 38 && state.anchor !== null)) break;
          if (!readTagProperty(state) && !readAnchorProperty(state)) break;
          if (propertyStart === null) propertyStart = propertyState;
          if (skipSeparationSpace(state, true, -1)) {
            atNewLine = true;
            allowBlockCollections = allowBlockStyles;
            if (state.lineIndent > parentIndent) indentStatus = 1;
            else if (state.lineIndent === parentIndent) indentStatus = 0;
            else if (state.lineIndent < parentIndent) indentStatus = -1;
          } else allowBlockCollections = false;
        }
        if (allowBlockCollections) allowBlockCollections = atNewLine || allowCompact;
        if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
          if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) flowIndent = parentIndent;
          else flowIndent = parentIndent + 1;
          blockIndent = state.position - state.lineStart;
          if (indentStatus === 1) if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) hasContent = true;
          else {
            const ch = state.input.charCodeAt(state.position);
            if (propertyStart !== null && allowBlockStyles && !allowBlockCollections && ch !== 124 && ch !== 62 && tryReadBlockMappingFromProperty(state, propertyStart, propertyStart.position - propertyStart.lineStart, flowIndent)) hasContent = true;
            else if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) hasContent = true;
            else if (readAlias(state)) {
              hasContent = true;
              if (state.tag !== null || state.anchor !== null) throwError(state, "alias node should not have any properties");
            } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
              hasContent = true;
              if (state.tag === null) state.tag = "?";
            }
            if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
          }
          else if (indentStatus === 0) hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
        }
        if (state.tag === null) {
          if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
        } else if (state.tag === "?") {
          if (state.result !== null && state.kind !== "scalar") throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
          for (let typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
            type = state.implicitTypes[typeIndex];
            if (type.resolve(state.result)) {
              state.result = type.construct(state.result);
              state.tag = type.tag;
              if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
              break;
            }
          }
        } else if (state.tag !== "!") {
          if (_hasOwnProperty.call(state.typeMap[state.kind || "fallback"], state.tag)) type = state.typeMap[state.kind || "fallback"][state.tag];
          else {
            type = null;
            const typeList = state.typeMap.multi[state.kind || "fallback"];
            for (let typeIndex = 0, typeQuantity = typeList.length; typeIndex < typeQuantity; typeIndex += 1) if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
              type = typeList[typeIndex];
              break;
            }
          }
          if (!type) throwError(state, "unknown tag !<" + state.tag + ">");
          if (state.result !== null && type.kind !== state.kind) throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type.kind + '", not "' + state.kind + '"');
          if (!type.resolve(state.result, state.tag)) throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
          else {
            state.result = type.construct(state.result, state.tag);
            if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
          }
        }
        if (state.listener !== null) state.listener("close", state);
        state.depth -= 1;
        return state.tag !== null || state.anchor !== null || hasContent;
      }
      function readDocument(state) {
        const documentStart = state.position;
        let hasDirectives = false;
        let ch;
        state.version = null;
        state.checkLineBreaks = state.legacy;
        state.tagMap = /* @__PURE__ */ Object.create(null);
        state.anchorMap = /* @__PURE__ */ Object.create(null);
        while ((ch = state.input.charCodeAt(state.position)) !== 0) {
          skipSeparationSpace(state, true, -1);
          ch = state.input.charCodeAt(state.position);
          if (state.lineIndent > 0 || ch !== 37) break;
          hasDirectives = true;
          ch = state.input.charCodeAt(++state.position);
          let _position = state.position;
          while (ch !== 0 && !isWsOrEol(ch)) ch = state.input.charCodeAt(++state.position);
          const directiveName = state.input.slice(_position, state.position);
          const directiveArgs = [];
          if (directiveName.length < 1) throwError(state, "directive name must not be less than one character in length");
          while (ch !== 0) {
            while (isWhiteSpace(ch)) ch = state.input.charCodeAt(++state.position);
            if (ch === 35) {
              do
                ch = state.input.charCodeAt(++state.position);
              while (ch !== 0 && !isEol(ch));
              break;
            }
            if (isEol(ch)) break;
            _position = state.position;
            while (ch !== 0 && !isWsOrEol(ch)) ch = state.input.charCodeAt(++state.position);
            directiveArgs.push(state.input.slice(_position, state.position));
          }
          if (ch !== 0) readLineBreak(state);
          if (_hasOwnProperty.call(directiveHandlers, directiveName)) directiveHandlers[directiveName](state, directiveName, directiveArgs);
          else throwWarning(state, 'unknown document directive "' + directiveName + '"');
        }
        skipSeparationSpace(state, true, -1);
        if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
          state.position += 3;
          skipSeparationSpace(state, true, -1);
        } else if (hasDirectives) throwError(state, "directives end mark is expected");
        composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
        skipSeparationSpace(state, true, -1);
        if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) throwWarning(state, "non-ASCII line breaks are interpreted as content");
        state.documents.push(state.result);
        if (state.position === state.lineStart && testDocumentSeparator(state)) {
          if (state.input.charCodeAt(state.position) === 46) {
            state.position += 3;
            skipSeparationSpace(state, true, -1);
          }
          return;
        }
        if (state.position < state.length - 1) throwError(state, "end of the stream or a document separator is expected");
      }
      function loadDocuments(input, options) {
        input = String(input);
        options = options || {};
        if (input.length !== 0) {
          if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) input += "\n";
          if (input.charCodeAt(0) === 65279) input = input.slice(1);
        }
        const state = new State(input, options);
        const nullpos = input.indexOf("\0");
        if (nullpos !== -1) {
          state.position = nullpos;
          throwError(state, "null byte is not allowed in input");
        }
        state.input += "\0";
        while (state.input.charCodeAt(state.position) === 32) {
          state.lineIndent += 1;
          state.position += 1;
        }
        while (state.position < state.length - 1) readDocument(state);
        return state.documents;
      }
      function loadAll2(input, iterator, options) {
        if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
          options = iterator;
          iterator = null;
        }
        const documents = loadDocuments(input, options);
        if (typeof iterator !== "function") return documents;
        for (let index = 0, length = documents.length; index < length; index += 1) iterator(documents[index]);
      }
      function load2(input, options) {
        const documents = loadDocuments(input, options);
        if (documents.length === 0) return;
        else if (documents.length === 1) return documents[0];
        throw new YAMLException2("expected a single document in the stream, but found more");
      }
      module.exports.loadAll = loadAll2;
      module.exports.load = load2;
    }));
    require_dumper = /* @__PURE__ */ __commonJSMin(((exports, module) => {
      var common = require_common();
      var YAMLException2 = require_exception();
      var DEFAULT_SCHEMA2 = require_default();
      var _toString = Object.prototype.toString;
      var _hasOwnProperty = Object.prototype.hasOwnProperty;
      var CHAR_BOM = 65279;
      var CHAR_TAB = 9;
      var CHAR_LINE_FEED = 10;
      var CHAR_CARRIAGE_RETURN = 13;
      var CHAR_SPACE = 32;
      var CHAR_EXCLAMATION = 33;
      var CHAR_DOUBLE_QUOTE = 34;
      var CHAR_SHARP = 35;
      var CHAR_PERCENT = 37;
      var CHAR_AMPERSAND = 38;
      var CHAR_SINGLE_QUOTE = 39;
      var CHAR_ASTERISK = 42;
      var CHAR_COMMA = 44;
      var CHAR_MINUS = 45;
      var CHAR_COLON = 58;
      var CHAR_EQUALS = 61;
      var CHAR_GREATER_THAN = 62;
      var CHAR_QUESTION = 63;
      var CHAR_COMMERCIAL_AT = 64;
      var CHAR_LEFT_SQUARE_BRACKET = 91;
      var CHAR_RIGHT_SQUARE_BRACKET = 93;
      var CHAR_GRAVE_ACCENT = 96;
      var CHAR_LEFT_CURLY_BRACKET = 123;
      var CHAR_VERTICAL_LINE = 124;
      var CHAR_RIGHT_CURLY_BRACKET = 125;
      var ESCAPE_SEQUENCES = {};
      ESCAPE_SEQUENCES[0] = "\\0";
      ESCAPE_SEQUENCES[7] = "\\a";
      ESCAPE_SEQUENCES[8] = "\\b";
      ESCAPE_SEQUENCES[9] = "\\t";
      ESCAPE_SEQUENCES[10] = "\\n";
      ESCAPE_SEQUENCES[11] = "\\v";
      ESCAPE_SEQUENCES[12] = "\\f";
      ESCAPE_SEQUENCES[13] = "\\r";
      ESCAPE_SEQUENCES[27] = "\\e";
      ESCAPE_SEQUENCES[34] = '\\"';
      ESCAPE_SEQUENCES[92] = "\\\\";
      ESCAPE_SEQUENCES[133] = "\\N";
      ESCAPE_SEQUENCES[160] = "\\_";
      ESCAPE_SEQUENCES[8232] = "\\L";
      ESCAPE_SEQUENCES[8233] = "\\P";
      var DEPRECATED_BOOLEANS_SYNTAX = [
        "y",
        "Y",
        "yes",
        "Yes",
        "YES",
        "on",
        "On",
        "ON",
        "n",
        "N",
        "no",
        "No",
        "NO",
        "off",
        "Off",
        "OFF"
      ];
      var DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
      function compileStyleMap(schema, map) {
        if (map === null) return {};
        const result = {};
        const keys = Object.keys(map);
        for (let index = 0, length = keys.length; index < length; index += 1) {
          let tag = keys[index];
          let style = String(map[tag]);
          if (tag.slice(0, 2) === "!!") tag = "tag:yaml.org,2002:" + tag.slice(2);
          const type = schema.compiledTypeMap["fallback"][tag];
          if (type && _hasOwnProperty.call(type.styleAliases, style)) style = type.styleAliases[style];
          result[tag] = style;
        }
        return result;
      }
      function encodeHex(character) {
        let handle;
        let length;
        const string = character.toString(16).toUpperCase();
        if (character <= 255) {
          handle = "x";
          length = 2;
        } else if (character <= 65535) {
          handle = "u";
          length = 4;
        } else if (character <= 4294967295) {
          handle = "U";
          length = 8;
        } else throw new YAMLException2("code point within a string may not be greater than 0xFFFFFFFF");
        return "\\" + handle + common.repeat("0", length - string.length) + string;
      }
      var QUOTING_TYPE_SINGLE = 1;
      var QUOTING_TYPE_DOUBLE = 2;
      function State(options) {
        this.schema = options["schema"] || DEFAULT_SCHEMA2;
        this.indent = Math.max(1, options["indent"] || 2);
        this.noArrayIndent = options["noArrayIndent"] || false;
        this.skipInvalid = options["skipInvalid"] || false;
        this.flowLevel = common.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
        this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
        this.sortKeys = options["sortKeys"] || false;
        this.lineWidth = options["lineWidth"] || 80;
        this.noRefs = options["noRefs"] || false;
        this.noCompatMode = options["noCompatMode"] || false;
        this.condenseFlow = options["condenseFlow"] || false;
        this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
        this.forceQuotes = options["forceQuotes"] || false;
        this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
        this.implicitTypes = this.schema.compiledImplicit;
        this.explicitTypes = this.schema.compiledExplicit;
        this.tag = null;
        this.result = "";
        this.duplicates = [];
        this.usedDuplicates = null;
      }
      function indentString(string, spaces) {
        const ind = common.repeat(" ", spaces);
        let position = 0;
        let result = "";
        const length = string.length;
        while (position < length) {
          let line;
          const next = string.indexOf("\n", position);
          if (next === -1) {
            line = string.slice(position);
            position = length;
          } else {
            line = string.slice(position, next + 1);
            position = next + 1;
          }
          if (line.length && line !== "\n") result += ind;
          result += line;
        }
        return result;
      }
      function generateNextLine(state, level) {
        return "\n" + common.repeat(" ", state.indent * level);
      }
      function testImplicitResolving(state, str) {
        for (let index = 0, length = state.implicitTypes.length; index < length; index += 1) if (state.implicitTypes[index].resolve(str)) return true;
        return false;
      }
      function isWhitespace(c) {
        return c === CHAR_SPACE || c === CHAR_TAB;
      }
      function isPrintable(c) {
        return c >= 32 && c <= 126 || c >= 161 && c <= 55295 && c !== 8232 && c !== 8233 || c >= 57344 && c <= 65533 && c !== CHAR_BOM || c >= 65536 && c <= 1114111;
      }
      function isNsCharOrWhitespace(c) {
        return isPrintable(c) && c !== CHAR_BOM && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
      }
      function isPlainSafe(c, prev, inblock) {
        const cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
        const cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
        return (inblock ? cIsNsCharOrWhitespace : cIsNsCharOrWhitespace && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && c !== CHAR_SHARP && !(prev === CHAR_COLON && !cIsNsChar) || isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || prev === CHAR_COLON && cIsNsChar;
      }
      function isPlainSafeFirst(c) {
        return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
      }
      function isPlainSafeLast(c) {
        return !isWhitespace(c) && c !== CHAR_COLON;
      }
      function codePointAt(string, pos) {
        const first = string.charCodeAt(pos);
        let second;
        if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
          second = string.charCodeAt(pos + 1);
          if (second >= 56320 && second <= 57343) return (first - 55296) * 1024 + second - 56320 + 65536;
        }
        return first;
      }
      function needIndentIndicator(string) {
        return /^\n* /.test(string);
      }
      var STYLE_PLAIN = 1;
      var STYLE_SINGLE = 2;
      var STYLE_LITERAL = 3;
      var STYLE_FOLDED = 4;
      var STYLE_DOUBLE = 5;
      function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
        let i;
        let char = 0;
        let prevChar = null;
        let hasLineBreak = false;
        let hasFoldableLine = false;
        const shouldTrackWidth = lineWidth !== -1;
        let previousLineBreak = -1;
        let plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
        if (singleLineOnly || forceQuotes) for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
          char = codePointAt(string, i);
          if (!isPrintable(char)) return STYLE_DOUBLE;
          plain = plain && isPlainSafe(char, prevChar, inblock);
          prevChar = char;
        }
        else {
          for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
            char = codePointAt(string, i);
            if (char === CHAR_LINE_FEED) {
              hasLineBreak = true;
              if (shouldTrackWidth) {
                hasFoldableLine = hasFoldableLine || i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
                previousLineBreak = i;
              }
            } else if (!isPrintable(char)) return STYLE_DOUBLE;
            plain = plain && isPlainSafe(char, prevChar, inblock);
            prevChar = char;
          }
          hasFoldableLine = hasFoldableLine || shouldTrackWidth && i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
        }
        if (!hasLineBreak && !hasFoldableLine) {
          if (plain && !forceQuotes && !testAmbiguousType(string)) return STYLE_PLAIN;
          return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
        }
        if (indentPerLevel > 9 && needIndentIndicator(string)) return STYLE_DOUBLE;
        if (!forceQuotes) return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
        return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
      }
      function writeScalar(state, string, level, iskey, inblock) {
        state.dump = (function() {
          if (string.length === 0) return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
          if (!state.noCompatMode) {
            if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
          }
          const indent = state.indent * Math.max(1, level);
          const lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
          const singleLineOnly = iskey || state.flowLevel > -1 && level >= state.flowLevel;
          function testAmbiguity(string2) {
            return testImplicitResolving(state, string2);
          }
          switch (chooseScalarStyle(string, singleLineOnly, state.indent, lineWidth, testAmbiguity, state.quotingType, state.forceQuotes && !iskey, inblock)) {
            case STYLE_PLAIN:
              return string;
            case STYLE_SINGLE:
              return "'" + string.replace(/'/g, "''") + "'";
            case STYLE_LITERAL:
              return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
            case STYLE_FOLDED:
              return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
            case STYLE_DOUBLE:
              return '"' + escapeString(string, lineWidth) + '"';
            default:
              throw new YAMLException2("impossible error: invalid scalar style");
          }
        })();
      }
      function blockHeader(string, indentPerLevel) {
        const indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
        const clip = string[string.length - 1] === "\n";
        return indentIndicator + (clip && (string[string.length - 2] === "\n" || string === "\n") ? "+" : clip ? "" : "-") + "\n";
      }
      function dropEndingNewline(string) {
        return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
      }
      function foldString(string, width) {
        const lineRe = /(\n+)([^\n]*)/g;
        let result = (function() {
          let nextLF = string.indexOf("\n");
          nextLF = nextLF !== -1 ? nextLF : string.length;
          lineRe.lastIndex = nextLF;
          return foldLine(string.slice(0, nextLF), width);
        })();
        let prevMoreIndented = string[0] === "\n" || string[0] === " ";
        let moreIndented;
        let match;
        while (match = lineRe.exec(string)) {
          const prefix = match[1];
          const line = match[2];
          moreIndented = line[0] === " ";
          result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
          prevMoreIndented = moreIndented;
        }
        return result;
      }
      function foldLine(line, width) {
        if (line === "" || line[0] === " ") return line;
        const breakRe = / [^ ]/g;
        let match;
        let start = 0;
        let end;
        let curr = 0;
        let next = 0;
        let result = "";
        while (match = breakRe.exec(line)) {
          next = match.index;
          if (next - start > width) {
            end = curr > start ? curr : next;
            result += "\n" + line.slice(start, end);
            start = end + 1;
          }
          curr = next;
        }
        result += "\n";
        if (line.length - start > width && curr > start) result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
        else result += line.slice(start);
        return result.slice(1);
      }
      function escapeString(string) {
        let result = "";
        let char = 0;
        for (let i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
          char = codePointAt(string, i);
          const escapeSeq = ESCAPE_SEQUENCES[char];
          if (!escapeSeq && isPrintable(char)) {
            result += string[i];
            if (char >= 65536) result += string[i + 1];
          } else result += escapeSeq || encodeHex(char);
        }
        return result;
      }
      function writeFlowSequence(state, level, object) {
        let _result = "";
        const _tag = state.tag;
        for (let index = 0, length = object.length; index < length; index += 1) {
          let value = object[index];
          if (state.replacer) value = state.replacer.call(object, String(index), value);
          if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
            if (_result !== "") _result += "," + (!state.condenseFlow ? " " : "");
            _result += state.dump;
          }
        }
        state.tag = _tag;
        state.dump = "[" + _result + "]";
      }
      function writeBlockSequence(state, level, object, compact) {
        let _result = "";
        const _tag = state.tag;
        for (let index = 0, length = object.length; index < length; index += 1) {
          let value = object[index];
          if (state.replacer) value = state.replacer.call(object, String(index), value);
          if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
            if (!compact || _result !== "") _result += generateNextLine(state, level);
            if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) _result += "-";
            else _result += "- ";
            _result += state.dump;
          }
        }
        state.tag = _tag;
        state.dump = _result || "[]";
      }
      function writeFlowMapping(state, level, object) {
        let _result = "";
        const _tag = state.tag;
        const objectKeyList = Object.keys(object);
        for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
          let pairBuffer = "";
          if (_result !== "") pairBuffer += ", ";
          if (state.condenseFlow) pairBuffer += '"';
          const objectKey = objectKeyList[index];
          let objectValue = object[objectKey];
          if (state.replacer) objectValue = state.replacer.call(object, objectKey, objectValue);
          if (!writeNode(state, level, objectKey, false, false)) continue;
          if (state.dump.length > 1024) pairBuffer += "? ";
          pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
          if (!writeNode(state, level, objectValue, false, false)) continue;
          pairBuffer += state.dump;
          _result += pairBuffer;
        }
        state.tag = _tag;
        state.dump = "{" + _result + "}";
      }
      function writeBlockMapping(state, level, object, compact) {
        let _result = "";
        const _tag = state.tag;
        const objectKeyList = Object.keys(object);
        if (state.sortKeys === true) objectKeyList.sort();
        else if (typeof state.sortKeys === "function") objectKeyList.sort(state.sortKeys);
        else if (state.sortKeys) throw new YAMLException2("sortKeys must be a boolean or a function");
        for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
          let pairBuffer = "";
          if (!compact || _result !== "") pairBuffer += generateNextLine(state, level);
          const objectKey = objectKeyList[index];
          let objectValue = object[objectKey];
          if (state.replacer) objectValue = state.replacer.call(object, objectKey, objectValue);
          if (!writeNode(state, level + 1, objectKey, true, true, true)) continue;
          const explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
          if (explicitPair) if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) pairBuffer += "?";
          else pairBuffer += "? ";
          pairBuffer += state.dump;
          if (explicitPair) pairBuffer += generateNextLine(state, level);
          if (!writeNode(state, level + 1, objectValue, true, explicitPair)) continue;
          if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) pairBuffer += ":";
          else pairBuffer += ": ";
          pairBuffer += state.dump;
          _result += pairBuffer;
        }
        state.tag = _tag;
        state.dump = _result || "{}";
      }
      function detectType(state, object, explicit) {
        const typeList = explicit ? state.explicitTypes : state.implicitTypes;
        for (let index = 0, length = typeList.length; index < length; index += 1) {
          const type = typeList[index];
          if ((type.instanceOf || type.predicate) && (!type.instanceOf || typeof object === "object" && object instanceof type.instanceOf) && (!type.predicate || type.predicate(object))) {
            if (explicit) if (type.multi && type.representName) state.tag = type.representName(object);
            else state.tag = type.tag;
            else state.tag = "?";
            if (type.represent) {
              const style = state.styleMap[type.tag] || type.defaultStyle;
              let _result;
              if (_toString.call(type.represent) === "[object Function]") _result = type.represent(object, style);
              else if (_hasOwnProperty.call(type.represent, style)) _result = type.represent[style](object, style);
              else throw new YAMLException2("!<" + type.tag + '> tag resolver accepts not "' + style + '" style');
              state.dump = _result;
            }
            return true;
          }
        }
        return false;
      }
      function writeNode(state, level, object, block, compact, iskey, isblockseq) {
        state.tag = null;
        state.dump = object;
        if (!detectType(state, object, false)) detectType(state, object, true);
        const type = _toString.call(state.dump);
        const inblock = block;
        if (block) block = state.flowLevel < 0 || state.flowLevel > level;
        const objectOrArray = type === "[object Object]" || type === "[object Array]";
        let duplicateIndex;
        let duplicate;
        if (objectOrArray) {
          duplicateIndex = state.duplicates.indexOf(object);
          duplicate = duplicateIndex !== -1;
        }
        if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) compact = false;
        if (duplicate && state.usedDuplicates[duplicateIndex]) state.dump = "*ref_" + duplicateIndex;
        else {
          if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) state.usedDuplicates[duplicateIndex] = true;
          if (type === "[object Object]") if (block && Object.keys(state.dump).length !== 0) {
            writeBlockMapping(state, level, state.dump, compact);
            if (duplicate) state.dump = "&ref_" + duplicateIndex + state.dump;
          } else {
            writeFlowMapping(state, level, state.dump);
            if (duplicate) state.dump = "&ref_" + duplicateIndex + " " + state.dump;
          }
          else if (type === "[object Array]") if (block && state.dump.length !== 0) {
            if (state.noArrayIndent && !isblockseq && level > 0) writeBlockSequence(state, level - 1, state.dump, compact);
            else writeBlockSequence(state, level, state.dump, compact);
            if (duplicate) state.dump = "&ref_" + duplicateIndex + state.dump;
          } else {
            writeFlowSequence(state, level, state.dump);
            if (duplicate) state.dump = "&ref_" + duplicateIndex + " " + state.dump;
          }
          else if (type === "[object String]") {
            if (state.tag !== "?") writeScalar(state, state.dump, level, iskey, inblock);
          } else if (type === "[object Undefined]") return false;
          else {
            if (state.skipInvalid) return false;
            throw new YAMLException2("unacceptable kind of an object to dump " + type);
          }
          if (state.tag !== null && state.tag !== "?") {
            let tagStr = encodeURI(state.tag[0] === "!" ? state.tag.slice(1) : state.tag).replace(/!/g, "%21");
            if (state.tag[0] === "!") tagStr = "!" + tagStr;
            else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") tagStr = "!!" + tagStr.slice(18);
            else tagStr = "!<" + tagStr + ">";
            state.dump = tagStr + " " + state.dump;
          }
        }
        return true;
      }
      function getDuplicateReferences(object, state) {
        const objects = [];
        const duplicatesIndexes = [];
        inspectNode(object, objects, duplicatesIndexes);
        const length = duplicatesIndexes.length;
        for (let index = 0; index < length; index += 1) state.duplicates.push(objects[duplicatesIndexes[index]]);
        state.usedDuplicates = new Array(length);
      }
      function inspectNode(object, objects, duplicatesIndexes) {
        if (object !== null && typeof object === "object") {
          const index = objects.indexOf(object);
          if (index !== -1) {
            if (duplicatesIndexes.indexOf(index) === -1) duplicatesIndexes.push(index);
          } else {
            objects.push(object);
            if (Array.isArray(object)) for (let i = 0, length = object.length; i < length; i += 1) inspectNode(object[i], objects, duplicatesIndexes);
            else {
              const objectKeyList = Object.keys(object);
              for (let i = 0, length = objectKeyList.length; i < length; i += 1) inspectNode(object[objectKeyList[i]], objects, duplicatesIndexes);
            }
          }
        }
      }
      function dump2(input, options) {
        options = options || {};
        const state = new State(options);
        if (!state.noRefs) getDuplicateReferences(input, state);
        let value = input;
        if (state.replacer) value = state.replacer.call({ "": value }, "", value);
        if (writeNode(state, 0, value, true, true)) return state.dump + "\n";
        return "";
      }
      module.exports.dump = dump2;
    }));
    import_js_yaml = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports, module) => {
      var loader = require_loader();
      var dumper = require_dumper();
      function renamed(from, to) {
        return function() {
          throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
        };
      }
      module.exports.Type = require_type();
      module.exports.Schema = require_schema();
      module.exports.FAILSAFE_SCHEMA = require_failsafe();
      module.exports.JSON_SCHEMA = require_json();
      module.exports.CORE_SCHEMA = require_core();
      module.exports.DEFAULT_SCHEMA = require_default();
      module.exports.load = loader.load;
      module.exports.loadAll = loader.loadAll;
      module.exports.dump = dumper.dump;
      module.exports.YAMLException = require_exception();
      module.exports.types = {
        binary: require_binary(),
        float: require_float(),
        map: require_map(),
        null: require_null(),
        pairs: require_pairs(),
        set: require_set(),
        timestamp: require_timestamp(),
        bool: require_bool(),
        int: require_int(),
        merge: require_merge(),
        omap: require_omap(),
        seq: require_seq(),
        str: require_str()
      };
      module.exports.safeLoad = renamed("safeLoad", "load");
      module.exports.safeLoadAll = renamed("safeLoadAll", "loadAll");
      module.exports.safeDump = renamed("safeDump", "dump");
    })))(), 1);
    ({ Type, Schema, FAILSAFE_SCHEMA, JSON_SCHEMA, CORE_SCHEMA, DEFAULT_SCHEMA, load, loadAll, dump, YAMLException, types, safeLoad, safeLoadAll, safeDump } = import_js_yaml.default);
    index_vite_proxy_tmp_default = import_js_yaml.default;
  }
});

// engine/serializers/yaml.mjs
function invalid(message) {
  throw new NogginError(message, { code: "invalid-document", exitCode: 2 });
}
function unsupported(message) {
  throw new NogginError(message, { code: "unsupported-schema", exitCode: 2 });
}
function fromYaml(text) {
  if (typeof text !== "string") invalid("fromYaml: expected a string");
  if (!text.trim()) {
    return { schemaVersion: SCHEMA_VERSION, active: null, items: [] };
  }
  let data;
  try {
    data = index_vite_proxy_tmp_default.load(text);
  } catch (e) {
    invalid(`failed to parse YAML: ${e.message}`);
  }
  return normalizeParsed(data);
}
function toYaml(doc) {
  return index_vite_proxy_tmp_default.dump(doc, { noRefs: true, lineWidth: 100, sortKeys: false });
}
function normalizeParsed(data) {
  if (!data || typeof data !== "object") invalid("expected a mapping at the top level");
  if (data.schemaVersion !== SCHEMA_VERSION) {
    unsupported(
      `schemaVersion ${data.schemaVersion} not supported by this build (expected ${SCHEMA_VERSION}).`
    );
  }
  if (!Array.isArray(data.items)) invalid("expected items array");
  if (data.active === void 0) invalid("expected active field");
  for (const f of data.items) {
    if (!Array.isArray(f.notes)) invalid("item notes must be an array");
    f.notes = f.notes.map(normalizeNote);
    if ("closedAt" in f) delete f.closedAt;
    if ("pushedAt" in f) delete f.pushedAt;
  }
  data.schemaVersion = SCHEMA_VERSION;
  return data;
}
var init_yaml = __esm({
  "engine/serializers/yaml.mjs"() {
    init_js_yaml();
    init_noggin_api();
  }
});

// engine/backends/file.mjs
var file_exports = {};
__export(file_exports, {
  fileFactory: () => fileFactory
});
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
function loadDocument(filePath) {
  if (!fs.existsSync(filePath)) {
    return { schemaVersion: SCHEMA_VERSION, active: null, items: [] };
  }
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    throw new NogginError(`failed to read ${filePath}: ${e.message}`, { code: "io", exitCode: 2 });
  }
  try {
    return normalizeDocument(fromYaml(raw));
  } catch (e) {
    if (e instanceof NogginError && (e.code === "invalid-document" || e.code === "unsupported-schema")) {
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
  fs.writeFileSync(tmp, toYaml(doc), "utf8");
  fs.renameSync(tmp, filePath);
}
function expandHome(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}
async function withFileLock(filePath, timeout, task) {
  const lockDir = filePath + LOCK_SUFFIX;
  const deadline = Date.now() + timeout;
  let acquired = false;
  while (!acquired) {
    try {
      fs.mkdirSync(lockDir);
      acquired = true;
    } catch (err) {
      if (err && err.code !== "EEXIST") throw err;
      if (reclaimIfStale(lockDir)) continue;
      if (Date.now() >= deadline) {
        const e = new NogginError(
          `could not acquire lock on ${filePath} within ${timeout}ms`,
          { code: "lock-timeout", exitCode: 1 }
        );
        throw e;
      }
      await sleep(25 + Math.floor(Math.random() * 50));
    }
  }
  writeHeartbeat(lockDir);
  try {
    return await task();
  } finally {
    try {
      fs.rmSync(lockDir, { recursive: true, force: true });
    } catch {
    }
  }
}
function writeHeartbeat(lockDir) {
  try {
    fs.writeFileSync(path.join(lockDir, "pid"), `${process.pid}
${Date.now()}
`, "utf8");
  } catch {
  }
}
function reclaimIfStale(lockDir) {
  let pidFile;
  try {
    pidFile = fs.readFileSync(path.join(lockDir, "pid"), "utf8");
  } catch {
    return false;
  }
  const [pidStr, tsStr] = pidFile.split("\n");
  const pid = Number(pidStr);
  const ts = Number(tsStr);
  if (!Number.isFinite(pid) || !Number.isFinite(ts)) return false;
  if (Date.now() - ts < STALE_AFTER_MS && isAlive(pid)) return false;
  try {
    fs.rmSync(lockDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
function isAlive(pid) {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return !!(err && err.code === "EPERM");
  }
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function findByKey2(items, key) {
  if (!key) return null;
  return items.find((f) => f.key === key) || null;
}
function childrenOfImpl(items, parentKey) {
  return items.filter((f) => (f.parentKey ?? null) === (parentKey ?? null));
}
function positionOf2(items, item) {
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
    const position = positionOf2(items, f);
    if (!position) return null;
    parts.unshift(String(position));
    f = f.parentKey ? findByKey2(items, f.parentKey) : null;
  }
  return "/" + parts.join("/");
}
function tryResolveDetailed2(doc, p) {
  if (!p) return { ok: false, error: `path: empty path` };
  const s = String(p);
  const active = doc.active ? findByKey2(doc.items, doc.active) : null;
  if (s.startsWith("/")) {
    const rest2 = s.slice(1);
    if (rest2 === "") return { ok: false, error: `path '${s}': empty absolute path` };
    return walkPath2(doc.items, null, rest2, s);
  }
  if (s === ".") {
    if (!active) return { ok: false, error: `path '.': no active item` };
    return { ok: true, item: active };
  }
  if (s === "..") {
    if (!active) return { ok: false, error: `path '..': no active item` };
    if (!active.parentKey) return { ok: false, error: `path '..': active item has no parent` };
    return { ok: true, item: findByKey2(doc.items, active.parentKey) };
  }
  if (s === "-" || s === "+") {
    if (!active) return { ok: false, error: `path '${s}': no active item` };
    return siblingRelative2(doc.items, active, s === "-" ? -1 : 1, s);
  }
  if (s.startsWith("-/") || s.startsWith("+/")) {
    if (!active) return { ok: false, error: `path '${s}' is relative but no active item` };
    const direction = s[0] === "-" ? -1 : 1;
    const sibling = siblingRelative2(doc.items, active, direction, s);
    if (!sibling.ok) return sibling;
    const rest2 = s.slice(2);
    if (rest2 === "") return { ok: false, error: `path '${s}': trailing slash with no descendant` };
    return walkPath2(doc.items, sibling.item, rest2, s);
  }
  if (!active) return { ok: false, error: `path '${s}' is relative but no active item` };
  let base = active;
  let rest = s;
  while (rest === ".." || rest.startsWith("../")) {
    if (!base.parentKey) return { ok: false, error: `path '${s}': cannot go above root` };
    base = findByKey2(doc.items, base.parentKey);
    rest = rest === ".." ? "" : rest.slice(3);
  }
  if (rest.startsWith("./")) rest = rest.slice(2);
  if (rest === "") return { ok: true, item: base };
  return walkPath2(doc.items, base, rest, s);
}
function walkPath2(items, base, segPath, originalForError) {
  const segments = segPath.split("/").filter(Boolean);
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
      const where = current ? `under '${pathOfImpl(items, current)}'` : "at root";
      return { ok: false, error: `path not found: ${originalForError} (no position ${position} ${where})` };
    }
    current = match;
  }
  return { ok: true, item: current };
}
function siblingRelative2(items, item, delta, originalForError) {
  const peers = childrenOfImpl(items, item.parentKey || null);
  const index = peers.findIndex((p) => p.key === item.key);
  const target = peers[index + delta];
  if (!target) {
    const direction = delta < 0 ? "previous" : "next";
    return { ok: false, error: `path '${originalForError}': active item has no ${direction} sibling` };
  }
  return { ok: true, item: target };
}
var DEFAULT_LOCK_TIMEOUT, fileFactory, FileNoggin, LOCK_SUFFIX, STALE_AFTER_MS;
var init_file = __esm({
  "engine/backends/file.mjs"() {
    init_noggin_api();
    init_yaml();
    DEFAULT_LOCK_TIMEOUT = 5e3;
    fileFactory = {
      scheme: "file",
      async open(location, opts) {
        const filePath = expandHome(String(location || ""));
        if (!filePath) throw new NogginError("fileFactory: empty location", { code: "no-location", exitCode: 2 });
        const original = opts && typeof opts.location === "string" && opts.location || filePath;
        const noggin = new FileNoggin(path.resolve(filePath), { ...opts, _originalLocation: original });
        await noggin._init();
        return noggin;
      }
    };
    factories.register(fileFactory, { default: true });
    FileNoggin = class {
      constructor(filePath, opts = {}) {
        this.file = filePath;
        this.location = typeof opts._originalLocation === "string" && opts._originalLocation || filePath;
        this._doc = { schemaVersion: SCHEMA_VERSION, active: null, items: [] };
        this._changeListeners = /* @__PURE__ */ new Set();
        this._errorListeners = /* @__PURE__ */ new Set();
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
        this._doc = freezeDocument(loadDocument(this.file));
        if (this._watchOnInit) this._startWatch();
        return this;
      }
      // ── Read accessors ──────────────────────────────────────────────────
      get items() {
        return this._doc.items;
      }
      get active() {
        return this._doc.active ? findByKey2(this._doc.items, this._doc.active) : null;
      }
      get roots() {
        return childrenOfImpl(this._doc.items, null);
      }
      findByKey(key) {
        return findByKey2(this._doc.items, key);
      }
      childrenOf(parentKey) {
        return childrenOfImpl(this._doc.items, parentKey || null);
      }
      pathOf(item) {
        return pathOfImpl(this._doc.items, item);
      }
      resolvePath(p) {
        const r = tryResolveDetailed2(this._doc, p);
        if (r.ok) return r.item;
        throw new NogginError(r.error, { code: "path-not-found", exitCode: 1 });
      }
      tryResolvePath(p) {
        const r = tryResolveDetailed2(this._doc, p);
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
        if (this._reloadTimer) {
          clearTimeout(this._reloadTimer);
          this._reloadTimer = null;
        }
        if (this._watcher) {
          try {
            this._watcher.close();
          } catch {
          }
          this._watcher = null;
        }
        this._changeListeners.clear();
        this._errorListeners.clear();
        try {
          await this._tail;
        } catch {
        }
      }
      // ── Internals ───────────────────────────────────────────────────────
      _enqueue(task) {
        const prev = this._tail;
        const next = prev.then(() => task());
        this._tail = next.catch(() => {
        });
        return next;
      }
      async _runLocked(task) {
        return withFileLock(this.file, this._lockTimeout, task);
      }
      _fireChange(event) {
        for (const h of this._changeListeners) {
          try {
            h(event);
          } catch {
          }
        }
      }
      _fireError(err) {
        for (const h of this._errorListeners) {
          try {
            h(err);
          } catch {
          }
        }
      }
      _startWatch() {
        const dir = path.dirname(this.file);
        if (!fs.existsSync(dir)) return;
        try {
          this._watcher = fs.watch(dir, { persistent: false }, (_event, name) => {
            if (!name) {
              this._scheduleReload();
              return;
            }
            if (path.basename(this.file) === name) this._scheduleReload();
          });
        } catch {
        }
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
        try {
          next = loadDocument(this.file);
        } catch (e) {
          if (e instanceof NogginError) this._fireError(e);
          return;
        }
        if (documentsEqual(this._doc, next)) return;
        const before = this._doc;
        const frozen = freezeDocument(next);
        const changes = diffDocuments(before, frozen);
        this._doc = frozen;
        this._fireChange({ changes, cause: "external" });
      }
    };
    LOCK_SUFFIX = ".lock";
    STALE_AFTER_MS = 3e4;
  }
});

// cli/noggin.mjs
init_noggin_api();
var VALUE_FLAGS = /* @__PURE__ */ new Set(["noggin", "title", "before", "after", "into"]);
var OPTIONAL_VALUE_FLAGS = /* @__PURE__ */ new Set(["goto"]);
var BOOL_FLAGS = /* @__PURE__ */ new Set([
  "json",
  "with-json",
  "help",
  "no-children",
  "with-notes",
  "done",
  "open",
  "recursive",
  "with-siblings",
  "with-descendants",
  "with-all",
  "force",
  "close-all"
]);
var ExitSignal = class extends Error {
  constructor(code) {
    super(`exit:${code}`);
    this.code = code;
    this.name = "ExitSignal";
  }
};
function fail(ctx, msg, code = 2, errCode = "noggin-error") {
  if (ctx.json) {
    const envelope = formatError({
      verb: ctx.verb,
      error: new NogginError(msg, { code: errCode, exitCode: code })
    });
    ctx.io.stderr(JSON.stringify(envelope, null, 2) + "\n");
  } else {
    ctx.io.stderr(`noggin: ${msg}
`);
  }
  throw new ExitSignal(code);
}
function looksLikePath(value) {
  const text = String(value ?? "");
  if (text === "." || text === ".." || text === "-" || text === "+") return true;
  if (text.startsWith("./") || text.startsWith("../")) return true;
  if (text.startsWith("-/") || text.startsWith("+/")) return true;
  if (/^\/?\d+(?:\/\d+)*$/.test(text)) return true;
  return false;
}
function parseFlagToken(token) {
  const eq = token.indexOf("=");
  if (eq < 0) return { key: token.slice(2), value: void 0, hasInlineValue: false };
  return { key: token.slice(2, eq), value: token.slice(eq + 1), hasInlineValue: true };
}
function parseArgs(ctx, argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      flags.help = true;
      continue;
    }
    if (a.startsWith("--")) {
      const { key, value, hasInlineValue } = parseFlagToken(a);
      if (BOOL_FLAGS.has(key)) {
        flags[key] = true;
        continue;
      }
      if (OPTIONAL_VALUE_FLAGS.has(key)) {
        if (hasInlineValue) {
          flags[key] = value || true;
        } else if (argv[i + 1] !== void 0 && !argv[i + 1].startsWith("--") && looksLikePath(argv[i + 1])) {
          flags[key] = argv[i + 1];
          i++;
        } else {
          flags[key] = true;
        }
        continue;
      }
      if (VALUE_FLAGS.has(key)) {
        const val = hasInlineValue ? value : argv[i + 1];
        if (val === void 0 || val.startsWith("--")) {
          fail(ctx, `flag --${key} requires a value`);
        }
        flags[key] = val;
        if (!hasInlineValue) i++;
        continue;
      }
      fail(ctx, `unknown flag: --${key}`);
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}
function splitCommand(ctx, argv) {
  const leading = [];
  let i = 0;
  while (i < argv.length && (argv[i].startsWith("--") || argv[i] === "-h")) {
    const a = argv[i];
    leading.push(a);
    const parsedFlag = a.startsWith("--") ? parseFlagToken(a) : null;
    const key = a === "--help" || a === "-h" ? "help" : parsedFlag ? parsedFlag.key : null;
    if (key && VALUE_FLAGS.has(key)) {
      if (parsedFlag?.hasInlineValue) {
        i++;
      } else if (argv[i + 1] === void 0 || argv[i + 1].startsWith("--")) {
        fail(ctx, `flag --${key} requires a value`);
      } else {
        leading.push(argv[i + 1]);
        i += 2;
      }
    } else if (key && OPTIONAL_VALUE_FLAGS.has(key) && !parsedFlag?.hasInlineValue && argv[i + 1] !== void 0 && !argv[i + 1].startsWith("--") && looksLikePath(argv[i + 1])) {
      leading.push(argv[i + 1]);
      i += 2;
    } else {
      i++;
    }
  }
  return {
    verb: argv[i],
    args: [...leading, ...argv.slice(i + 1)]
  };
}
function formatItemLine(item, activeKey, indent) {
  const leading = [];
  if (item.key === activeKey) leading.push("\u{1F4CD}");
  if (item.done) leading.push("\u2705");
  const prefix = leading.length ? leading.join("") + " " : "";
  const trailing = Array.isArray(item.notes) && item.notes.length ? " \u270F\uFE0F" : "";
  return `${indent}${item.path ?? "?"} ${prefix}${item.title}${trailing}`;
}
function printView(ctx, view, opts = {}) {
  if (!view || !Array.isArray(view.items) || view.items.length === 0) {
    ctx.io.stdout("(no item)\n");
    return;
  }
  const lines = [];
  function walk(node, depth) {
    const indent = "  ".repeat(depth);
    lines.push(formatItemLine(node, view.activeKey, indent));
    if (Array.isArray(node.children)) {
      for (const kid of node.children) walk(kid, depth + 1);
    }
    if (opts.includeNotes && node.key === view.targetKey) {
      const notes = Array.isArray(node.notes) ? node.notes : [];
      lines.push(`${indent}  notes:${notes.length ? "" : " (none)"}`);
      for (const note of notes) {
        lines.push(`${indent}    - ${note.timestamp || "(no timestamp)"}`);
        for (const ln of (note.text || "").split("\n")) lines.push(`${indent}      ${ln}`);
      }
    }
  }
  for (const root of view.items) walk(root, 0);
  ctx.io.stdout(lines.join("\n") + "\n");
}
function printJson(ctx, envelope) {
  ctx.io.stdout(JSON.stringify(envelope, null, 2) + "\n");
}
function emitOutput(ctx, flags, human, data) {
  if (flags.json) {
    printJson(ctx, formatSuccess({ verb: ctx.verb, data }));
    return;
  }
  human();
  if (flags["with-json"]) {
    ctx.io.stdout("\n");
    printJson(ctx, formatSuccess({ verb: ctx.verb, data }));
  }
}
function emitView(ctx, view, flags, opts = {}) {
  if (view === null || view === void 0) {
    emitOutput(ctx, flags, () => ctx.io.stdout("(no item)\n"), view ?? null);
    return;
  }
  emitOutput(
    ctx,
    flags,
    () => printView(ctx, view, { includeNotes: Boolean(opts.includeNotes) }),
    view
  );
}
function hasGoto(flags) {
  return Object.prototype.hasOwnProperty.call(flags, "goto");
}
function gotoOpt(flags) {
  return hasGoto(flags) ? flags.goto : void 0;
}
function parsePlacement(ctx, flags, commandName) {
  const present = ["before", "after", "into"].filter((k) => flags[k] !== void 0);
  if (present.length === 0) return void 0;
  if (present.length > 1) fail(ctx, `${commandName}: --before, --after, and --into are mutually exclusive`);
  const kind = present[0];
  return { kind, anchor: flags[kind] };
}
function closeFlags(flags) {
  return {
    force: flags.force === true,
    closeAll: flags["close-all"] === true
  };
}
async function cmdPush(ctx, { positional, flags }) {
  const title = (flags.title || positional.join(" ")).trim();
  if (!title) fail(ctx, "push: title required (--title or positional)", 2, "title-required");
  const noggin = await ctx.openNoggin(flags);
  emitView(ctx, await verbs.push(noggin, { title }), flags);
}
async function cmdAdd(ctx, { positional, flags }) {
  const title = (flags.title || positional.join(" ")).trim();
  if (!title) fail(ctx, "add: title required (--title or positional)", 2, "title-required");
  const noggin = await ctx.openNoggin(flags);
  emitView(ctx, await verbs.add(noggin, {
    title,
    placement: parsePlacement(ctx, flags, "add"),
    goto: gotoOpt(flags)
  }), flags);
}
async function cmdMove(ctx, { positional, flags }) {
  if (positional.length > 1) fail(ctx, "move: accepts at most one path");
  const noggin = await ctx.openNoggin(flags);
  emitView(ctx, await verbs.move(noggin, {
    path: positional[0],
    placement: parsePlacement(ctx, flags, "move"),
    goto: gotoOpt(flags)
  }), flags);
}
async function cmdGoto(ctx, { positional, flags }) {
  if (!positional[0]) fail(ctx, "goto: path required");
  const noggin = await ctx.openNoggin(flags);
  emitView(ctx, await verbs.goto(noggin, { path: positional[0] }), flags);
}
async function cmdDone(ctx, { positional, flags }) {
  if (positional.length > 1) fail(ctx, "done: accepts at most one path");
  const noggin = await ctx.openNoggin(flags);
  emitView(ctx, await verbs.done(noggin, {
    path: positional[0],
    ...closeFlags(flags),
    ...hasGoto(flags) ? { goto: flags.goto } : {}
  }), flags);
}
async function cmdPop(ctx, { positional, flags }) {
  if (positional.length > 0) fail(ctx, "pop: takes no path; pop always operates on the active item");
  if (hasGoto(flags)) fail(ctx, "pop: --goto is not supported; pop always moves to the active item's parent");
  const noggin = await ctx.openNoggin(flags);
  emitView(ctx, await verbs.pop(noggin, closeFlags(flags)), flags);
}
async function cmdEdit(ctx, { positional, flags }) {
  if (flags.done === true && flags.open === true) {
    fail(ctx, "edit: --done and --open are mutually exclusive");
  }
  if (positional.length > 1) fail(ctx, "edit: accepts at most one path");
  const noggin = await ctx.openNoggin(flags);
  const opts = {
    path: positional[0],
    goto: gotoOpt(flags),
    ...closeFlags(flags)
  };
  if (flags.done === true) opts.done = true;
  else if (flags.open === true) opts.done = false;
  if (flags.title !== void 0) opts.title = flags.title;
  emitView(ctx, await verbs.edit(noggin, opts), flags);
}
async function cmdShow(ctx, { positional, flags }) {
  const noggin = await ctx.openNoggin(flags);
  const withSiblings = flags["with-siblings"] === true || flags["with-all"] === true;
  const withDescendants = flags["with-descendants"] === true || flags["with-all"] === true;
  const noChildren = flags["no-children"] === true;
  if (withDescendants && noChildren) {
    fail(ctx, "show: --with-descendants and --no-children are mutually exclusive");
  }
  const view = await verbs.show(noggin, {
    path: positional[0],
    includeChildren: !noChildren,
    withSiblings,
    withDescendants,
    goto: gotoOpt(flags)
  });
  if (view === null) {
    emitOutput(ctx, flags, () => ctx.io.stdout("(no active item; pass a path)\n"), null);
    return;
  }
  emitView(ctx, view, flags, { includeNotes: flags["with-notes"] === true });
}
async function cmdNote(ctx, { positional, flags }) {
  const noggin = await ctx.openNoggin(flags);
  let pathArg;
  let textParts = positional;
  if (positional.length > 0 && looksLikePath(positional[0])) {
    pathArg = positional[0];
    textParts = positional.slice(1);
  }
  emitView(ctx, await verbs.note(noggin, {
    path: pathArg,
    text: textParts.join(" ").trim(),
    goto: gotoOpt(flags)
  }), flags);
}
async function cmdDelete(ctx, { positional, flags }) {
  if (hasGoto(flags)) fail(ctx, "delete: --goto is not supported");
  if (positional.length === 0) fail(ctx, "delete: path required");
  if (positional.length > 1) fail(ctx, "delete: accepts at most one path");
  const noggin = await ctx.openNoggin(flags);
  const result = await verbs.delete(noggin, {
    path: positional[0],
    recursive: flags.recursive === true
  });
  emitOutput(
    ctx,
    flags,
    () => {
      const tail = result.descendantCount ? ` and ${result.descendantCount} descendant(s)` : "";
      ctx.io.stdout(`deleted ${result.deleted.path}${tail}
`);
      if (result.view) printView(ctx, result.view);
      else ctx.io.stdout("(tree is now empty)\n");
    },
    result
  );
}
async function cmdWhere(ctx, { flags }) {
  const noggin = await ctx.openNoggin(flags);
  const location = noggin.describe();
  emitOutput(
    ctx,
    flags,
    () => {
      ctx.io.stdout(`${location}
`);
    },
    location
  );
}
async function cmdCopy(ctx, { positional, flags }) {
  if (positional.length < 2) {
    fail(ctx, "copy: usage: noggin copy <from> <to>", 2, "usage");
  }
  const [fromLoc, toLoc] = positional;
  const source = await ctx.openNogginAt(fromLoc);
  const dest = await ctx.openNogginAt(toLoc);
  const result = await verbs.copy(source, dest, {});
  emitOutput(
    ctx,
    flags,
    () => {
      ctx.io.stdout(`copied ${result.copied} item(s) from ${source.describe()} to ${dest.describe()}
`);
    },
    result
  );
}
async function cmdFactories(ctx, { flags }) {
  const list = factories.list();
  emitOutput(
    ctx,
    flags,
    () => {
      if (list.length === 0) {
        ctx.io.stdout("(no factories registered)\n");
        return;
      }
      const w = Math.max(...list.map((f) => f.scheme.length), 6);
      ctx.io.stdout(`${"scheme".padEnd(w)}  default
`);
      ctx.io.stdout(`${"-".repeat(w)}  -------
`);
      for (const f of list) {
        ctx.io.stdout(`${f.scheme.padEnd(w)}  ${f.default ? "yes" : ""}
`);
      }
    },
    list
  );
}
async function cmdHelp(ctx) {
  ctx.io.stdout([
    "noggin \u2014 working-memory tree CLI",
    "",
    "An item has: title, done flag, timestamps, and append-only notes.",
    "No fixed schema for content. Anything worth saying goes in a note.",
    "",
    "Addressing:",
    '  path   absolute starts with `/` (e.g. "/1/2/3");',
    "         everything else is relative to the active item:",
    '         "." ".." "-" "+" "./X" "../X" "-/X" "+/X" or bare "X/Y" (= "./X/Y")',
    '  tree   "<path> \u{1F4CD}\u2705 title \u270F\uFE0F" \u2014 \u{1F4CD} active, \u2705 done (before title),',
    "         \u270F\uFE0F has notes (after title)",
    "",
    "Verbs:",
    "  push <title>                    child of active, becomes active",
    "  add  <title> [--before|--after|--into <path>] [--goto [path]]",
    "                                  child of active by default; placement flags pick a different spot",
    "  move [<path>] (--before|--after|--into <path>) [--goto [path]]",
    "                                  relocate an item; required placement flag picks the destination",
    "  goto <path>                     make <path> the active item",
    "  done [<path>] [--force|--close-all]",
    "                                  mark done, then make the parent active (idempotent);",
    "                                  --close-all closes any open descendants first;",
    "                                  --force closes the target anyway, leaving kids open",
    "  pop [--force|--close-all]       same as `done` on the active item (no path)",
    "  edit [<path>] [--done|--open] [--title T] [--force|--close-all] [--goto [path]]",
    "                                  edit an item's state and/or title (idempotent);",
    "                                  --done/--open change lifecycle state;",
    "                                  --title T renames the item;",
    "                                  pass at least one of those three",
    "  show [<path>] [--no-children|--with-descendants] [--with-siblings] [--with-all] [--with-notes] [--goto [path]]",
    "                                  current tree view; --with-notes adds note bodies;",
    "                                  --with-siblings includes all sibling rows along the spine;",
    "                                  --with-descendants expands the target subtree recursively;",
    "                                  --with-all = --with-siblings --with-descendants",
    "  note [<path>] <text\u2026> [--goto [path]]",
    "                                  append a timestamped note",
    "  delete <path> [--recursive]     remove an item; --recursive also removes its subtree",
    "  where                           print which noggin would be used and why",
    "  copy <from> <to>                append every item from <from> into <to> (whole-noggin, append-only, fresh keys; notes and timestamps preserved)",
    "  factories                       list registered backend factories",
    "  help",
    "",
    "Item creation flags (push/add):",
    "  --title T                       title (alternative to positional)",
    "",
    "Common:",
    "  --noggin <location>             override the noggin location (highest priority)",
    "  --goto [path]                   move after command; relative paths resolve from target",
    "  --json                          structured output",
    "  --with-json                     human output followed by structured output",
    "",
    "Noggin location (highest first):",
    "  1. --noggin <location>",
    "  2. $NOGGIN env var",
    `  3. ${ctx.defaultLocationLabel}`,
    "",
    "Locations may be a bare path (defaults to the file backend) or a",
    "URI like `file:///abs/path.yaml`. Run `noggin factories` to see all",
    "registered backends.",
    ""
  ].join("\n"));
}
async function runCommand(argv, opts = {}) {
  const io = opts.io || defaultNodeIo();
  const openNogginFn = opts.openNoggin || await defaultNodeOpenNoggin();
  const openNogginAtFn = opts.openNogginAt || await defaultNodeOpenNogginAt();
  const defaultLocationLabel = opts.defaultLocationLabel || (opts.openNoggin ? "(injected)" : await defaultNodeLocationLabel());
  const ctx = {
    verb: null,
    json: false,
    io,
    openNoggin: openNogginFn,
    openNogginAt: openNogginAtFn,
    defaultLocationLabel
  };
  let exitCode = 0;
  try {
    if (!argv || argv.length === 0) {
      await cmdHelp(ctx);
      return finish(io, 0);
    }
    const { verb, args } = splitCommand(ctx, argv);
    const parsed = parseArgs(ctx, args);
    ctx.verb = verb || null;
    ctx.json = Boolean(parsed.flags.json);
    if (parsed.flags.help) {
      await cmdHelp(ctx);
      return finish(io, 0);
    }
    try {
      await dispatch(ctx, verb, parsed);
    } catch (e) {
      if (e instanceof NogginError) {
        fail(ctx, e.message, e.exitCode, e.code);
      }
      throw e;
    }
  } catch (e) {
    if (e instanceof ExitSignal) {
      exitCode = e.code;
    } else {
      io.stderr(`noggin: ${e && e.message ? e.message : e}
`);
      exitCode = 1;
    }
  }
  return finish(io, exitCode);
}
function finish(io, code) {
  if (typeof io.exit === "function") io.exit(code);
  return code;
}
async function dispatch(ctx, verb, parsed) {
  switch (verb) {
    case "push":
      return await cmdPush(ctx, parsed);
    case "add":
      return await cmdAdd(ctx, parsed);
    case "move":
      return await cmdMove(ctx, parsed);
    case "goto":
      return await cmdGoto(ctx, parsed);
    case "done":
      return await cmdDone(ctx, parsed);
    case "pop":
      return await cmdPop(ctx, parsed);
    case "edit":
      return await cmdEdit(ctx, parsed);
    case "show":
      return await cmdShow(ctx, parsed);
    case "note":
      return await cmdNote(ctx, parsed);
    case "delete":
      return await cmdDelete(ctx, parsed);
    case "where":
      return await cmdWhere(ctx, parsed);
    case "copy":
      return await cmdCopy(ctx, parsed);
    case "factories":
      return await cmdFactories(ctx, parsed);
    case "help":
    case "--help":
    case "-h":
      await cmdHelp(ctx);
      return;
    default:
      fail(ctx, `unknown command: ${verb} (try 'help')`);
  }
}
function defaultNodeIo() {
  return {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    exit: (code) => process.exit(code)
  };
}
async function defaultNodeOpenNoggin() {
  await Promise.resolve().then(() => (init_file(), file_exports));
  const { openNoggin: openNoggin2 } = await Promise.resolve().then(() => (init_noggin_api(), noggin_api_exports));
  const defaultLoc = await defaultNodeLocationLabel();
  return (flags) => openNoggin2(resolveLocation(flags, defaultLoc));
}
async function defaultNodeOpenNogginAt() {
  await Promise.resolve().then(() => (init_file(), file_exports));
  const { openNoggin: openNoggin2 } = await Promise.resolve().then(() => (init_noggin_api(), noggin_api_exports));
  return (location) => openNoggin2(location);
}
async function defaultNodeLocationLabel() {
  return "~/.noggin.yaml";
}
function resolveLocation(flags, defaultLocation) {
  if (flags && flags.noggin) return flags.noggin;
  if (typeof process !== "undefined" && process.env && process.env.NOGGIN) return process.env.NOGGIN;
  return defaultLocation;
}
if (typeof process !== "undefined" && Array.isArray(process.argv)) {
  runCommand(process.argv.slice(2)).catch((e) => {
    process.stderr.write(`noggin: ${e && e.message ? e.message : e}
`);
    process.exit(1);
  });
}
export {
  runCommand
};
