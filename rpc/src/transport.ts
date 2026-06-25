// Transport abstraction.
//
// A `Transport` is anything that can shuttle `RpcMessage`s between two
// peers. The framework (`RpcClient` / `RpcServer`) is transport-
// agnostic: every transport supports the same three operations.
//
//   send(msg)        — push a message to the peer
//   onMessage(cb)    — register a callback for incoming messages
//   onDisconnect(cb) — register a callback for the transport going down
//   close()          — voluntarily close the transport
//
// Pre-built transports live under `./transports/`:
//
//   MemoryTransport       — in-process pair, used by tests
//   ElectronIpcTransport  — Electron main <-> renderer IPC
//   PostMessageTransport  — `window.postMessage` (VS Code webview)
//
// Authors of new transports implement this interface and don't touch
// the protocol or client/server code.

import type { RpcMessage } from './envelope.ts';

/** @public Subscription handle returned by `on*` registration. */
export interface RpcDisposable {
  dispose(): void;
}

/**
 * @public
 * A bidirectional channel for `RpcMessage`s. Symmetric: both client
 * and server use the same interface, just with the two ends of the
 * channel wired up.
 *
 * Implementations must guarantee:
 *
 *   - `send(msg)` MAY throw or return; either way the transport is
 *     responsible for not silently dropping messages.
 *   - `onMessage` callbacks fire in the order messages arrive. The
 *     transport MUST NOT reorder messages from the same peer.
 *   - `onDisconnect` fires at most once per transport instance. After
 *     it fires, `send` SHOULD throw and `onMessage` SHOULD NOT fire.
 *   - `close()` is idempotent; calling it MUST fire `onDisconnect` if
 *     it hasn't already.
 */
export interface Transport {
  send(message: RpcMessage): void;
  onMessage(handler: (message: RpcMessage) => void): RpcDisposable;
  onDisconnect(handler: () => void): RpcDisposable;
  close(): void;
}
