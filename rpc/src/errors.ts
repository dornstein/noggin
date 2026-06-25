// Typed error for RPC failures.
//
// Three categories:
//   - 'rpc.*'         framework errors (transport, timeout, disconnect, etc).
//                     Codes listed in `RpcFrameworkErrorCode` below.
//   - engine codes    forwarded verbatim from `NogginError` (e.g.
//                     'no-active-item', 'path-not-found'). The server
//                     wraps the engine's NogginError into an RpcError
//                     envelope; the client unwraps it back into a
//                     `NogginRpcError` with the same `code` so callers
//                     can pattern-match on the engine's stable codes.
//   - custom codes    anything else a server handler chooses to throw.
//
// The error envelope is intentionally shallow: code + message + optional
// data payload. Stack traces aren't crossed the wire — they're an
// implementation detail of the side that originated the error.

import type { RpcErrorPayload } from './envelope.ts';

/** @public Stable framework-level error codes. */
export type RpcFrameworkErrorCode =
  /** The transport reported it can't deliver any more messages. */
  | 'rpc.disconnected'
  /** A request exceeded its timeout without a response. */
  | 'rpc.timeout'
  /** The client/server is disposed; no further requests accepted. */
  | 'rpc.disposed'
  /** The peer sent a malformed envelope. */
  | 'rpc.invalid-message'
  /** A request hit a method with no registered handler. */
  | 'rpc.method-not-found'
  /** A server handler threw a non-NogginRpcError; wrapped for transport. */
  | 'rpc.handler-error'
  /** Heartbeat watchdog fired: peer hasn't responded to pings in time. */
  | 'rpc.heartbeat-timeout';

/**
 * @public
 * Thrown by the client when a request fails — either because the
 * server returned a typed error or because the framework couldn't
 * deliver the request. Always has a stable `code`.
 */
export class NogginRpcError extends Error {
  readonly code: string;
  readonly data: unknown;

  constructor(code: string, message: string, data?: unknown) {
    super(message);
    this.name = 'NogginRpcError';
    this.code = code;
    this.data = data;
  }

  /** Convert an `RpcErrorPayload` (wire envelope) into a thrown error. */
  static fromPayload(payload: RpcErrorPayload): NogginRpcError {
    return new NogginRpcError(payload.code, payload.message, payload.data);
  }

  /** Reverse: convert a thrown error to a transport-ready envelope. */
  toPayload(): RpcErrorPayload {
    return { code: this.code, message: this.message, data: this.data };
  }
}

/**
 * Normalize any thrown value into an `RpcErrorPayload`. Used by the
 * server when wrapping a handler exception. Preserves engine
 * `NogginError` shape (code + exitCode in data); falls back to a
 * generic 'rpc.handler-error' for everything else.
 */
export function toErrorPayload(thrown: unknown): RpcErrorPayload {
  if (thrown instanceof NogginRpcError) {
    return thrown.toPayload();
  }
  // Engine NogginError shape (we don't import the class so the rpc
  // package stays type-only-on-engine — duck type via property names).
  if (
    thrown &&
    typeof thrown === 'object' &&
    'code' in thrown &&
    'message' in thrown &&
    typeof (thrown as { code: unknown }).code === 'string' &&
    typeof (thrown as { message: unknown }).message === 'string'
  ) {
    const e = thrown as { code: string; message: string; exitCode?: number };
    const data: Record<string, unknown> = {};
    if (typeof e.exitCode === 'number') data.exitCode = e.exitCode;
    return {
      code: e.code,
      message: e.message,
      ...(Object.keys(data).length ? { data } : {}),
    };
  }
  if (thrown instanceof Error) {
    return { code: 'rpc.handler-error', message: thrown.message };
  }
  return { code: 'rpc.handler-error', message: String(thrown) };
}
