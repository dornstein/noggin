// Tagged-envelope protocol multiplexed over the single webview ↔
// extension-host postMessage channel.
//
// VS Code only gives us one postMessage channel between the webview
// and the extension host. We carry four logical streams over it:
//
//   - noggin-rpc      (RpcMessage envelopes from @noggin/rpc)
//   - session         (extension-internal: location + file actions)
//   - list            (NogginList's entries/prefs/MRU — persisted in
//                       the host's globalState, mirrored into the
//                       webview's in-memory store)
//   - tree-prefs      (the Noggin tree's own view prefs — currently
//                       just word-wrap — persisted the same way)
//
// Both sides discriminate by the `kind` tag at the top of every
// message. The rpc transport is a thin wrapper that wraps outgoing
// frames as `{ kind: 'rpc', payload }` and only emits incoming
// frames whose `kind === 'rpc'`.
//
// The `list-*` frames carry NogginList's entries/prefs/MRU as opaque
// JSON blobs (`Record<string, unknown>`) rather than the precise
// `@noggin/ui` types. That's deliberate: this file is compiled as
// part of the extension HOST's tsc project, which has no `jsx`
// compiler option (the host is Node/CJS, not a browser bundle), and
// `@noggin/ui`'s barrel re-exports `.tsx` components — importing its
// types here would drag JSX-bearing source files into a program that
// can't parse them. The host only ever moves these blobs between
// `globalState` and the wire; the webview (which already imports the
// full `@noggin/ui` package) applies the real types when it
// constructs the store/MRU manager from a `list-init` frame.

import type { RpcMessage } from '@noggin/rpc';

/** Host → webview. */
export type HostFrame =
  | { kind: 'rpc'; payload: RpcMessage }
  | { kind: 'session'; location: string | null }
  | { kind: 'list-init'; entries: readonly Record<string, unknown>[]; prefs: Record<string, unknown>; mru: Readonly<Record<string, string>> }
  | { kind: 'tree-prefs-init'; wordWrap: boolean };

/** Webview → host. */
export type WebviewFrame =
  | { kind: 'rpc'; payload: RpcMessage }
  | { kind: 'ready' }
  | { kind: 'session-request'; action: 'openWorkspaceNoggin' | 'close' }
  | { kind: 'session-request'; action: 'openLocation'; location: string }
  | { kind: 'list-state'; entries?: readonly Record<string, unknown>[]; prefs?: Record<string, unknown>; mru?: Readonly<Record<string, string>> }
  | { kind: 'tree-prefs-state'; wordWrap: boolean };

/** Type guard for the rpc subset of a frame in either direction. */
export function isRpcFrame(msg: unknown): msg is { kind: 'rpc'; payload: RpcMessage } {
  return !!msg && typeof msg === 'object' && (msg as { kind?: unknown }).kind === 'rpc';
}



