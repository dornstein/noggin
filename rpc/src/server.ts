// RpcServer — peer side of the framework.
//
// Generic, protocol-agnostic. Register handlers by method name; the
// server routes incoming requests, invokes the handler, and sends
// back a response (or error) on the transport.
//
//   server.on('verb.add', async (params) => verbs.add(...));
//   server.notify('noggin.changed', { sessionId, items });
//   server.onDisconnect(() => cleanupSubscriptions());
//
// Engine wiring (i.e. `createNogginRpcServer` that maps every protocol
// method to verbs.X / providers.X / hostServices.X) lives in
// `@noggin/rpc-server` and ships in Phase 2; the framework here is
// just dispatch + correlation + heartbeat reuse.

import type { RpcError, RpcMessage, RpcResponse } from './envelope.ts';
import { isError, isNotification, isPing, isPong, isRequest, isResponse } from './envelope.ts';
import { Emitter } from './emitter.ts';
import { NogginRpcError, toErrorPayload, type RpcFrameworkErrorCode } from './errors.ts';
import type { HeartbeatOptions } from './client.ts';
import type { RpcDisposable, Transport } from './transport.ts';

/** @public Options for `RpcServer`. */
export interface RpcServerOptions {
  /** Heartbeat config. Defaults to `intervalMs: 0` (off). */
  heartbeat?: HeartbeatOptions;
  /** Optional id generator for outgoing pings. Defaults to a monotonic
   *  counter prefixed with `s-ping-`. */
  idGenerator?: () => string;
}

/** Method handler signature. May be sync or async. */
export type RpcHandler<P = unknown, R = unknown> = (params: P) => R | Promise<R>;

/**
 * @public
 * Server side of an RPC channel. Bind a `Transport`, register handlers,
 * optionally `notify(...)` clients out-of-band.
 *
 * Lifecycle: an `RpcServer` mirrors `RpcClient` — one transport, one
 * server. Multiple clients connecting to the same logical server
 * require multiple `RpcServer` instances (one per transport).
 */
export class RpcServer {
  private readonly transport: Transport;
  private readonly opts: Required<RpcServerOptions>;
  private readonly handlers = new Map<string, RpcHandler>();
  private readonly disconnects = new Emitter<void>();
  private readonly subscriptions: RpcDisposable[] = [];
  private nextId = 0;
  private disposed = false;
  private peerDead = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastPingId: string | null = null;
  private lastPongDeadline: ReturnType<typeof setTimeout> | null = null;

  constructor(transport: Transport, opts: RpcServerOptions = {}) {
    this.transport = transport;
    this.opts = {
      heartbeat: {
        intervalMs: opts.heartbeat?.intervalMs ?? 0,
        timeoutMs: opts.heartbeat?.timeoutMs ?? 60_000,
      },
      idGenerator: opts.idGenerator ?? (() => `s-ping-${++this.nextId}`),
    };
    this.subscriptions.push(transport.onMessage((m) => this.handleIncoming(m)));
    this.subscriptions.push(transport.onDisconnect(() => this.handleDisconnect('rpc.disconnected', 'transport disconnected')));
    this.startHeartbeat();
  }

  get connected(): boolean {
    return !this.disposed && !this.peerDead;
  }

  /**
   * Register a handler. Throws if `method` already has a handler —
   * the framework doesn't support chained or layered handlers, and
   * silent overrides cause hard-to-debug routing problems.
   * Returns a `RpcDisposable` that unregisters the handler.
   */
  on<P = unknown, R = unknown>(method: string, handler: RpcHandler<P, R>): RpcDisposable {
    if (this.handlers.has(method)) {
      throw new Error(`RpcServer: handler for '${method}' already registered`);
    }
    this.handlers.set(method, handler as RpcHandler);
    return { dispose: () => {
      if (this.handlers.get(method) === (handler as RpcHandler)) {
        this.handlers.delete(method);
      }
    } };
  }

  /** Push a notification to the connected client. No correlation, no reply. */
  notify(method: string, params?: unknown): void {
    if (!this.connected) throw this.disposedError();
    this.transport.send({ type: 'notification', method, params });
  }

