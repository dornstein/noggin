// Tagged-envelope protocol multiplexed over the single webview ↔
// extension-host postMessage channel.
//
// VS Code only gives us one postMessage channel between the webview
// and the extension host. We carry three logical streams over it:
//
//   - noggin-rpc      (RpcMessage envelopes from @noggin/rpc)
//   - session         (extension-internal: location + file actions)
//   - ctx-menu        (webview asks host to show a native quick-pick
//                      menu and report which item the user picked)
//
// All three sides discriminate by the `kind` tag at the top of every
// message. The rpc transport is a thin wrapper that wraps outgoing
// frames as `{ kind: 'rpc', payload }` and only emits incoming
// frames whose `kind === 'rpc'`.

import type { RpcMessage } from '@noggin/rpc';

/**
 * Wire-side context-menu item the webview ships to the host. Mirrors
 * the public `TreeContextMenuEntry` from `@noggin/ui` but stripped of
 * the React-side `onClick` closure (which isn't serializable). The
 * host displays it; the webview retains the closures and dispatches
 * by key when the host posts back a `ctx-menu-result`.
 */
export type CtxMenuWireItem =
  | {
      kind: 'item';
      key: string;
      label: string;
      icon?: string;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
    }
  | { kind: 'separator'; key: string };

/** Host → webview. */
export type HostFrame =
  | { kind: 'rpc'; payload: RpcMessage }
  | { kind: 'session'; location: string | null }
  | { kind: 'ctx-menu-result'; id: number; pickedKey: string | null };

/** Webview → host. */
export type WebviewFrame =
  | { kind: 'rpc'; payload: RpcMessage }
  | { kind: 'ready' }
  | { kind: 'session-request'; action: 'openFile' | 'newFile' | 'openWorkspaceNoggin' }
  | { kind: 'ctx-menu-request'; id: number; items: ReadonlyArray<CtxMenuWireItem> };

/** Type guard for the rpc subset of a frame in either direction. */
export function isRpcFrame(msg: unknown): msg is { kind: 'rpc'; payload: RpcMessage } {
  return !!msg && typeof msg === 'object' && (msg as { kind?: unknown }).kind === 'rpc';
}
