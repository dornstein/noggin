// Wire envelope shapes for the noggin-rpc transport layer.
//
// A `RpcMessage` is the atomic unit a `Transport` carries. Six
// kinds, one shared `id` field for correlation where applicable:
//
//   request       — caller -> peer, expects a matching response/error
//   response      — peer -> caller, fulfils a request
//   error         — peer -> caller, rejects a request
//   notification  — peer -> caller, no response expected (events, fan-out)
//   ping          — liveness probe; peer must answer with a pong of the
//                   same id
//   pong          — liveness response
//
// `id` is a string the caller picks; the peer echoes it verbatim.
// `method` is a dotted name like `noggin.open` or `verb.add`.
//
// Keep these wire types minimal and JSON-serialisable: every
// transport must be able to round-trip a `RpcMessage` through its
// underlying channel without loss.

/** @public Caller -> peer; expects a matching `RpcResponse` or `RpcError`. */
export interface RpcRequest {
  readonly type: 'request';
  readonly id: string;
  readonly method: string;
  readonly params?: unknown;
}

/** @public Peer -> caller; fulfils a `RpcRequest` with a result value. */
export interface RpcResponse {
  readonly type: 'response';
  readonly id: string;
  readonly result?: unknown;
}

/** @public Peer -> caller; rejects a `RpcRequest`. */
export interface RpcError {
  readonly type: 'error';
  readonly id: string;
  readonly error: RpcErrorPayload;
}

/** @public Error envelope embedded in an `RpcError` message. */
export interface RpcErrorPayload {
  /** Stable machine code. The framework uses `'rpc.*'` codes; the
   *  noggin protocol uses `NogginErrorCode` values from the engine. */
  readonly code: string;
  /** Human-readable message. Not stable; do not parse. */
  readonly message: string;
  /** Optional structured payload. Engine errors include `exitCode`. */
  readonly data?: unknown;
}

/** @public Peer -> caller; fire-and-forget message. No response. */
export interface RpcNotification {
  readonly type: 'notification';
  readonly method: string;
  readonly params?: unknown;
}

/** @public Liveness probe. Peer must answer with a pong of the same id. */
export interface RpcPing {
  readonly type: 'ping';
  readonly id: string;
}

/** @public Reply to a ping; carries the originating ping's id. */
export interface RpcPong {
  readonly type: 'pong';
  readonly id: string;
}

/** @public The full discriminated union of wire messages. */
export type RpcMessage =
  | RpcRequest
  | RpcResponse
  | RpcError
  | RpcNotification
  | RpcPing
  | RpcPong;

/** @public Type guard for `RpcRequest`. */
export function isRequest(msg: RpcMessage): msg is RpcRequest {
  return msg.type === 'request';
}

/** @public Type guard for `RpcResponse`. */
export function isResponse(msg: RpcMessage): msg is RpcResponse {
  return msg.type === 'response';
}

/** @public Type guard for `RpcError`. */
export function isError(msg: RpcMessage): msg is RpcError {
  return msg.type === 'error';
}

/** @public Type guard for `RpcNotification`. */
export function isNotification(msg: RpcMessage): msg is RpcNotification {
  return msg.type === 'notification';
}

/** @public Type guard for `RpcPing`. */
export function isPing(msg: RpcMessage): msg is RpcPing {
  return msg.type === 'ping';
}

/** @public Type guard for `RpcPong`. */
export function isPong(msg: RpcMessage): msg is RpcPong {
  return msg.type === 'pong';
}
