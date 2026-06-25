// RpcClient — caller side of the framework.
//
// Wraps a `Transport` and exposes a typed request/notification API:
//
//   await client.request('verb.add', { sessionId, opts });
//   client.notify('host.refocus');
//   client.onNotification((method, params) => …);
//
// Responsibilities:
//   - Correlate outgoing requests with incoming responses by id.
//   - Reject all pending requests when the transport disconnects.
//   - Optional heartbeat: emit pings on an interval; expect pongs
//     within a timeout, otherwise mark disconnected.
//   - Surface unsolicited notifications to the consumer.
//
// Subscriptions are not a framework primitive — the noggin protocol
// builds them on top by combining a `noggin.subscribe` request (returns
// a subscription id) and `noggin.changed` / `noggin.errored`
// notifications keyed off that id. The framework just shuttles bytes.

import type { RpcMessage, RpcRequest, RpcErrorPayload } from './envelope.ts';
import { isError, isNotification, isPing, isPong, isResponse, isRequest } from './envelope.ts';
import { Emitter } from './emitter.ts';
import { NogginRpcError, type RpcFrameworkErrorCode } from './errors.ts';
import type { RpcDisposable, Transport } from './transport.ts';

/** @public Options for `RpcClient` / `RpcServer` heartbeat behaviour. */
export interface HeartbeatOptions {
  /** Send a ping if no message has been sent in this many ms. Default 30000.
   *  Set to 0 to disable heartbeats entirely (e.g. tests, MemoryTransport). */
  intervalMs?: number;
  /** If no pong is received within this many ms after a ping, the
   *  connection is declared dead. Default 60000. */
  timeoutMs?: number;
}

/** @public Options for `RpcClient`. */
export interface RpcClientOptions {
  /** Per-request deadline. Defaults to no timeout. */
  requestTimeoutMs?: number;
  /** Heartbeat configuration. Defaults to `intervalMs: 0` (off). */
  heartbeat?: HeartbeatOptions;
  /** Optional id generator. Defaults to a monotonic counter prefixed
   *  with `c-`. Override to plug in a uuid for cross-process tracing. */
  idGenerator?: () => string;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: NogginRpcError): void;
  timeoutHandle?: ReturnType<typeof setTimeout>;
}

/**
 * @public
 * The caller side of an RPC channel. Construct with a `Transport` (the
 * other end of the transport is presumably wired to an `RpcServer`).
 *
 * Lifecycle: an `RpcClient` is single-use. Once `dispose()` is called
 * or the transport disconnects, every pending request rejects with
 * `rpc.disposed` / `rpc.disconnected`, no further requests are accepted,
 * and the client emits `onDisconnect`.
 */
export class RpcClient {
  private readonly transport: Transport;
  private readonly opts: Required<RpcClientOptions>;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly notifications = new Emitter<{ method: string; params: unknown }>();
  private readonly disconnects = new Emitter<void>();
  private readonly subscriptions: RpcDisposable[] = [];
  private nextId = 0;
  private disposed = false;
  private peerDead = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastPingId: string | null = null;
  private lastPongDeadline: ReturnType<typeof setTimeout> | null = null;

  constructor(transport: Transport, opts: RpcClientOptions = {}) {
    this.transport = transport;
    this.opts = {
      requestTimeoutMs: opts.requestTimeoutMs ?? 0,
      heartbeat: {
        intervalMs: opts.heartbeat?.intervalMs ?? 0,
        timeoutMs: opts.heartbeat?.timeoutMs ?? 60_000,
      },
      idGenerator: opts.idGenerator ?? (() => `c-${++this.nextId}`),
    };
    this.subscriptions.push(transport.onMessage((m) => this.handleIncoming(m)));
    this.subscriptions.push(transport.onDisconnect(() => this.handleDisconnect('rpc.disconnected', 'transport disconnected')));
    this.startHeartbeat();
  }

  /** True until `dispose()` or the transport disconnects. */
  get connected(): boolean {
    return !this.disposed && !this.peerDead;
  }

