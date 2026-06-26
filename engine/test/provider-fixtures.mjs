// Shared scaffolding for cross-provider behavioural tests.
//
// Two utilities here:
//
//   makeBrowserStoragePair() — simulates two same-origin browser
//   windows sharing one localStorage. Writes through either window's
//   `storage` dispatch DOM `storage` events to the OTHER window only,
//   matching the browser spec (the writing window does not receive its
//   own event). Used by the multi-instance + parity suites to exercise
//   `localstorage://` outside of Playwright.
//
//   waitFor(fn, opts) — polls until `fn()` is truthy or times out.
//   Used to wait for fs.watch reloads (file://) and storage events
//   (localstorage://) without sleeping arbitrarily.

import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Build a tuple of two storage objects that share a single backing
 * Map. Each has its own `__window` (an EventTarget-like shim with
 * `addEventListener`/`removeEventListener`). `setItem`/`removeItem` on
 * one storage fires a `storage` event on the OTHER window only.
 *
 * Returned objects are spec-faithful enough for `LocalStorageNoggin`
 * to consume: it reads `storage.__window` for event subscription and
 * filters events by `e.key` + `e.storageArea`.
 */
export function makeBrowserStoragePair() {
  const data = new Map();

  function makeWindow() {
    const listeners = new Set();
    return {
      win: {
        addEventListener: (type, fn) => { if (type === 'storage') listeners.add(fn); },
        removeEventListener: (type, fn) => { if (type === 'storage') listeners.delete(fn); },
      },
      listeners,
    };
  }

  const A = makeWindow();
  const B = makeWindow();

  let storageA;
  let storageB;

  function makeStorage(otherListeners, getReceiverStorage) {
    return {
      __window: null, // attached below
      getItem(k) { return data.has(k) ? data.get(k) : null; },
      setItem(k, v) {
        const newValue = String(v);
        const oldValue = data.has(k) ? data.get(k) : null;
        data.set(k, newValue);
        // The receiver sees its OWN storage as `storageArea`, matching
        // the real browser (where both tabs share the singleton).
        const receiverStorage = getReceiverStorage();
        for (const fn of [...otherListeners]) {
          try { fn({ key: k, newValue, oldValue, storageArea: receiverStorage }); } catch { /* listener errors don't propagate */ }
        }
      },
      removeItem(k) {
        const oldValue = data.has(k) ? data.get(k) : null;
        data.delete(k);
        const receiverStorage = getReceiverStorage();
        for (const fn of [...otherListeners]) {
          try { fn({ key: k, newValue: null, oldValue, storageArea: receiverStorage }); } catch { /* ignore */ }
        }
      },
    };
  }

  storageA = makeStorage(B.listeners, () => storageB);
  storageB = makeStorage(A.listeners, () => storageA);
  storageA.__window = A.win;
  storageB.__window = B.win;

  return { storageA, storageB };
}

/**
 * Poll `fn()` until it returns truthy, or throw after `timeoutMs`.
 * Default 1000ms / 10ms step. Use for fs.watch / storage event sync
 * where the change is observable but not synchronous to the writer.
 */
export async function waitFor(fn, { timeoutMs = 1000, stepMs = 10, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) { lastErr = e; }
    await sleep(stepMs);
  }
  if (lastErr) throw lastErr;
  throw new Error(`waitFor timed out: ${label}`);
}