  /** Register a handler for transport disconnect / dispose. */
  onDisconnect(handler: () => void): RpcDisposable {
    return this.disconnects.add(handler);
  }

  /**
   * Dispose the server. Closes the transport, fires `onDisconnect`,
   * clears all registered handlers. Idempotent.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopHeartbeat();
    for (const dispose of this.subscriptions.splice(0)) dispose.dispose();
    this.handlers.clear();
    try { this.transport.close(); } catch { /* swallow */ }
    this.disconnects.emit();
    this.disconnects.clear();
  }

  private async handleIncoming(msg: RpcMessage): Promise<void> {
    if (this.disposed) return;
    if (isRequest(msg)) {
      const handler = this.handlers.get(msg.method);
      if (!handler) {
        this.sendError(msg.id, {
          code: 'rpc.method-not-found',
          message: `no handler registered for '${msg.method}'`,
        });
        return;
      }
      try {
        const result = await handler(msg.params);
        const response: RpcResponse = { type: 'response', id: msg.id, result };
        if (!this.disposed) this.transport.send(response);
      } catch (e) {
        this.sendError(msg.id, toErrorPayload(e));
      }
      return;
    }
    if (isNotification(msg)) {
      // The framework doesn't expose client-initiated notifications
      // upstream; if a handler wants to listen, register it as a
      // method handler. Drop on the floor (matches noggin protocol:
      // every client->server message is a request).
      return;
    }
    if (isPing(msg)) {
      try { this.transport.send({ type: 'pong', id: msg.id }); } catch { /* dying */ }
      return;
    }
    if (isPong(msg)) {
      if (msg.id === this.lastPingId) {
        this.lastPingId = null;
        if (this.lastPongDeadline) {
          clearTimeout(this.lastPongDeadline);
          this.lastPongDeadline = null;
        }
      }
      return;
    }
    if (isResponse(msg) || isError(msg)) {
      // Server doesn't issue requests, so responses/errors are unexpected.
      return;
    }
  }

  private sendError(id: string, payload: ReturnType<typeof toErrorPayload>): void {
    if (this.disposed) return;
    const msg: RpcError = { type: 'error', id, error: payload };
    try { this.transport.send(msg); } catch { /* dying */ }
  }

  private startHeartbeat(): void {
    const interval = this.opts.heartbeat.intervalMs;
    if (!interval || interval <= 0) return;
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), interval);
    if (this.heartbeatTimer && typeof this.heartbeatTimer === 'object' && 'unref' in this.heartbeatTimer) {
      (this.heartbeatTimer as { unref?: () => void }).unref?.();
    }
  }

  private sendHeartbeat(): void {
    if (!this.connected) return;
    if (this.lastPingId) return;
    const id = this.opts.idGenerator();
    this.lastPingId = id;
    try { this.transport.send({ type: 'ping', id }); } catch { return; }
    this.lastPongDeadline = setTimeout(
      () => this.handleDisconnect('rpc.heartbeat-timeout', 'peer did not respond to heartbeat ping'),
      this.opts.heartbeat.timeoutMs ?? 60_000,
    );
    if (this.lastPongDeadline && typeof this.lastPongDeadline === 'object' && 'unref' in this.lastPongDeadline) {
      (this.lastPongDeadline as { unref?: () => void }).unref?.();
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.lastPongDeadline) {
      clearTimeout(this.lastPongDeadline);
      this.lastPongDeadline = null;
    }
    this.lastPingId = null;
  }

  private handleDisconnect(_code: RpcFrameworkErrorCode, _message: string): void {
    if (this.peerDead || this.disposed) return;
    this.peerDead = true;
    this.stopHeartbeat();
    this.disconnects.emit();
  }

  private disposedError(): NogginRpcError {
    if (this.disposed) return new NogginRpcError('rpc.disposed', 'rpc server disposed');
    return new NogginRpcError('rpc.disconnected', 'rpc server disconnected');
  }
}
