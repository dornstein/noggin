// In-process transport pair used by tests.
//
// `createMemoryTransportPair()` returns `{ a, b }` — two `Transport`s
// wired together so anything `a.send(msg)` is delivered to `b.onMessage`
// and vice versa. Used by the rpc test suite to drive a real
// RpcClient + RpcServer through the same envelope path the production
// transports use.
//
// Delivery is microtask-deferred (queueMicrotask) so callers see
// async semantics matching every other transport — handlers run after
// the call site returns, not synchronously inside `send`. This catches
// re-entrancy bugs the same way production transports would.

import type { RpcMessage } from '../envelope.ts';
import { Emitter } from '../emitter.ts';
import type { RpcDisposable, Transport } from '../transport.ts';

class MemoryTransport implements Transport {
  private peer: MemoryTransport | null = null;
  private readonly messages = new Emitter<RpcMessage>();
  private readonly disconnects = new Emitter<void>();
  private closed = false;

  /** @internal Wire two transports together. Called by the factory. */
  _pairWith(peer: MemoryTransport): void {
    this.peer = peer;
  }

  send(message: RpcMessage): void {
    if (this.closed) {
      throw new Error('MemoryTransport: send after close');
    }
    const target = this.peer;
    if (!target) {
      throw new Error('MemoryTransport: no peer attached');
    }
    queueMicrotask(() => {
      if (!target.closed) target.messages.emit(message);
    });
  }

  onMessage(handler: (message: RpcMessage) => void): RpcDisposable {
    return this.messages.add(handler);
  }

  onDisconnect(handler: () => void): RpcDisposable {
    if (this.closed) {
      queueMicrotask(handler);
      return { dispose: () => {} };
    }
    return this.disconnects.add(handler);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => {
      this.disconnects.emit();
      this.disconnects.clear();
      this.messages.clear();
    });
    // Cascade: closing one half closes the other so both sides see
    // disconnect. Match real transports (a TCP socket closing on one
    // end fires close on the other end too).
    const peer = this.peer;
    this.peer = null;
    if (peer && !peer.closed) peer.close();
  }
}

/**
 * @public
 * Create a connected pair of in-process transports. Anything `a.send()`
 * is delivered to `b.onMessage` and vice versa. Closing either side
 * propagates to the other.
 */
export function createMemoryTransportPair(): { a: Transport; b: Transport } {
  const a = new MemoryTransport();
  const b = new MemoryTransport();
  a._pairWith(b);
  b._pairWith(a);
  return { a, b };
}
