// Multi-instance behavioural contract.
//
// Pins the cross-instance behaviour the engine commits to so that a
// future refactor (URL dedupe in `openNoggin`, or a backend/handle
// split) can be carried out under a behavioural safety net rather
// than by inspection.
//
// What the contract says, in English:
//
//   (1) Convergence. Two `openNoggin(sameTarget)` calls eventually
//       converge: a mutation through one handle is observable by the
//       other's accessors, and fires its `onDidChange`.
//
//   (2) Concurrent apply. Two handles can call `apply()` concurrently
//       and the engine serializes the writes. No torn documents, no
//       lost updates within a process.
//
//   (3) Ordering. Within a single handle's perspective, change events
//       arrive in apply-order.
//
// Providers covered: file:// (with watch), memory:// (via the
// registry), and localstorage:// (via a Node-side storage shim
// pair). Where a provider does not currently meet the contract, the
// case is marked `it.todo` — these are the assertions B will green.
//
// Cross-tab localstorage:// behaviour is covered separately by the
// Playwright suite at docs/site/tests/playground.spec.ts.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { openNoggin, verbs } from '../noggin-api.mjs';
import '../providers/file.mjs';
import '../providers/memory.mjs';
import '../providers/localstorage.mjs';

import { makeBrowserStoragePair, waitFor } from './provider-fixtures.mjs';

// ── (1) Convergence ────────────────────────────────────────────────────────

