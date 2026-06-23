# noggin desktop

Windows-first desktop app for noggin. Electron + Vite + React. The
main process imports the noggin engine directly (`verbs.push(...)`,
`openNoggin(...)`) and exposes a typed `window.noggin` API to the React
renderer via `contextBridge`.

No spawning, no JSON-RPC, no sub-process. One process, one Node
runtime, one in-memory `Noggin` instance.

## Structure

```
desktop/
├── package.json
├── electron.vite.config.ts        # main + preload + renderer bundling
├── electron-builder.yml            # packaging + auto-update config
├── tsconfig.json
├── tsconfig.node.json
├── src/
│   ├── shared/
│   │   └── ipc.ts                  # typed IPC surface (single source of truth)
│   ├── main/
│   │   └── index.ts                # Electron main; imports noggin-api directly
│   ├── preload/
│   │   └── index.ts                # contextBridge.exposeInMainWorld('noggin', …)
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.tsx            # ReactDOM.createRoot
│           ├── App.tsx             # tree view + quick-add
│           ├── api.ts              # typed window.noggin accessor
│           └── styles.css
└── skills/
    └── noggin/                     # AUTO-SYNCED FROM ../cli/
```

`skills/noggin/` is the same byte-for-byte synced copy of `cli/` that
the VS Code extension and Codex plugin use. It's refreshed by the
repo-wide [`scripts/sync-skill.mjs`](../scripts/sync-skill.mjs), so
engine changes flow automatically.

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

## Auto-update

Configured but not wired in v0. To enable:

1. Uncomment the `publish:` block in `electron-builder.yml`.
2. Add `electron-updater` as a dependency.
3. Call `autoUpdater.checkForUpdatesAndNotify()` from
   `src/main/index.ts` after `app.whenReady()`.
4. Sign your installer (or accept the SmartScreen warning until you do).

The repo's existing release workflow already publishes a unified
GitHub Release per version (the `noggin-vscode-x.y.z.vsix` is
attached today; the `noggin-x.y.z-win-x64.exe` would attach the same
way). Auto-update can target those release assets directly.

## How the IPC works

There is exactly one shared file: [`src/shared/ipc.ts`](src/shared/ipc.ts).
It defines:

- `NogginIpc` — the API shape the renderer sees on `window.noggin`.
- `IPC` — channel-name constants.
- `IpcResult<T>` — the `{ ok, data | error }` envelope every call returns.

The preload script ([`src/preload/index.ts`](src/preload/index.ts))
forwards every method to `ipcRenderer.invoke(channel, ...)`. The main
process ([`src/main/index.ts`](src/main/index.ts)) registers an
`ipcMain.handle` for each channel that wraps the engine call in the
envelope and returns it.

To add a verb to the renderer:

1. Add the method shape to `NogginIpc` and a channel name to `IPC`.
2. Add the matching `contextBridge` forwarding in preload.
3. Add the matching `ipcMain.handle` in main.
4. Use `await window.noggin.X(...)` in React.

It's all type-safe end to end because the `NogginIpc` types reference
the same option / result interfaces (`AddOptions`, `CurrentTreeView`,
etc.) that the engine exports in `noggin-api.d.mts`.

## Why Electron and not Tauri

The engine is already a Node package. Tauri's WebView2 + Rust shell
would force the API into a sub-process or an FFI binding to be usable
from the UI. With Electron the main process *is* a Node process, so
the API is a normal import. We pay ~80 MB of disk and ~150 MB of RAM
for that simplicity; the trade matches the brief ("super lightweight"
is relative — even Electron beats a typical browser tab).

If lightweight becomes a hard constraint, the path is Tauri + the
shipped `noggin-mcp.bundle.mjs` as a sidecar (stdio JSON-RPC), and
the renderer stays mostly the same.
