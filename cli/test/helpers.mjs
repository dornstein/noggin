// Shared test helpers for the noggin CLI golden suite.
//
// Each test gets its own temp noggin file via `makeTempNoggin`. The CLI is
// invoked through `runCli`, which spawns the bundled noggin.mjs in a subprocess
// with NOGGIN_FILE pointing at the temp file and returns parsed output.
//
// Dynamic fields (keys, timestamps) are stripped via `redact` so assertions
// can deep-equal against stable expected shapes.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CLI_PATH = path.resolve(HERE, '..', 'noggin.mjs');

const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/;
const KEY_RE = /i-\d{8}-\d{6}-[0-9a-f]{6}/;

/** Create a fresh temp noggin file path. Caller is responsible for cleanup via `cleanup()`. */
export function makeTempNoggin(initial) {
  const dir = mkdtempSync(path.join(tmpdir(), 'noggin-test-'));
  const file = path.join(dir, 'noggin.yaml');
  if (initial !== undefined) {
    const text = typeof initial === 'string' ? initial : yaml.dump(initial, { noRefs: true, lineWidth: 100, sortKeys: false });
    writeFileSync(file, text, 'utf8');
  }
  return {
    file,
    dir,
    read() {
      if (!existsSync(file)) return null;
      return yaml.load(readFileSync(file, 'utf8'));
    },
    readText() {
      return existsSync(file) ? readFileSync(file, 'utf8') : null;
    },
    cleanup() {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

/**
 * Run the CLI with the given argv. The first form passes `file` explicitly
 * via $NOGGIN_FILE; pass `null` to test default-file resolution.
 */
export function runCli(args, { file, env, cwd } = {}) {
  const childEnv = { ...process.env, ...(env || {}) };
  if (file !== undefined) {
    if (file === null) delete childEnv.NOGGIN_FILE;
    else childEnv.NOGGIN_FILE = file;
  }
  // Always isolate HOME so the default-file resolution can't touch the
  // developer's real ~/.noggin.yaml. Tests that exercise the default path
  // override HOME explicitly via the `env` option.
  if (!('HOME' in (env || {})) && !('USERPROFILE' in (env || {}))) {
    const sandbox = mkdtempSync(path.join(tmpdir(), 'noggin-home-'));
    childEnv.HOME = sandbox;
    childEnv.USERPROFILE = sandbox;
  }
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    env: childEnv,
    cwd: cwd || tmpdir(),
    encoding: 'utf8',
  });
  let json = null;
  if (args.includes('--json') && result.stdout.trim()) {
    try { json = JSON.parse(result.stdout); } catch { /* leave null */ }
  }
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    json,
  };
}

/** Replace timestamps and item keys in any structure with placeholders. */
export function redact(value, seen = new Map()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value
      .replace(new RegExp(ISO_RE, 'g'), '<TS>')
      .replace(new RegExp(KEY_RE, 'g'), (m) => {
        if (!seen.has(m)) seen.set(m, `<KEY${seen.size + 1}>`);
        return seen.get(m);
      });
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, seen);
    return out;
  }
  return value;
}

/** Collapse a Store into a position-keyed shape for easier assertions. */
export function summarize(store) {
  if (!store) return null;
  const byParent = new Map();
  for (const item of store.items) {
    const k = item.parentKey || null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(item);
  }
  const keyToPath = new Map();
  function walk(parentKey, prefix) {
    const kids = byParent.get(parentKey) || [];
    return kids.map((item, idx) => {
      const pos = idx + 1;
      const itemPath = `${prefix}/${pos}`;
      keyToPath.set(item.key, itemPath);
      return {
        path: itemPath,
        title: item.title,
        done: Boolean(item.done),
        notes: (item.notes || []).map((n) => n.text),
        children: walk(item.key, itemPath),
      };
    });
  }
  const roots = walk(null, '');
  return {
    active: store.active ? keyToPath.get(store.active) || `<orphan:${store.active}>` : null,
    roots,
  };
}

/**
 * Pluck the full ViewNode for a verb's target out of a CurrentTreeView.
 * The view is a recursive tree rooted at `view.items`; walk it to find
 * the node whose `key === targetKey`.
 */
export function getTarget(view) {
  if (!view || !Array.isArray(view.items) || view.items.length === 0) return null;
  const stack = [...view.items];
  while (stack.length) {
    const node = stack.pop();
    if (node.key === view.targetKey) return node;
    if (Array.isArray(node.children)) stack.push(...node.children);
  }
  return null;
}

/** Build a small fixture store via a fluent builder. Returns YAML text. */
export function buildFixture(spec) {
  // spec: { active?: '1/2', roots: [{ title, done?, notes?, children?: [...] }] }
  const items = [];
  let counter = 0;
  let activeKey = null;
  function newKey() {
    counter++;
    const n = String(counter).padStart(6, '0');
    return `i-20260101-000000-${n.padStart(6, '0')}`;
  }
  function walk(parentKey, kids, prefix) {
    kids.forEach((kid, idx) => {
      const key = newKey();
      const pos = idx + 1;
      const itemPath = prefix ? `${prefix}/${pos}` : String(pos);
      items.push({
        key,
        parentKey,
        title: kid.title,
        done: Boolean(kid.done),
        createdAt: '2026-01-01T00:00:00.000Z',
        notes: (kid.notes || []).map((text) => ({ timestamp: '2026-01-01T00:00:00.000Z', text })),
      });
      if (kid.active) activeKey = key;
      if (spec.active === itemPath) activeKey = key;
      walk(key, kid.children || [], itemPath);
    });
  }
  walk(null, spec.roots || [], '');
  return yaml.dump(
    { schemaVersion: 1, active: activeKey, items },
    { noRefs: true, lineWidth: 100, sortKeys: false },
  );
}
