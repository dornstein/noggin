---
title: noggin-rpc protocol
slug: "noggin-rpc/"
---

# noggin-rpc

noggin-rpc is the wire protocol every split-process noggin host
speaks. Today that means the desktop app and the VS Code extension; a
future web host would speak it too.

The protocol is **transport-agnostic**: the same envelopes ride over
Electron IPC, `window.postMessage`, or a future WebSocket. Picking a
transport is a host-author concern. Speaking the protocol is a
contract every noggin-rpc client and server upholds.

The reference implementation lives in
[`@noggin/rpc`](https://github.com/dornstein/noggin/tree/main/rpc).
This page is the **contract**: anyone could build a noggin-rpc client
or server in a different language against this spec.

> **Status: proposed.** The protocol surface is locked at the level
> of method names and request/response shapes (Phase 1 of the
> [noggin-rpc plan](https://github.com/dornstein/noggin/blob/main/docs/plans/2026-06-noggin-rpc.md)).
> The server-side engine wiring lands in Phase 2.

## Architecture

A noggin-rpc connection always has two ends:

- **Server.** The trusted side. Holds the engine, provider registry,
  and `HostServices` (file pickers, input boxes, etc.). Runs in the
  desktop main process, the VS Code extension host, or a future
  server-side runtime.
- **Client.** The UI side. Holds the React components, the
  optimistic update layer (Phase 3), and a `RemoteNoggin` adapter
  that translates UI verb calls into RPC requests.

One server, one client, one transport: there is no broker.
Multi-renderer hosts (Electron with multiple windows) pair one server
per renderer.

## Envelope

Every wire message is one of six discriminated shapes. JSON-serialisable
and order-preserving over the transport.

```ts
type RpcMessage =
  | { type: 'request';      id: string; method: string; params?: unknown }
  | { type: 'response';     id: string; result?: unknown }
  | { type: 'error';        id: string; error: RpcErrorPayload }
  | { type: 'notification'; method: string; params?: unknown }
  | { type: 'ping';         id: string }
  | { type: 'pong';         id: string };

interface RpcErrorPayload {
  code: string;        // 'rpc.*' for framework errors, engine codes for verb errors
  message: string;     // human-readable, not stable
  data?: unknown;      // engine errors include { exitCode }
}
```

Implementations MUST:

- Echo `id` verbatim on responses, errors, and pongs.
- Preserve message order from the same peer.
- Treat a `request` with no registered handler as
  `rpc.method-not-found` (server) or as an out-of-band error (client).
- Reply to a `ping` with a `pong` of the same id.

Implementations MUST NOT:

- Multiplex multiple logical channels over one connection (use
  multiple connections).
- Coalesce or batch notifications (each notification is one
  message).
- Drop messages silently on full buffers — they must surface as
  `rpc.disconnected`.

## Method surface

Five families of methods. The TypeScript shapes are normative — when
this page and the types in
[`rpc/src/protocol.ts`](https://github.com/dornstein/noggin/blob/main/rpc/src/protocol.ts)
disagree, the types win.

### `noggin.*` — lifecycle and reads

| Method | Purpose |
|---|---|
| `noggin.open` | Open a noggin by canonical location. Returns a per-connection `sessionId` and the full document `snapshot`. |
| `noggin.close` | Release server resources for a session. |
| `noggin.snapshot` | Re-request the full document. Used to recover after a missed `noggin.changed` (UI heard about an error and wants to resync). |
| `noggin.show` | Server-side equivalent of the engine's `verbs.show` — returns the current tree view without mutating. |
| `noggin.subscribe` | Begin streaming `noggin.changed` / `noggin.errored` notifications for the given session. Returns a `subscriptionId`. |
| `noggin.unsubscribe` | Stop the stream. Idempotent; unknown ids are silently ignored. |

#### `noggin.open`

```ts
request:  { location: string; opts?: Record<string, unknown> }
response: { sessionId: SessionId; snapshot: NogginDocument; describe: string }
```

`location` is a canonical location string the user/agent supplied
(`~/.noggin.yaml`, `file:///abs/path.yaml`, `memory://x`, …). The
server picks a provider by scheme prefix; bare locations go to the
default provider.

The `snapshot` is the complete document, the same shape as the on-disk
YAML, ready for the UI to project into a tree. After `noggin.open`,
the client typically issues `noggin.subscribe` to receive incremental
changes; otherwise it would have to poll `noggin.snapshot`.

Errors:

- `no-provider` — no provider registered for the scheme.
- `no-location` — empty `location`.
- engine errors from the provider's `open()` (e.g. `lock-timeout`).

#### `noggin.subscribe` / `noggin.unsubscribe`

```ts
// noggin.subscribe
request:  { sessionId: SessionId }
response: { subscriptionId: SubscriptionId }

// noggin.unsubscribe
request:  { subscriptionId: SubscriptionId }
response: { subscriptionId: SubscriptionId }
```

While subscribed, the server pushes `noggin.changed` and
`noggin.errored` notifications. Both carry the originating
`subscriptionId` so the client routes them to the right consumer.

Ordering: the server MUST deliver a `noggin.changed` for a mutation
BEFORE the response to the verb that caused it. This is what lets the
optimistic UI layer reconcile a write deterministically: the
prediction landed, then the verb resolves with the same authoritative
view.

### `verb.*` — mutations

One method per engine verb. Same shape:

```ts
request:  { sessionId: SessionId; opts: <VerbOptions> }
response: CurrentTreeView           // except delete (DeleteResult) and copy (CopyResult)
```

| Method | Engine verb | Returns |
|---|---|---|
| `verb.push` | `verbs.push` | `CurrentTreeView` |
| `verb.add` | `verbs.add` | `CurrentTreeView` |
| `verb.move` | `verbs.move` | `CurrentTreeView` |
| `verb.goto` | `verbs.goto` | `CurrentTreeView` |
| `verb.done` | `verbs.done` | `CurrentTreeView` |
| `verb.pop` | `verbs.pop` | `CurrentTreeView` |
| `verb.edit` | `verbs.edit` | `CurrentTreeView` |
| `verb.note` | `verbs.note` | `CurrentTreeView` |
| `verb.delete` | `verbs.delete` | `DeleteResult` |
| `verb.copy` | `verbs.copy` | `CopyResult` |

`verb.copy` is the one two-noggin verb: its request carries both
`sourceSessionId` and `destSessionId`. Both sessions must already
be open on the same server.

Verbs MUST return errors using engine codes (`no-active-item`,
`path-not-found`, `cycle`, etc.) so the client can pattern-match on
them with the same code paths used in-process.

### `host.*` — host services

These flow **client → server** even though they're called "host"
services. The UI lives in the client process; the host runtime
(Electron main, VS Code extension host) lives in the server process.

| Method | Purpose |
|---|---|
| `host.pickFile` | Show a file-open dialog; returns selected paths (or `[]` on cancel). |
| `host.pickNewFile` | Show a save-as dialog; returns the chosen path or `null`. |
| `host.showInputBox` | Single-line text input modal. |
| `host.showQuickPick` | List of options with optional filter. |
| `host.showConfirm` | Yes/no modal. |
| `host.showError` | Error toast / dialog. Always resolves `{ acknowledged: true }`. |
| `host.openExternal` | Hand a URL or path to the OS default handler. |

Servers that don't implement a host service (e.g. a headless test
server) reject calls to it with `rpc.method-not-found`. Clients should
degrade gracefully — these are UI conveniences, not core verbs.

### `provider.*` — registry and discovery

| Method | Purpose |
|---|---|
| `provider.list` | Enumerate registered providers (scheme + default flag + display name). |
| `provider.describe` | Detailed info for one provider. |
| `provider.create` | Drive the provider's user-facing flow for creating a new noggin (e.g. "Save As…"). Returns a `location` or `null` on cancel. |
| `provider.open` | Drive the provider's user-facing flow for opening an existing noggin (e.g. file picker). Returns a `location` or `null`. |
| `provider.listInstances` | Provider-specific catalog (recents, known cloud noggins, …). |

`provider.create` and `provider.open` are deliberately separate from
`host.pickFile`: the provider gets to choose its own UX flow (it may
use `host.*` building blocks internally, but the contract here is
"give me a noggin location," not "give me a file path").

## Notifications

Two server-to-client notification methods. Both are scoped to an
active `noggin.subscribe`:

```ts
// noggin.changed
{
  subscriptionId: SubscriptionId;
  sessionId: SessionId;
  changes: ItemChange[];        // same vocab as the engine's onDidChange
}

// noggin.errored
{
  subscriptionId: SubscriptionId;
  sessionId: SessionId;
  code: NogginErrorCode | string;
  message: string;
  exitCode?: number;
}
```

`noggin.errored` covers errors that fire outside a verb call — file
watcher detecting a malformed file, lock-acquisition timeout from a
peer writer, etc. Per-verb errors are returned in the verb's error
envelope, not via this notification.

## Heartbeats

Optional. When enabled on a side:

- The side sends a `ping` when idle for `intervalMs`.
- The peer MUST answer with a `pong` of the same id.
- If the `pong` doesn't arrive within `timeoutMs`, the side declares
  the connection dead, rejects pending requests with
  `rpc.heartbeat-timeout`, and fires `onDisconnect`.

Both client and server can enable heartbeats independently. The
default is **off** (`intervalMs: 0`).

## Error model

All errors arrive as `RpcErrorPayload` (in an `error` envelope or
inside a thrown `NogginRpcError` on the client). Codes split into
three buckets:

- **Framework codes** (`rpc.*`) — produced by the RPC layer:
  - `rpc.disconnected`
  - `rpc.disposed`
  - `rpc.timeout`
  - `rpc.method-not-found`
  - `rpc.heartbeat-timeout`
  - `rpc.handler-error` (server handler threw a non-`NogginError`)
- **Engine codes** — forwarded verbatim from the engine's `NogginError`.
  See [Response envelope](../envelope/) for the canonical list.
- **Custom codes** — anything else a server handler chooses to throw.

The wire `data` field is optional. For engine errors the server
includes `{ exitCode }` so the CLI's exit-code contract survives the
round trip.

## Subscription lifecycle, formally

```
client                                       server
  │                                            │
  │── noggin.subscribe { sessionId } ─────────▶│
  │◀──────────── { subscriptionId } ───────────│
  │                                            │
  │           (any verb mutates the noggin)    │
  │◀─── noggin.changed { subscriptionId, … } ──│
  │◀─── noggin.changed { subscriptionId, … } ──│
  │                                            │
  │── noggin.unsubscribe { subscriptionId } ──▶│
  │◀──────────── { subscriptionId } ───────────│
  │                                            │
  │  (no further notifications for this id)    │
```

If the transport drops while a subscription is active, the client's
`RpcClient` rejects all pending requests with `rpc.disconnected` and
fires `onDisconnect`. The server's `RpcServer` cleans up its
subscription registry. Re-establishing the connection requires the
client to re-open the noggin and re-subscribe — subscription ids
do not survive a disconnect.

## Server adapter

Building a noggin-rpc server by hand means wiring 28 methods to the
engine, provider registry, and host services. The
`createNogginRpcServer` adapter does that for you:

```ts
import { createNogginRpcServer } from '@noggin/rpc';
import { createElectronIpcMainTransport } from '@noggin/rpc/transports/electron-ipc';
import { ipcMain } from 'electron';

const transport = createElectronIpcMainTransport(ipcMain, mainWindow.webContents);
createNogginRpcServer({
  transport,
  hostServices,                 // your HostServices implementation
  providerFlows: {              // optional: provider-level UX flows
    create:     (scheme) => /* run a Save As dialog, return location */,
    pickToOpen: (scheme) => /* run an Open dialog, return location */,
  },
});
// That's it. Every `noggin.*`, `verb.*`, `host.*`, `provider.*`
// method is now answered correctly.
```

The adapter manages:

- **Session lifecycle.** Per-connection `sessionId` keyed to a real
  `Noggin` returned by `openNoggin(location, opts)`. `noggin.close`
  disposes the noggin and clears any subscriptions still attached to
  it. Disconnect cascades through to dispose every open session.
- **Verb dispatch.** Every `verb.*` method routes to the matching
  function in `verbs.*` from `@noggin/engine`. Engine errors flow
  back through the wire with their original stable codes.
- **Subscriptions.** `noggin.subscribe` returns a `subscriptionId`,
  hooks the engine's `onDidChange` to push `noggin.changed`
  notifications, and hooks `onDidError` to push `noggin.errored`.
  `noggin.unsubscribe` is idempotent; unknown ids resolve silently.
- **Host services.** `host.*` calls go straight to the injected
  `HostServices` implementation. Missing services reject with
  `code: 'not-implemented'`.
- **Provider registry.** `provider.list` enumerates `providers.list()`
  from `@noggin/engine`. `provider.create` / `provider.open` /
  `provider.listInstances` / `provider.describe` delegate to the
  injected `providerFlows`; without them they reject with
  `code: 'not-implemented'`.

### `HostServices`

The interface a host implementation fulfills. Seven methods, one
per `host.*` RPC. Cancellation is encoded in the response shape
(`{ value: null }`, `{ paths: [] }`, `{ confirmed: false }`); throw
only for actual failures.

```ts
interface HostServices {
  pickFile(opts: HostPickFileRequest):           Promise<HostPickFileResponse>;
  pickNewFile(opts: HostPickNewFileRequest):     Promise<HostPickNewFileResponse>;
  showInputBox(opts: HostShowInputBoxRequest):   Promise<HostShowInputBoxResponse>;
  showQuickPick(opts: HostShowQuickPickRequest): Promise<HostShowQuickPickResponse>;
  showConfirm(opts: HostShowConfirmRequest):     Promise<HostShowConfirmResponse>;
  showError(opts: HostShowErrorRequest):         Promise<HostShowErrorResponse>;
  openExternal(opts: HostOpenExternalRequest):   Promise<HostOpenExternalResponse>;
}
```

The desktop app's main process implements this against Electron's
`dialog.*` and `shell.openExternal`. The VS Code extension implements
it against `vscode.window.show*` and `vscode.env.openExternal`. The
RPC layer never sees those differences — the server-adapter routes
through `HostServices` and the wire shape is identical.

## Reference implementation

The TypeScript types in
[`rpc/src/protocol.ts`](https://github.com/dornstein/noggin/blob/main/rpc/src/protocol.ts)
are the normative spec for request/response/notification shapes. The
[`@noggin/rpc`](https://github.com/dornstein/noggin/tree/main/rpc)
package ships:

- The `RpcMessage` envelope and type guards.
- `RpcClient` + `RpcServer`: generic, protocol-agnostic.
- `NogginRpcError` + the wire ↔ thrown converters.
- Three transports: `MemoryTransport`, `ElectronIpcTransport`,
  `PostMessageTransport`.
- `createNogginRpcServer` + `HostServices` — the server adapter
  that maps every `RpcProtocol` method to engine / provider / host
  calls.

Phase 3 of the
[noggin-rpc plan](https://github.com/dornstein/noggin/blob/main/docs/plans/2026-06-noggin-rpc.md)
introduces the **remote engine client + optimistic update layer**
on the UI side: a `RemoteNoggin` adapter that makes the remote engine
look local enough for `@noggin/ui` components, plus the optimistic
predict-then-reconcile machinery that keeps gestures feeling sync
despite the async wire.
