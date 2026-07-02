# noggin desktop

Windows-first desktop app for noggin. Electron + Vite + React.

The engine runs in the **main process** behind a transport-agnostic
`noggin-rpc` server; the renderer drives it via `RemoteNoggin`
(`@noggin/ui/remote`), which optimistically-applies each verb against
a local memory noggin so the UI re-renders without round-trip
latency. Phase 4 of the [noggin-rpc plan](../docs/plans/2026-06-noggin-rpc.md)
landed this architecture in mid-2026.

## Structure

```
desktop/
├── package.json
├── electron.vite.config.ts          # main + preload + renderer bundling
├── electron-builder.yml             # packaging + auto-update config
├── tsconfig.json
├── tsconfig.node.json
├── vitest.config.ts
├── src/
│   ├── shared/
│   │   └── host-services-rpc.ts     # HostServices RPC arc (main → renderer)
│   ├── main/
│   │   ├── index.ts                 # Electron entry; window + native menu
│   │   ├── engine.ts                # createNogginRpcServer per BrowserWindow
│   │   ├── host-services-electron.ts
│   │   ├── provider-flows-electron.ts
│   │   └── host-services-rpc-client.ts  # forwards host.show* to the renderer
│   ├── preload/
│   │   └── index.ts                 # contextBridge: nogginRpcIpc, hostServicesRpc
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx              # @noggin/ui composition; verbs call noggin.X()
│           ├── noggin.ts            # useNogginState → RemoteNoggin
│           ├── rpc-client.ts        # singleton RpcClient over window.nogginRpcIpc
│           ├── host-services.ts     # renderer calls to host.pickFile / pickNewFile
│           ├── HostServicesReactImpl.tsx  # renderer impl of host.show* requests
│           ├── applyChanges.ts      # incremental NogginNode patcher
│           └── styles.css
└── test/                            # vitest
    ├── applyChanges.test.mjs
    ├── host-services-rpc-client.test.ts
    └── end-to-end.test.ts
```

The engine is consumed as a workspace dependency (`@noggin/engine`,
wired via `file:../engine` in package.json). No vendored source.

## Architecture

```
┌─────────────── main process ───────────────┐    ┌───────── renderer ────────┐
│                                            │    │                           │
│  Noggin (file:// or memory://)             │    │  RemoteNoggin             │
│   │                                        │    │   ├─ local memory noggin  │
│  createNogginRpcServer                     │    │   ├─ predict / rebase     │
│   ├─ engine providers (file, memory)       │    │   └─ verbs → RpcClient    │
│   ├─ ProviderFlows  ── pickToOpen, create  │    │                           │
│   └─ HostServices   ── pickFile, showError,│    │  @noggin/ui (NogginTree,  │
│                       openExternal,        │    │   NogginDetails, …)       │
│                       show{Input,Pick,     │    │                           │
│                          Confirm}* ───────┐│    │  ModalHost  ◀── modalIpc  │
│                                           ││    │              ─▶          │
│  ElectronIpcMainTransport ─◀──────────────┼┼────┤  ElectronIpcRendererTrans │
│                                           ││    │                           │
└──────────────────────── 'noggin-rpc' ──────┘    └───────────────────────────┘
                                            │
                                  *modal-broker
                                   round-trips show*
                                   to the renderer via
                                   a separate modalIpc
                                   channel
```

Two IPC channels:

- `'noggin-rpc'` — the framework's `RpcMessage` envelopes. Carries
  every verb call, every `noggin.changed` notification, every
  `host.pickFile`. Transport-agnostic; the protocol could ride
  postMessage or a socket equally well.
- `'modal:request'` / `'modal:reply'` — a private, renderer-internal
  channel the host-services modal broker uses to drive React modals
  for `showInputBox` / `showQuickPick` / `showConfirm`. Not noggin-rpc.

`BrowserWindow.webPreferences` runs under standard Electron defaults:

```js
{ contextIsolation: true, nodeIntegration: false, sandbox: true }
```

The renderer has no `require`, no `process`, no direct `electron`
import. Three narrowed bridges are published from preload via
`contextBridge.exposeInMainWorld`:

| Surface              | Purpose                                                       |
| -------------------- | ------------------------------------------------------------- |
| `window.shell`       | Legacy file dialogs + menu wiring (`SHELL_IPC` channel)       |
| `window.nogginRpcIpc`| Narrowed `IpcRendererLike` bound to `'noggin-rpc'`            |
| `window.modalIpc`    | Modal round-trip (`onRequest`, `sendReply`)                   |

