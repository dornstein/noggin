// Electron preload script.
//
// Phase 4 of the noggin-rpc plan tightened the renderer back to
// standard Electron defaults: `contextIsolation: true`, `sandbox: true`,
// `nodeIntegration: false`. The preload runs in an isolated world and
// uses `contextBridge.exposeInMainWorld` to publish narrowed APIs to
// the renderer's main world. The renderer has no `require`, no
// `process`, no direct `electron` import.
//
// Two surfaces are exposed:
//
//   window.nogginRpcIpc — narrowed `IpcRendererLike` bound to the
//                         `'noggin-rpc'` channel. The renderer wraps
//                         this with `createElectronIpcRendererTransport`
//                         to drive a noggin-rpc RpcClient against the
//                         main-process server.
//
//   window.hostServicesRpc — the renderer end of the host-services RPC
//                         arc. Main forwards the HostServices methods
//                         it can't fulfil itself (today showInputBox,
//                         showQuickPick, showConfirm) to the renderer's
//                         `HostServicesReactImpl` over this channel and
//                         awaits a reply. Distinct from noggin-rpc, and
//                         runs the opposite direction (main → renderer).

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';

import { HOST_SERVICES_RPC, type HostServicesRpcReply, type HostServicesRpcRequest } from '@shared/host-services-rpc';
import { UPDATER_IPC, type UpdaterStatus } from '@shared/updater';
import { HELP_IPC } from '@shared/help';

// ── window.nogginRpcIpc ──────────────────────────────────────────────

/** Renderer-side handle for the noggin-rpc IPC channel. Shape matches
 *  the `IpcRendererLike` interface expected by
 *  `createElectronIpcRendererTransport`, with channel scoping enforced
 *  in this preload so a misuse from the renderer can't send on an
 *  arbitrary channel. */
export interface NogginRpcIpc {
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): NogginRpcIpc;
  off(channel: string, listener: (event: unknown, ...args: unknown[]) => void): NogginRpcIpc;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): NogginRpcIpc;
}

const RPC_CHANNEL = 'noggin-rpc';

const nogginRpcIpc: NogginRpcIpc = {
  send(channel, ...args) {
    if (channel !== RPC_CHANNEL) return;
    ipcRenderer.send(channel, ...args);
  },
  on(channel, listener) {
    if (channel === RPC_CHANNEL) ipcRenderer.on(channel, listener);
    return nogginRpcIpc;
  },
  off(channel, listener) {
    if (channel === RPC_CHANNEL) ipcRenderer.removeListener(channel, listener);
    return nogginRpcIpc;
  },
  removeListener(channel, listener) {
    if (channel === RPC_CHANNEL) ipcRenderer.removeListener(channel, listener);
    return nogginRpcIpc;
  },
};

// ── window.hostServicesRpc ────────────────────────────────────

/** Narrow API for the renderer end of the host-services RPC arc. */
export interface HostServicesRpcBridge {
  onRequest(handler: (req: HostServicesRpcRequest) => void): () => void;
  sendReply(reply: HostServicesRpcReply): void;
}

const hostServicesRpc: HostServicesRpcBridge = {
  onRequest(handler) {
    const listener = (_e: IpcRendererEvent, req: HostServicesRpcRequest) => handler(req);
    ipcRenderer.on(HOST_SERVICES_RPC.request, listener);
    return () => ipcRenderer.removeListener(HOST_SERVICES_RPC.request, listener);
  },
  sendReply(reply) {
    ipcRenderer.send(HOST_SERVICES_RPC.reply, reply);
  },
};

// ── window.updater ───────────────────────────────────────────────────
//
// Streams UpdaterStatus transitions from the main-process electron-updater
// state machine to the renderer, and lets the renderer request a
// re-check or restart-to-install. See `desktop/src/shared/updater.ts`
// for the wire contract and `desktop/src/renderer/src/TitleBar.tsx`
// for the primary consumer.

export interface UpdaterBridge {
  /** Fetch the current status snapshot. Useful on mount so a late
   *  subscriber picks up the state instead of waiting for the next
   *  transition. */
  getStatus(): Promise<UpdaterStatus>;
  /** Subscribe to status transitions. Returns an unsubscribe. */
  onStatus(handler: (status: UpdaterStatus) => void): () => void;
  /** Fire-and-forget: run a check now. Result comes back via `onStatus`. */
  checkNow(): void;
  /** Fire-and-forget: quit and install a downloaded update. */
  restartNow(): void;
}

const updater: UpdaterBridge = {
  getStatus() {
    return ipcRenderer.invoke(UPDATER_IPC.getStatus) as Promise<UpdaterStatus>;
  },
  onStatus(handler) {
    const listener = (_e: IpcRendererEvent, status: UpdaterStatus) => handler(status);
    ipcRenderer.on(UPDATER_IPC.status, listener);
    return () => ipcRenderer.removeListener(UPDATER_IPC.status, listener);
  },
  checkNow() {
    ipcRenderer.send(UPDATER_IPC.checkNow);
  },
  restartNow() {
    ipcRenderer.send(UPDATER_IPC.restartNow);
  },
};

// ── window.help ──────────────────────────────────────────────────────
//
// Two fire-and-forget actions the custom title bar's hamburger menu
// needs to reach main for: opening an external URL in the OS default
// browser (via `shell.openExternal`), and popping the native About
// dialog. The menu also has Check-for-Updates but that goes through
// `window.updater.checkNow()` since it drives the same state machine
// as the ambient title-bar indicator.

export interface HelpBridge {
  /** Open a URL in the OS default browser. Main is responsible for
   *  keeping the allowlist narrow (currently: repo, issues, docs). */
  openUrl(url: string): void;
  /** Show the native About dialog. */
  showAbout(): void;
}

const help: HelpBridge = {
  openUrl(url) { ipcRenderer.send(HELP_IPC.openUrl, url); },
  showAbout() { ipcRenderer.send(HELP_IPC.showAbout); },
};

// ── window.dnd ───────────────────────────────────────────────────────
//
// Electron 32 removed the `File.path` property that browsers never
// had but Electron used to add. The replacement is
// `webUtils.getPathForFile(file)` which only exists on the electron
// module — inaccessible from a sandboxed renderer. Expose it here so
// the file-drop handler in App.tsx can resolve a dropped File to its
// on-disk path (needed to convert into a `file://` URI and open).

export interface DndBridge {
  /** Return the absolute filesystem path for a dropped/File-picker
   *  `File`. Empty string if the object isn't backed by a real file
   *  (e.g. programmatic Blob). */
  getPathForFile(file: File): string;
}

const dnd: DndBridge = {
  getPathForFile(file) {
    try { return webUtils.getPathForFile(file); }
    catch { return ''; }
  },
};

// ── Expose to the renderer's main world ──────────────────────────────

contextBridge.exposeInMainWorld('nogginRpcIpc', nogginRpcIpc);
contextBridge.exposeInMainWorld('hostServicesRpc', hostServicesRpc);
contextBridge.exposeInMainWorld('updater', updater);
contextBridge.exposeInMainWorld('help', help);
contextBridge.exposeInMainWorld('dnd', dnd);
