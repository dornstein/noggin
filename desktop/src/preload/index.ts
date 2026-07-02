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

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import { HOST_SERVICES_RPC, type HostServicesRpcReply, type HostServicesRpcRequest } from '@shared/host-services-rpc';

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

// ── Expose to the renderer's main world ──────────────────────────────

contextBridge.exposeInMainWorld('nogginRpcIpc', nogginRpcIpc);
contextBridge.exposeInMainWorld('hostServicesRpc', hostServicesRpc);
