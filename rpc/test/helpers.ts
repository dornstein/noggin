// Shared test helpers for the rpc suite.

/**
 * Drain one microtask cycle. Lets `queueMicrotask`-deferred work in
 * MemoryTransport propagate before the test asserts.
 */
export function tick(): Promise<void> {
  return new Promise<void>((resolve) => { queueMicrotask(() => resolve()); });
}
