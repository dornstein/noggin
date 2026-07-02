// Lifecycle / dispose semantics across providers.
//
// Pins the dispose contract so that a future refactor (option B's
// URL dedupe with refcounted dispose, or option C's backend/handle
// split) can be carried out without breaking consumers.
//
// Each provider is exercised against the same suite of behaviours:
//   - idempotent dispose (double-dispose doesn't throw)
//   - dispose of one handle doesn't break a peer handle on the same target
//   - in-flight apply settles before dispose resolves
//   - post-dispose accessor behaviour is consistent
//   - post-dispose apply behaviour (currently varies per provider —
//     pinned here so option B can unify the contract)
//
// Where current behaviour diverges from the eventual contract, the
// test is marked `it.todo`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { openNoggin, verbs, NogginError } from '../noggin-api.mjs';
import '../providers/file.mjs';
import '../providers/memory.mjs';
import '../providers/localstorage.mjs';

import { makeBrowserStoragePair, waitFor } from './provider-fixtures.mjs';

// Helpers to open one or two handles per provider for symmetric testing.
function withTempFile() {
  const dir = mkdtempSync(path.join(tmpdir(), 'noggin-dispose-'));
  const file = path.join(dir, '.noggin.yaml');
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ── Idempotent dispose ─────────────────────────────────────────────────────

describe('dispose is idempotent', () => {
  it('file://', async () => {
    const { file, cleanup } = withTempFile();
    try {
      const n = await openNoggin(`file://${file}`, { watch: true });
      await n.dispose();
      // Second dispose must resolve without throwing.
      await n.dispose();
    } finally { cleanup(); }
  });

  it('memory://', async () => {
    const n = await openNoggin('memory://dispose-idem-mem');
    await n.dispose();
    await n.dispose();
  });

  it('localstorage://', async () => {
    const { storageA } = makeBrowserStoragePair();
    const n = await openNoggin('localstorage://dispose-idem-ls', { storage: storageA });
    await n.dispose();
    await n.dispose();
  });
});

// ── Peer isolation ─────────────────────────────────────────────────────────

describe('disposing one handle does not break a peer on the same target', () => {
  it('file://: peer can still apply and read after a sibling disposes', async () => {
    const { file, cleanup } = withTempFile();
    try {
      const a = await openNoggin(`file://${file}`, { watch: true });
      const b = await openNoggin(`file://${file}`, { watch: true });

      await verbs.push(a, { title: 'first' });
      await waitFor(() => b.items.length === 1, { label: 'b sees first' });

      await a.dispose();

      // b is still alive; it can mutate and read.
      await verbs.add(b, { title: 'after-a-dispose' });
      assert.equal(b.items.length, 2, 'b\'s own writes are observable');

      await b.dispose();
    } finally { cleanup(); }
  });

  it('memory://: peer survives sibling dispose and shares state', async () => {
    const a = await openNoggin('memory://dispose-iso');
    const b = await openNoggin('memory://dispose-iso');
    try {
      await verbs.push(a, { title: 'one' });
      await a.dispose();

      // b is still alive AND shared the backend with a. After a's
      // dispose, b still sees 'one' and can add more.
      assert.equal(b.items.length, 1, 'b retains shared state after a disposes');
      await verbs.push(b, { title: 'two' });
      assert.equal(b.items.length, 2);
    } finally { await b.dispose(); }
  });

  it('localstorage://: peer survives sibling dispose (cross-window)', async () => {
    const { storageA, storageB } = makeBrowserStoragePair();
    // Distinct underlying instances (one per window) via shared:false.
    const a = await openNoggin('localstorage://dispose-ls-iso', { storage: storageA, shared: false });
    const b = await openNoggin('localstorage://dispose-ls-iso', { storage: storageB, shared: false });
    try {
      await verbs.push(a, { title: 'shared' });
      // Cross-window event refreshes b synchronously.
      assert.equal(b.items.length, 1);

      await a.dispose();

      // b's listener is still wired; b can still observe its own writes.
      await verbs.add(b, { title: 'after' });
      assert.equal(b.items.length, 2);
    } finally { await b.dispose(); }
  });
});

// ── In-flight apply ────────────────────────────────────────────────────────

describe('dispose waits for in-flight apply', () => {
  it('file://: dispose resolves after the in-flight apply settles', async () => {
    const { file, cleanup } = withTempFile();
    try {
      const n = await openNoggin(`file://${file}`, { watch: true });
      // Issue an apply and immediately call dispose without awaiting
      // the apply. The apply must still complete and persist to disk.
      const applyPromise = verbs.push(n, { title: 'pending' });
      const disposePromise = n.dispose();
      await Promise.all([applyPromise, disposePromise]);
      // Re-open to confirm the write landed on disk.
      const peer = await openNoggin(`file://${file}`);
      assert.equal(peer.items.length, 1);
      assert.equal(peer.items[0].title, 'pending');
      await peer.dispose();
    } finally { cleanup(); }
  });

  it('memory://: dispose waits for in-flight apply', async () => {
    const n = await openNoggin('memory://dispose-inflight');
    const applyPromise = verbs.push(n, { title: 'pending' });
    const disposePromise = n.dispose();
    await Promise.all([applyPromise, disposePromise]);
    // After dispose, accessors should reflect the pending apply.
    assert.equal(n.items.length, 1);
  });
});

// ── Post-dispose accessor behaviour ─────────────────────────────────────────

describe('post-dispose accessors return last-known state without throwing', () => {
  it('file://', async () => {
    const { file, cleanup } = withTempFile();
    try {
      const n = await openNoggin(`file://${file}`, { watch: true });
      await verbs.push(n, { title: 'snap' });
      await n.dispose();
      // Reading after dispose returns the snapshot, doesn't throw.
      assert.equal(n.items.length, 1);
      assert.equal(n.items[0].title, 'snap');
    } finally { cleanup(); }
  });

  it('memory://', async () => {
    const n = await openNoggin('memory://dispose-snap-mem');
    await verbs.push(n, { title: 'snap' });
    await n.dispose();
    assert.equal(n.items.length, 1);
  });

  it('localstorage://', async () => {
    const { storageA } = makeBrowserStoragePair();
    const n = await openNoggin('localstorage://dispose-snap-ls', { storage: storageA });
    await verbs.push(n, { title: 'snap' });
    await n.dispose();
    assert.equal(n.items.length, 1);
  });
});

// ── Post-dispose apply behaviour ────────────────────────────────────────────

describe('post-dispose apply behaviour (pinned, divergent today)', () => {
  // The eventual contract — and what option B should land on — is that
  // applying through a disposed handle rejects with a stable code.
  // Memory does this today; file and localstorage do not.

  it('memory:// rejects apply after dispose', async () => {
    const n = await openNoggin('memory://dispose-post-mem');
    await n.dispose();
    await assert.rejects(verbs.push(n, { title: 'x' }), (err) => {
      assert.ok(err instanceof NogginError, 'is NogginError');
      assert.equal(err.code, 'disposed');
      return true;
    });
  });

  it('file:// rejects apply after dispose', async () => {
    const { file, cleanup } = withTempFile();
    try {
      const n = await openNoggin(`file://${file}`, { watch: true });
      await n.dispose();
      await assert.rejects(verbs.push(n, { title: 'x' }), (err) => err instanceof NogginError && err.code === 'disposed');
    } finally { cleanup(); }
  });

  it('localstorage:// rejects apply after dispose', async () => {
    const { storageA } = makeBrowserStoragePair();
    const n = await openNoggin('localstorage://dispose-post', { storage: storageA });
    await n.dispose();
    await assert.rejects(verbs.push(n, { title: 'x' }), (err) => err instanceof NogginError && err.code === 'disposed');
  });
});

// ── Refcount semantics (option B target) ────────────────────────────────────

describe('refcount semantics for shared backends', () => {
  // Two `openNoggin(url)` calls return handles that share the
  // underlying provider; the backend is torn down only after the LAST
  // handle disposes.

  it('two openNoggin calls share state until both are disposed', async () => {
    const a = await openNoggin('memory://dispose-refcount');
    const b = await openNoggin('memory://dispose-refcount');
    try {
      await verbs.push(a, { title: 'shared' });
      assert.equal(b.items.length, 1, 'b sees a\'s write');

      await a.dispose();
      // a is gone; b is still alive and can mutate.
      await verbs.add(b, { title: 'b-only' });
      assert.equal(b.items.length, 2);
    } finally { await b.dispose(); }
  });

  it('a fresh openNoggin after both handles are disposed gets a new clean state', async () => {
    const a = await openNoggin('memory://dispose-refcount2');
    await verbs.push(a, { title: 'before-teardown' });
    await a.dispose();

    // Backend should have been torn down. A fresh open sees empty.
    const c = await openNoggin('memory://dispose-refcount2');
    try {
      assert.equal(c.items.length, 0, 'no stale state from torn-down backend');
    } finally { await c.dispose(); }
  });

  it('rejecting apply on a disposed handle does NOT affect peers still alive', async () => {
    const a = await openNoggin('memory://dispose-peer-alive');
    const b = await openNoggin('memory://dispose-peer-alive');
    try {
      await a.dispose();
      await assert.rejects(verbs.push(a, { title: 'x' }), (err) => err.code === 'disposed');
      // b still works.
      await verbs.push(b, { title: 'ok' });
      assert.equal(b.items.length, 1);
    } finally { await b.dispose(); }
  });
});
