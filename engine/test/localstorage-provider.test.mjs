// Tests for the localStorage provider. Uses a tiny in-memory Storage
// shim so the test stays portable (no DOM required, no extra deps).

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { openNoggin, providers, verbs } from '../noggin-api.mjs';
import {
  openLocalStorageNoggin,
  localStorageKeyFor,
  localStorageProvider,
  DEFAULT_STORAGE_SLOT,
} from '../providers/localstorage.mjs';

/**
 * Minimal in-memory Storage implementation. Matches the bits of the
 * DOM Storage interface the provider touches.
 */
class FakeStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
  get length() { return this.map.size; }
}

describe('localstorage provider — registration', () => {
  it('registers under the localstorage scheme on import', () => {
    assert.equal(providers.get('localstorage'), localStorageProvider);
  });
});

describe('localstorage provider — slot parsing', () => {
  it('extracts the slot from a localstorage:// URL', () => {
    assert.equal(localStorageKeyFor('localstorage://groceries'), 'noggin:groceries');
  });

  it('tolerates the no-double-slash variant', () => {
    assert.equal(localStorageKeyFor('localstorage:groceries'), 'noggin:groceries');
  });

  it('falls back to the default slot when missing', () => {
    assert.equal(localStorageKeyFor(''), `noggin:${DEFAULT_STORAGE_SLOT}`);
    assert.equal(localStorageKeyFor('localstorage://'), `noggin:${DEFAULT_STORAGE_SLOT}`);
  });

  it('handles bare slot names too', () => {
    assert.equal(localStorageKeyFor('myslot'), 'noggin:myslot');
  });
});

describe('localstorage provider — basic verb flow', () => {
  let storage;
  beforeEach(() => { storage = new FakeStorage(); });

  it('persists items across reopens of the same slot', async () => {
    const n1 = await openLocalStorageNoggin({ slot: 'todo', storage });
    await verbs.add(n1, { title: 'buy milk' });
    await verbs.add(n1, { title: 'walk dog' });
    await n1.dispose();

    const n2 = await openLocalStorageNoggin({ slot: 'todo', storage });
    assert.equal(n2.items.length, 2);
    assert.deepEqual(n2.items.map((i) => i.title), ['buy milk', 'walk dog']);
    await n2.dispose();
  });

  it('isolates separate slots', async () => {
    const a = await openLocalStorageNoggin({ slot: 'a', storage });
    const b = await openLocalStorageNoggin({ slot: 'b', storage });
    await verbs.add(a, { title: 'A1' });
    await verbs.add(b, { title: 'B1' });
    await verbs.add(b, { title: 'B2' });
    assert.equal(a.items.length, 1);
    assert.equal(b.items.length, 2);
    await a.dispose();
    await b.dispose();
  });

  it('reports location and describe correctly', async () => {
    const n = await openLocalStorageNoggin({ slot: 'demo', storage });
    assert.equal(n.location, 'localstorage://demo');
    assert.equal(n.describe(), 'localstorage://demo');
    await n.dispose();
  });

  it('writes YAML to the underlying storage key', async () => {
    const n = await openLocalStorageNoggin({ slot: 'demo', storage });
    await verbs.add(n, { title: 'hello' });
    const raw = storage.getItem('noggin:demo');
    assert.match(raw, /title:\s*hello/);
    assert.match(raw, /schemaVersion:\s*1/);
    await n.dispose();
  });
});

describe('localstorage provider — openNoggin dispatch', () => {
  it('routes localstorage:// URLs to this provider', async () => {
    const storage = new FakeStorage();
    const n = await openNoggin('localstorage://routed', { storage });
    assert.equal(n.location, 'localstorage://routed');
    await verbs.add(n, { title: 'routed' });
    assert.equal(storage.getItem('noggin:routed').includes('routed'), true);
    await n.dispose();
  });
});

describe('localstorage provider — change events', () => {
  it('fires onDidChange on each apply with a non-empty diff', async () => {
    const storage = new FakeStorage();
    const n = await openLocalStorageNoggin({ slot: 'events', storage });
    const events = [];
    const sub = n.onDidChange((e) => events.push(e));
    await verbs.add(n, { title: 'one' });
    await verbs.add(n, { title: 'two' });
    sub.dispose();
    assert.equal(events.length, 2);
    assert.equal(events[0].length, 1);
    assert.equal(events[0][0].kind, 'added');
    await n.dispose();
  });
});