  /**
   * Send a request and await its response. Rejects with `NogginRpcError`
   * on framework failure (`rpc.*` codes) or with the server's error
   * envelope unwrapped if the handler threw.
   */
  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.connected) {
      return Promise.reject(this.disposedError());
    }
    return new Promise<T>((resolve, reject) => {
      const id = this.opts.idGenerator();
      const pending: PendingRequest = {
        resolve: (v) => resolve(v as T),
        reject,
      };
      if (this.opts.requestTimeoutMs > 0) {
        pending.timeoutHandle = setTimeout(() => {
          this.pending.delete(id);
          reject(new NogginRpcError('rpc.timeout', `request ${method} timed out after ${this.opts.requestTimeoutMs}ms`));
        }, this.opts.requestTimeoutMs);
      }
      this.pending.set(id, pending);
      const msg: RpcRequest = { type: 'request', id, method, params };
      try {
        this.transport.send(msg);
      } catch (e) {
        this.pending.delete(id);
        if (pending.timeoutHandle) clearTimeout(pending.timeoutHandle);
        reject(new NogginRpcError('rpc.disconnected', e instanceof Error ? e.message : String(e)));
      }
    });
  }

  /**
   * Send a fire-and-forget notification. No response, no correlation.
   * Throws synchronously if the client is disposed or the transport
   * rejects the send.
   */
  notify(method: string, params?: unknown): void {
    if (!this.connected) throw this.disposedError();
    this.transport.send({ type: 'notification', method, params });
  }

  /** Register a handler for server-pushed notifications. */
  onNotification(handler: (method: string, params: unknown) => void): RpcDisposable {
    return this.notifications.add((e) => handler(e.method, e.params));
  }

  /** Register a handler for transport disconnect / dispose. */
  onDisconnect(handler: () => void): RpcDisposable {
    return this.disconnects.add(handler);
  }

  /**
   * Dispose the client. Rejects every pending request with
   * `rpc.disposed`, closes the transport, fires `onDisconnect`.
   * Idempotent.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopHeartbeat();
    for (const dispose of this.subscriptions.splice(0)) dispose.dispose();
    const err = new NogginRpcError('rpc.disposed', 'rpc client disposed');
    for (const [id, p] of this.pending) {
      if (p.timeoutHandle) clearTimeout(p.timeoutHandle);
      p.reject(err);
      this.pending.delete(id);
    }
    try { this.transport.close(); } catch { /* swallow */ }
    this.disconnects.emit();
    this.disconnects.clear();
    this.notifications.clear();
  }

  private handleIncoming(msg: RpcMessage): void {
    if (this.disposed) return;
    if (isResponse(msg)) {
      const p = this.pending.get(msg.id);
      if (!p) return; // stale or duplicate
      this.pending.delete(msg.id);
      if (p.timeoutHandle) clearTimeout(p.timeoutHandle);
      p.resolve(msg.result);
      return;
    }
    if (isError(msg)) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (p.timeoutHandle) clearTimeout(p.timeoutHandle);
      p.reject(NogginRpcError.fromPayload(msg.error));
      return;
    }
    if (isNotification(msg)) {
      this.notifications.emit({ method: msg.method, params: msg.params });
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
    if (isRequest(msg)) {
      // A request arriving at the client is unexpected; respond with
      // method-not-found so the peer's pending entry resolves.
      try {
        const reply: RpcErrorPayload = {
          code: 'rpc.method-not-found',
          message: `client does not handle request methods (got ${msg.method})`,
        };
        this.transport.send({ type: 'error', id: msg.id, error: reply });
      } catch { /* swallow */ }
      return;
    }
  }

  private startHeartbeat(): void {
    const interval = this.opts.heartbeat.intervalMs;
    if (!interval || interval <= 0) return;
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), interval);
    // Don't keep the event loop alive purely for heartbeats.
    if (this.heartbeatTimer && typeof this.heartbeatTimer === 'object' && 'unref' in this.heartbeatTimer) {
      (this.heartbeatTimer as { unref?: () => void }).unref?.();
    }
  }

  private sendHeartbeat(): void {
    if (!this.connected) return;
    // Skip if we already have a ping in flight — let the existing
    // deadline run.
    if (this.lastPingId) return;
    const id = `ping-${++this.nextId}`;
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

  private handleDisconnect(code: RpcFrameworkErrorCode, message: string): void {
    if (this.peerDead || this.disposed) return;
    this.peerDead = true;
    this.stopHeartbeat();
    const err = new NogginRpcError(code, message);
    for (const [id, p] of this.pending) {
      if (p.timeoutHandle) clearTimeout(p.timeoutHandle);
      p.reject(err);
      this.pending.delete(id);
    }
    this.disconnects.emit();
  }

  private disposedError(): NogginRpcError {
    if (this.disposed) return new NogginRpcError('rpc.disposed', 'rpc client disposed');
    return new NogginRpcError('rpc.disconnected', 'rpc client disconnected');
  }
}