describe('multi-instance convergence: file:// with watch', () => {
  it('handle B sees handle A\'s mutation and fires its own change', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'noggin-multi-'));
    const file = path.join(dir, '.noggin.yaml');
    try {
      const a = await openNoggin(`file://${file}`, { watch: true });
      const b = await openNoggin(`file://${file}`, { watch: true });

      const bEvents = [];
      const sub = b.onDidChange((e) => bEvents.push(e));

      await verbs.push(a, { title: 'from-a' });

      await waitFor(() => b.items.length === 1, { label: 'b reflects a\'s write' });
      assert.equal(b.items[0].title, 'from-a');
      assert.ok(bEvents.length >= 1, 'b fired at least one change event');

      sub.dispose();
      await a.dispose();
      await b.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('round-trip: each handle observes the other\'s writes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'noggin-multi-'));
    const file = path.join(dir, '.noggin.yaml');
    try {
      const a = await openNoggin(`file://${file}`, { watch: true });
      const b = await openNoggin(`file://${file}`, { watch: true });

      await verbs.push(a, { title: 'a-1' });
      await waitFor(() => b.items.length === 1, { label: 'b sees a-1' });

      await verbs.push(b, { title: 'b-1' });
      await waitFor(() => a.items.length === 2, { label: 'a sees b-1' });

      const aTitles = a.items.map((i) => i.title).sort();
      const bTitles = b.items.map((i) => i.title).sort();
      assert.deepEqual(aTitles, ['a-1', 'b-1']);
      assert.deepEqual(bTitles, ['a-1', 'b-1']);

      await a.dispose();
      await b.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('multi-instance convergence: memory://', () => {
  it('handle B sees handle A\'s mutation (shared via openNoggin dedupe)', async () => {
    const a = await openNoggin('memory://mi-memory-share');
    const b = await openNoggin('memory://mi-memory-share');
    try {
      const bEvents = [];
      const sub = b.onDidChange((e) => bEvents.push(e));

      await verbs.push(a, { title: 'from-a' });
      assert.equal(b.items.length, 1, 'b sees a\'s write');
      assert.equal(b.items[0].title, 'from-a');
      assert.ok(bEvents.length >= 1, 'b fires change event for a\'s write');

      sub.dispose();
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });

  it('different URLs remain isolated (sanity)', async () => {
    const a = await openNoggin('memory://mi-iso-aaa');
    const b = await openNoggin('memory://mi-iso-bbb');
    try {
      await verbs.push(a, { title: 'a-only' });
      assert.equal(b.items.length, 0);
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });

  it('opts.shared === false bypasses dedupe', async () => {
    const a = await openNoggin('memory://mi-unshared', { shared: false });
    const b = await openNoggin('memory://mi-unshared', { shared: false });
    try {
      await verbs.push(a, { title: 'a-only' });
      assert.equal(b.items.length, 0, 'unshared handles are fully independent');
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });
});

describe('multi-instance convergence: localstorage:// same tab', () => {
  // Two `openNoggin('localstorage://x')` calls within one tab now
  // share state via the engine's dedupe: both wrappers proxy the
  // same underlying LocalStorageNoggin and its single subscriber set.
  // This is the "two trees on one page" case from the playground.

  it('peer\'s accessors converge after a same-tab peer write', async () => {
    const { storageA } = makeBrowserStoragePair();
    const a = await openNoggin('localstorage://mi-ls-conv', { storage: storageA });
    const b = await openNoggin('localstorage://mi-ls-conv', { storage: storageA });
    try {
      await verbs.push(a, { title: 'from-a' });
      assert.equal(b.items.length, 1);
      assert.equal(b.items[0].title, 'from-a');
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });

  it('peer fires onDidChange without a kick', async () => {
    const { storageA } = makeBrowserStoragePair();
    const a = await openNoggin('localstorage://mi-ls-evt', { storage: storageA });
    const b = await openNoggin('localstorage://mi-ls-evt', { storage: storageA });
    try {
      const bEvents = [];
      const sub = b.onDidChange((e) => bEvents.push(e));

      await verbs.push(a, { title: 'from-a' });
      assert.ok(bEvents.length >= 1, 'b fires change event without a peer-side apply');
      assert.equal(b.items.length, 1);

      sub.dispose();
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });
});

describe('multi-instance convergence: localstorage:// cross window', () => {
  it('cross-window peer\'s accessors converge and onDidChange fires', async () => {
    // Two storage objects sharing one backing Map = two browser tabs.
    // Use `shared: false` so each call gets a distinct underlying
    // LocalStorageNoggin pointed at its own window's storage — that
    // is what the cross-window simulation needs. (Without it, the
    // second open would dedupe to the first and `storageB` would be
    // ignored.) In a real browser, two tabs are two processes and
    // the dedupe map is per-process, so this opt-out isn't needed.
    const { storageA, storageB } = makeBrowserStoragePair();
    const a = await openNoggin('localstorage://mi-ls-xwin', { storage: storageA, shared: false });
    const b = await openNoggin('localstorage://mi-ls-xwin', { storage: storageB, shared: false });
    try {
      const bEvents = [];
      const sub = b.onDidChange((e) => bEvents.push(e));

      await verbs.push(a, { title: 'from-a' });
      // The DOM `storage` event is dispatched synchronously to the
      // OTHER window's listeners, so `b` sees the write immediately.
      assert.equal(b.items.length, 1);
      assert.equal(b.items[0].title, 'from-a');
      assert.ok(bEvents.length >= 1, 'b fired at least one change event');

      sub.dispose();
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });
});

// ── (2) Concurrent apply / (3) ordering ─────────────────────────────────────

describe('multi-instance concurrent apply: file://', () => {
  it('two handles applying in parallel: no lost updates, total = N1 + N2', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'noggin-multi-'));
    const file = path.join(dir, '.noggin.yaml');
    try {
      const a = await openNoggin(`file://${file}`, { watch: true });
      const b = await openNoggin(`file://${file}`, { watch: true });

      const N = 10;
      const aWork = Array.from({ length: N }, (_, i) => verbs.add(a, { title: `a-${i}` }));
      const bWork = Array.from({ length: N }, (_, i) => verbs.add(b, { title: `b-${i}` }));
      await Promise.all([...aWork, ...bWork]);

      // Wait for the file watcher to deliver any trailing reloads to
      // both handles so their accessors converge.
      await waitFor(() => a.items.length === 2 * N && b.items.length === 2 * N, {
        label: 'both handles see all 2N items',
        timeoutMs: 2000,
      });

      const titles = a.items.map((i) => i.title).sort();
      const want = [...Array(N)].flatMap((_, i) => [`a-${i}`, `b-${i}`]).sort();
      assert.deepEqual(titles, want, 'every apply landed exactly once');

      await a.dispose();
      await b.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('multi-instance concurrent apply: memory://', () => {
  it('single-instance memory:// apply queue serializes (baseline)', async () => {
    const a = await openNoggin('memory://order');
    const N = 20;
    await Promise.all(Array.from({ length: N }, (_, i) => verbs.add(a, { title: `t-${i}` })));
    assert.equal(a.items.length, N, 'all adds landed');
    const titles = a.items.map((i) => i.title);
    // Ordering inside one handle is FIFO by apply enqueue order.
    assert.deepEqual([...titles].sort(), Array.from({ length: N }, (_, i) => `t-${i}`).sort());
    await a.dispose();
  });

  it('two memory:// handles applying in parallel converge to N1+N2 items', async () => {
    const a = await openNoggin('memory://mi-shared-order');
    const b = await openNoggin('memory://mi-shared-order');
    try {
      const N = 5;
      await Promise.all([
        ...Array.from({ length: N }, (_, i) => verbs.add(a, { title: `a-${i}` })),
        ...Array.from({ length: N }, (_, i) => verbs.add(b, { title: `b-${i}` })),
      ]);
      assert.equal(a.items.length, 2 * N);
      assert.equal(b.items.length, 2 * N);
      const titles = a.items.map((i) => i.title).sort();
      const want = [...Array(N)].flatMap((_, i) => [`a-${i}`, `b-${i}`]).sort();
      assert.deepEqual(titles, want);
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });
});

// ── (3) Change events arrive in apply-order ─────────────────────────────────

describe('change-event ordering within a single handle', () => {
  it('memory:// fires onDidChange in the order applies resolved', async () => {
    const a = await openNoggin('memory://order-events');
    const seen = [];
    const sub = a.onDidChange((e) => {
      // Memory provider fires the raw ItemChange[] payload.
      const c = Array.isArray(e) ? e : (e?.changes || []);
      seen.push(c[0]?.kind || 'unknown');
    });

    await verbs.add(a, { title: 'one' });
    await verbs.add(a, { title: 'two' });
    await verbs.goto(a, { path: '/2' });
    await verbs.done(a);

    // add → 'added', add → 'added', goto → 'activeChanged',
    // done → first event has 'updated' (set done=true). The done
    // verb also appends a note + activates parent, so multiple
    // changes can land in one event; we look at the first.
    assert.equal(seen.length, 4);
    assert.equal(seen[0], 'added');
    assert.equal(seen[1], 'added');
    assert.equal(seen[2], 'activeChanged');
    assert.ok(['updated', 'activeChanged'].includes(seen[3]), `done first-kind was ${seen[3]}`);

    sub.dispose();
    await a.dispose();
  });
});
