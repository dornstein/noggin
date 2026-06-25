// Electron preload script.
//
// Exposes two surfaces to the renderer:
//
//   window.shell        — small shell IPC API used by the renderer
//                         App for legacy file-picker / menu wiring.
//                         Kept around so the gradual Phase 4 cutover
//                         doesn't ripple through every callsite at
//                         once; new code should prefer the HostServices
//                         path over noggin-rpc.
//
//   window.nogginRpcIpc — narrowed `IpcRendererLike` bound to the
//                         `'noggin-rpc'` channel. The renderer wraps
//                         this with `createElectronIpcRendererTransport`
//                         to drive a real noggin-rpc RpcClient against
//                         the main-process server.
//
//   window.modalIpc     — separate modal-request channel for the three
//                         HostServices methods that need React UI
//                         (showInputBox, showQuickPick, showConfirm).
//                         Renderer-internal contract, NOT noggin-rpc.
//
// `contextIsolation` is currently `false`, so `contextBridge.exposeInMainWorld`
// is a no-op; we set the bridges by direct assignment. The Phase 4
// security-tightening commit flips contextIsolation back on and
// switches these to `contextBridge` calls.

import { ipcRenderer, type IpcRendererEvent } from 'electron';
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

(window as unknown as { shell: ShellApi }).shell = shell;

// ── window.nogginRpcIpc ──────────────────────────────────────────────

/** Renderer-side handle for the noggin-rpc IPC channel. Shape matches
 *  the `IpcRendererLike` interface expected by
 *  `createElectronIpcRendererTransport`, with the channel name baked in
 *  so the renderer can't accidentally send on a different one. */
export interface NogginRpcIpc {
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): NogginRpcIpc;
  off(channel: string, listener: (event: unknown, ...args: unknown[]) => void): NogginRpcIpc;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): NogginRpcIpc;
}

const RPC_CHANNEL = 'noggin-rpc';

const nogginRpcIpc: NogginRpcIpc = {
  send(channel, ...args) {
    if (channel !== RPC_CHANNEL) return;  // narrow scope; ignore others
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

(window as unknown as { nogginRpcIpc: NogginRpcIpc }).nogginRpcIpc = nogginRpcIpc;

// ── window.modalIpc ──────────────────────────────────────────────────

/** Narrow API for the modal round-trip channel. */
export interface ModalIpc {
  /** Subscribe to modal-request notifications from main. Returns an
   *  unsubscribe function. */
  onRequest(handler: (req: ModalRequest) => void): () => void;
  /** Send a reply back to main. */
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

(window as unknown as { modalIpc: ModalIpc }).modalIpc = modalIpc;