describe('localstorage provider — convenience methods', () => {
  it('reset() wipes the slot and fires onDidChange', async () => {
    const storage = new FakeStorage();
    const n = await openLocalStorageNoggin({ slot: 'wipe', storage });
    await verbs.add(n, { title: 'tmp' });
    let fired = false;
    const sub = n.onDidChange(() => { fired = true; });
    await n.reset();
    assert.equal(n.items.length, 0);
    assert.equal(fired, true);
    assert.equal(storage.getItem('noggin:wipe'), null);
    sub.dispose();
    await n.dispose();
  });

  it('loadDocument() replaces the slot wholesale', async () => {
    const storage = new FakeStorage();
    const n = await openLocalStorageNoggin({ slot: 'replace', storage });
    await n.loadDocument({
      schemaVersion: 1,
      active: null,
      items: [
        { key: 'a1', parentKey: null, title: 'replaced', done: false, notes: [] },
      ],
    });
    assert.equal(n.items.length, 1);
    assert.equal(n.items[0].title, 'replaced');
    await n.dispose();
  });

  it('hasData() reflects current slot contents', async () => {
    const storage = new FakeStorage();
    const n = await openLocalStorageNoggin({ slot: 'has', storage });
    assert.equal(n.hasData(), false);
    await verbs.add(n, { title: 'x' });
    assert.equal(n.hasData(), true);
    await n.reset();
    assert.equal(n.hasData(), false);
    await n.dispose();
  });

  it('snapshot() returns the current document', async () => {
    const storage = new FakeStorage();
    const n = await openLocalStorageNoggin({ slot: 'snap', storage });
    await verbs.add(n, { title: 'snap1' });
    const snap = n.snapshot();
    assert.equal(snap.items.length, 1);
    assert.equal(snap.items[0].title, 'snap1');
    await n.dispose();
  });
});

describe('localstorage provider — same-tab drift polling', () => {
  it('detects out-of-band writes and fires onDidChange within poll interval', async () => {
    // Same-tab out-of-band writes (dev-tools, secondary scripts,
    // node-localstorage shims) don't dispatch the DOM `storage`
    // event, so the provider must actively poll to notice them.
    const storage = new FakeStorage();
    const n = await openLocalStorageNoggin({
      slot: 'drift',
      storage,
      pollIntervalMs: 10,
    });
    await verbs.add(n, { title: 'original' });
    assert.equal(n.items.length, 1);

    const events = [];
    const sub = n.onDidChange((e) => events.push(e));

    // Out-of-band mutation: wipe the slot without going through
    // apply / reset. The cached `_doc` is stale until the poll
    // notices the diff.
    storage.removeItem('noggin:drift');
    assert.equal(n.items.length, 1, 'cached doc is stale immediately after the raw write');

    await waitFor(() => events.length > 0, 500);
    sub.dispose();

    assert.equal(n.items.length, 0);
    assert.equal(events.length, 1, 'poll should fire onDidChange exactly once for the observed diff');
    await n.dispose();
  });

  it('is a silent no-op when the slot matches the cached doc', async () => {
    const storage = new FakeStorage();
    const n = await openLocalStorageNoggin({
      slot: 'quiet',
      storage,
      pollIntervalMs: 10,
    });
    await verbs.add(n, { title: 'unchanged' });
    const events = [];
    const sub = n.onDidChange((e) => events.push(e));
    // Wait long enough for several polls to run.
    await sleep(60);
    sub.dispose();
    assert.equal(events.length, 0, 'poll must not fire onDidChange when the doc is unchanged');
    await n.dispose();
  });

  it('does not poll when pollIntervalMs is 0', async () => {
    const storage = new FakeStorage();
    const n = await openLocalStorageNoggin({
      slot: 'nopoll',
      storage,
      pollIntervalMs: 0,
    });
    await verbs.add(n, { title: 'first' });
    // Out-of-band wipe — with polling disabled, the noggin will
    // never notice on its own.
    storage.removeItem('noggin:nopoll');
    const events = [];
    const sub = n.onDidChange((e) => events.push(e));
    await sleep(40);
    sub.dispose();
    assert.equal(n.items.length, 1, 'cached doc stays stale without polling');
    assert.equal(events.length, 0);
    await n.dispose();
  });

  it('stops polling after dispose', async () => {
    const storage = new FakeStorage();
    const n = await openLocalStorageNoggin({
      slot: 'stopped',
      storage,
      pollIntervalMs: 10,
    });
    await n.dispose();
    // Post-dispose the noggin is unusable and shouldn't fire.
    // Removing the entry after dispose must not throw or emit.
    storage.removeItem('noggin:stopped');
    await sleep(40);
    // If polling kept running we'd see an unhandled promise error
    // above; making it to here means dispose stopped the timer.
  });
});

describe('localstorage provider — dispose', () => {
  it('rejects apply after dispose', async () => {
    const storage = new FakeStorage();
    const n = await openLocalStorageNoggin({ slot: 'gone', storage });
    await n.dispose();
    await assert.rejects(
      () => verbs.add(n, { title: 'late' }),
      (err) => err.code === 'disposed',
    );
  });
});

// ── Test helpers ────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