## Dev workflow

```bash
cd desktop
npm install
npm run dev        # syncs skill bundle, starts electron-vite in dev mode
```

The dev server hot-reloads the renderer; main and preload restart the
Electron process automatically when they change.

## Build + package

```bash
npm run build      # type-check + bundle main/preload/renderer to out/
npm run package    # build + electron-builder --dir (no installer)
npm run release    # build + electron-builder (.exe NSIS installer in release/)
```

## Test

```bash
npm test           # vitest run
```

Three suites:

- [`test/applyChanges.test.mjs`](test/applyChanges.test.mjs) — the
  incremental NogginNode patcher.
- [`test/modal-broker.test.ts`](test/modal-broker.test.ts) — the
  main-side broker that fulfils `host.show*` HostServices methods by
  posting modal-requests to the renderer.
- [`test/end-to-end.test.ts`](test/end-to-end.test.ts) — stands up a
  full noggin-rpc server + `RemoteNoggin` over a memory transport
  pair and exercises the verb path the desktop renderer takes in
  production.

## Auto-update

Wired end-to-end. Every push to `main` that trips the release gate in
[`.github/workflows/release.yml`](../.github/workflows/release.yml)
produces a Windows NSIS installer plus a `latest.yml` update feed and
attaches both to the matching GitHub Release. In packaged builds
`src/main/index.ts` calls `autoUpdater.checkForUpdatesAndNotify()`
after window creation, so the app pulls newer releases silently on the
next launch and prompts the user to restart when one is staged.

- **Provider** — GitHub Releases (`publish:` in
  [`electron-builder.yml`](electron-builder.yml)). The `owner`/`repo`
  fields are read at package time and baked into `app-update.yml`.
- **Feed URL** — implicit; electron-updater derives it from the
  provider config and the current app version.
- **Dev builds** — `app.isPackaged` is false, so the update check is
  skipped. Running `electron-vite dev` never talks to GitHub.
- **Signing** — not wired yet. SmartScreen will flag the first install
  as "Unknown publisher"; auto-updates still work because
  electron-updater verifies the download's SHA-512 against
  `latest.yml`, not against a code-signing cert.

To sign in the future, add a Windows code-signing certificate to the
release environment (`CSC_LINK` + `CSC_KEY_PASSWORD`, or an Azure Key
Vault + `azuresigntool`) and electron-builder will pick it up
automatically.

## Adding a host service

The runtime UX surfaces — file dialogs, error popups, input boxes —
live behind `HostServices` in [`@noggin/rpc`](../rpc). To add one:

1. Add the method shape + request/response types to
   [`rpc/src/protocol.ts`](../rpc/src/protocol.ts), then thread them
   through [`rpc/src/host-services.ts`](../rpc/src/host-services.ts).
2. Implement it in
   [`src/main/host-services-electron.ts`](src/main/host-services-electron.ts).
   If the method needs React UI, route through the modal broker
   (`showInputBox` / `showQuickPick` / `showConfirm` are the
   existing examples).
3. Add a new modal kind to [`src/shared/modal-ipc.ts`](src/shared/modal-ipc.ts)
   and a matching React modal in
   [`src/renderer/src/ModalHost.tsx`](src/renderer/src/ModalHost.tsx).
4. Call it from the renderer via
   `client.request('host.yourMethod', opts)` — or, more commonly,
   wrap it in a small helper inside `@noggin/ui` so multiple hosts
   share the call site.

## Why Electron and not Tauri

The engine is already a Node package. Tauri's WebView2 + Rust shell
would force the API into a sidecar process (stdio + JSON-RPC) or an
FFI binding to be usable from the UI. With Electron the main process
*is* a Node process, so the engine is a normal import. We pay ~80 MB
of disk and ~150 MB of RAM for that simplicity; the trade matches the
brief ("super lightweight" is relative — even Electron beats a
typical browser tab).

If lightweight becomes a hard constraint, the path is Tauri + the
shipped `noggin-mcp.bundle.mjs` as a sidecar (stdio JSON-RPC), and
the renderer's `RemoteNoggin` would just point at a different
transport. The noggin-rpc protocol is exactly what makes that swap
straightforward.
