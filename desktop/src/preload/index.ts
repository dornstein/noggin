// Electron preload script.
//
// Phase 4 of the noggin-rpc plan tightened the renderer back to
// standard Electron defaults: `contextIsolation: true`, `sandbox: true`,
// `nodeIntegration: false`. The preload runs in an isolated world and
// uses `contextBridge.exposeInMainWorld` to publish narrowed APIs to
// the renderer's main world. The renderer has no `require`, no
// `process`, no direct `electron` import.
//
// Three surfaces are exposed:
//
//   window.shell        — legacy shell IPC (file dialogs + menu wiring).
//                         Kept around so the gradual Phase 4 cutover
//                         doesn't ripple through every callsite at once.
//
//   window.nogginRpcIpc — narrowed `IpcRendererLike` bound to the
//                         `'noggin-rpc'` channel. The renderer wraps
//                         this with `createElectronIpcRendererTransport`
//                         to drive a noggin-rpc RpcClient against the
//                         main-process server.
//
//   window.modalIpc     — separate modal-request channel for the three
//                         HostServices methods that need React UI
//                         (showInputBox, showQuickPick, showConfirm).
//                         Renderer-internal contract, NOT noggin-rpc.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import { SHELL_IPC, type MenuAction, type MenuState, type ShellApi } from '@shared/ipc';
import { MODAL_IPC, type ModalReply, type ModalRequest } from '@shared/modal-ipc';

// ── window.shell ─────────────────────────────────────────────────────

const shell: ShellApi = {
  pickFile: () => ipcRenderer.invoke(SHELL_IPC.pickFile),
  pickNewFile: (defaultName?: string) => ipcRenderer.invoke(SHELL_IPC.pickNewFile, defaultName),
  showError: (message: string, detail?: string) => {
    ipcRenderer.send(SHELL_IPC.showError, { message, detail });
  },
  openExternal: (url: string) => {
    ipcRenderer.send(SHELL_IPC.openExternal, url);
  },
  setMenuState: (state: MenuState) => {
    ipcRenderer.send(SHELL_IPC.setMenuState, state);
  },
  onMenuAction: (handler: (action: MenuAction) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, action: MenuAction) => handler(action);
    ipcRenderer.on(SHELL_IPC.menuAction, listener);
    return () => ipcRenderer.removeListener(SHELL_IPC.menuAction, listener);
  },
};

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

// ── window.modalIpc ──────────────────────────────────────────────────

/** Narrow API for the modal round-trip channel. */
export interface ModalIpc {
  onRequest(handler: (req: ModalRequest) => void): () => void;
  sendReply(reply: ModalReply): void;
}

const modalIpc: ModalIpc = {
  onRequest(handler) {
    const listener = (_e: IpcRendererEvent, req: ModalRequest) => handler(req);
    ipcRenderer.on(MODAL_IPC.request, listener);
    return () => ipcRenderer.removeListener(MODAL_IPC.request, listener);
  },
  sendReply(reply) {
    ipcRenderer.send(MODAL_IPC.reply, reply);
  },
};

// ── Expose to the renderer's main world ──────────────────────────────

contextBridge.exposeInMainWorld('shell', shell);
contextBridge.exposeInMainWorld('nogginRpcIpc', nogginRpcIpc);
contextBridge.exposeInMainWorld('modalIpc', modalIpc);
