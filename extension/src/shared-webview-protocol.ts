// Tagged-envelope protocol multiplexed over the single webview ↔
// extension-host postMessage channel.
//
// VS Code only gives us one postMessage channel between the webview
// and the extension host. We carry two logical streams over it:
//
//   - noggin-rpc      (RpcMessage envelopes from @noggin/rpc)
//   - session         (extension-internal: location + file actions)
//
// Both sides discriminate by the `kind` tag at the top of every
// message. The rpc transport is a thin wrapper that wraps outgoing
// frames as `{ kind: 'rpc', payload }` and only emits incoming
// frames whose `kind === 'rpc'`.

import type { RpcMessage } from '@noggin/rpc';

/** Host → webview. */
export type HostFrame =
  | { kind: 'rpc'; payload: RpcMessage }
  | { kind: 'session'; location: string | null };

/** Webview → host. */
export type WebviewFrame =
  | { kind: 'rpc'; payload: RpcMessage }
  | { kind: 'ready' }
  | { kind: 'session-request'; action: 'openFile' | 'newFile' | 'openWorkspaceNoggin' };

/** Type guard for the rpc subset of a frame in either direction. */
export function isRpcFrame(msg: unknown): msg is { kind: 'rpc'; payload: RpcMessage } {
  return !!msg && typeof msg === 'object' && (msg as { kind?: unknown }).kind === 'rpc';
}
