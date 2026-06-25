# @noggin/rpc

Transport-agnostic RPC framework + the noggin-rpc protocol surface.

This is the wire layer every split-process noggin host (desktop,
VS Code, future web) speaks. The package is intentionally split into
two halves:

- **Framework.** Generic `RpcClient`, `RpcServer`, `Transport`,
  envelope types, error model, heartbeats. Knows nothing about
  noggin.
- **Protocol.** The typed `RpcProtocol` interface listing every
  noggin-rpc method (lifecycle, verbs, host services, providers) and
  the two streaming-notification shapes. Types only — no runtime
  wiring. The server-side wiring that maps these methods onto a real
  engine + provider registry + host services lives in
  `@noggin/rpc-server` (Phase 2 of the noggin-rpc plan).

The full protocol spec is published at
<https://dornstein.github.io/noggin/noggin-rpc.html>.

## Install

```bash
npm install @noggin/rpc
```

Pick a transport from a subpath export:

```ts
import { createMemoryTransportPair } from '@noggin/rpc/transports/memory';
import { createElectronIpcMainTransport } from '@noggin/rpc/transports/electron-ipc';
import { createPostMessageTransport } from '@noggin/rpc/transports/postmessage';
```

## Quick start

Both sides — client and server — wrap a `Transport`:

```ts
import { RpcClient, RpcServer } from '@noggin/rpc';
import { createMemoryTransportPair } from '@noggin/rpc/transports/memory';

const { a, b } = createMemoryTransportPair();

// Server side
const server = new RpcServer(a);
server.on('add', ({ a, b }: { a: number; b: number }) => a + b);

// Client side
const client = new RpcClient(b);
const sum = await client.request<number>('add', { a: 2, b: 3 }); // 5

// Server can push notifications to the client at any time
server.notify('hello', { who: 'world' });
client.onNotification((method, params) => {
  // method === 'hello', params === { who: 'world' }
});
```

Disconnect handling is built-in: closing either transport fires
`onDisconnect` on both sides, rejects every pending request with
`rpc.disconnected`, and marks the client/server permanently dead.

## Transports

Three are shipped:

### `MemoryTransport`

In-process pair, mostly used by tests. Delivery is microtask-deferred
so re-entrancy bugs surface the same way they would in a real
transport.

```ts
const { a, b } = createMemoryTransportPair();
new RpcServer(a);
new RpcClient(b);
```

### `ElectronIpcTransport`

Two factories: one for the renderer, one for the main process.

```ts
// renderer
import { createElectronIpcRendererTransport } from '@noggin/rpc/transports/electron-ipc';
const client = new RpcClient(createElectronIpcRendererTransport(window.electronIpc));

// main
import { createElectronIpcMainTransport } from '@noggin/rpc/transports/electron-ipc';
import { ipcMain } from 'electron';
mainWindow.webContents.on('did-finish-load', () => {
  const server = new RpcServer(createElectronIpcMainTransport(ipcMain, mainWindow.webContents));
});
```

`electron` is **not** a dependency of this package — the transport
takes the IPC objects you already have via structural typing, so the
docs site can render without pulling Electron.

### `PostMessageTransport`

Works for both VS Code webview ⇔ extension host and plain `window`
`postMessage` flows. The transport prefers `onDidReceiveMessage`
(VS Code's webview API) when present, otherwise falls back to
`addEventListener('message', …)`.

```ts
// VS Code extension host
const transport = createPostMessageTransport({
  postMessage: (msg) => panel.webview.postMessage(msg),
  onDidReceiveMessage: (listener) => panel.webview.onDidReceiveMessage(listener),
});

// VS Code webview script
const vscode = acquireVsCodeApi();
const transport = createPostMessageTransport({
  postMessage: (msg) => vscode.postMessage(msg),
  addEventListener: window.addEventListener.bind(window),
  removeEventListener: window.removeEventListener.bind(window),
});
```

## Heartbeats

Off by default. Enable per side:

```ts
const client = new RpcClient(transport, {
  heartbeat: { intervalMs: 30_000, timeoutMs: 60_000 },
});
```

When enabled, the side sends a `ping` if idle for `intervalMs`; if the
peer doesn't `pong` within `timeoutMs`, the connection is declared
dead, pending requests reject with `rpc.heartbeat-timeout`, and
`onDisconnect` fires. Pings and pongs are framework-level — handlers
never see them.

For tests using `MemoryTransport` heartbeats are usually undesirable
(they add tick churn); leave them off.

## Errors

Every failure surfaces as a `NogginRpcError` with a stable `code`:

| Code | Source | Meaning |
|---|---|---|
| `rpc.disconnected` | framework | transport reported disconnect |
| `rpc.disposed` | framework | client/server disposed locally |
| `rpc.timeout` | framework | request exceeded `requestTimeoutMs` |
| `rpc.method-not-found` | framework | server has no handler for the method |
| `rpc.heartbeat-timeout` | framework | peer didn't pong in time |
| `rpc.handler-error` | framework | server handler threw a non-`NogginError` |
| engine codes | engine | forwarded verbatim from `NogginError` (e.g. `'path-not-found'`, `'no-active-item'`) |

The server's `toErrorPayload` helper unwraps engine `NogginError`s
into the wire envelope; the client's `fromPayload` re-wraps them as
`NogginRpcError` with the same `code`. So `catch (e)` works identically
for in-process and remote consumers.

## Writing a new transport

Implement `Transport`:

```ts
interface Transport {
  send(message: RpcMessage): void;
  onMessage(handler: (message: RpcMessage) => void): RpcDisposable;
  onDisconnect(handler: () => void): RpcDisposable;
  close(): void;
}
```

Contract:

- `send` may throw or return synchronously — never silently drop.
- `onMessage` callbacks fire in the order messages arrive.
- `onDisconnect` fires at most once. After it fires, `send` should
  throw and `onMessage` should not fire.
- `close()` is idempotent and fires `onDisconnect` if it hasn't yet.

Run the framework tests against your transport (mirror the
`MemoryTransport` test in `test/memory-transport.test.ts`) and you're
done. The framework's `RpcClient` / `RpcServer` don't need to know
anything about the underlying channel.

## Layout

```
rpc/
  src/
    envelope.ts        wire types (request/response/notification/ping/pong)
    errors.ts          NogginRpcError + framework error codes
    transport.ts       Transport interface + Disposable
    emitter.ts         small fan-out helper (no engine dep)
    client.ts          RpcClient
    server.ts          RpcServer
    protocol.ts        the noggin-rpc method table (types only)
    transports/
      memory.ts        createMemoryTransportPair
      electron-ipc.ts  createElectron{Renderer,Main}IpcTransport
      postmessage.ts   createPostMessageTransport
  test/
    memory-transport.test.ts
    client-server.test.ts
    subscription.test.ts
    errors.test.ts (none — covered by client-server.test.ts)
    disconnect.test.ts
    heartbeat.test.ts
    integration.test.ts
    protocol.test.ts
```

## Plan

This package is the deliverable for Phase 1 of the
[noggin-rpc plan](../docs/plans/2026-06-noggin-rpc.md). Phase 2
introduces `@noggin/rpc-server`, which wires every method in
`RpcProtocol` to the actual engine + providers + `HostServices` so a
transport with no clients attached has a usable noggin behind it.
