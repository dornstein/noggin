// Small event-emitter helper. The framework doesn't depend on the
// engine's `Event<T>` type because we ship as a standalone package; we
// re-implement the tiny subset we need (subscribe + emit + dispose).

import type { RpcDisposable } from './transport.ts';

/**
 * Minimal listener fan-out. Callers `add` a handler and get a
 * `RpcDisposable`; `emit` invokes every current handler synchronously.
 * Errors thrown by handlers are caught and dropped (the emitter doesn't
 * propagate them) so a misbehaving listener can't break the whole
 * dispatch.
 */
export class Emitter<T> {
  private readonly listeners = new Set<(payload: T) => void>();

  add(handler: (payload: T) => void): RpcDisposable {
    this.listeners.add(handler);
    return { dispose: () => { this.listeners.delete(handler); } };
  }

  emit(payload: T): void {
    // Snapshot first so a handler that unsubscribes itself doesn't
    // corrupt the iteration.
    for (const h of [...this.listeners]) {
      try { h(payload); } catch { /* swallow */ }
    }
  }

  clear(): void {
    this.listeners.clear();
  }

  get size(): number {
    return this.listeners.size;
  }
}
