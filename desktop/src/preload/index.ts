// Electron preload script.
//
// Runs in an isolated context with access to Node-style APIs but
// separated from the renderer's main world. Uses `contextBridge` to
// expose a small, typed `window.noggin` API that the React app talks
// to. The shapes match `@shared/ipc.ts` exactly.

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@shared/ipc';

contextBridge.exposeInMainWorld('noggin', {
  open: (file: string) => ipcRenderer.invoke(IPC.open, file),
  where: () => ipcRenderer.invoke(IPC.where),
  show: (opts?: unknown) => ipcRenderer.invoke(IPC.show, opts),
  push: (opts: unknown) => ipcRenderer.invoke(IPC.push, opts),
  add: (opts: unknown) => ipcRenderer.invoke(IPC.add, opts),
  goto: (p: string) => ipcRenderer.invoke(IPC.goto, p),
  done: (opts?: unknown) => ipcRenderer.invoke(IPC.done, opts),
  pop: (opts?: unknown) => ipcRenderer.invoke(IPC.pop, opts),
  edit: (opts: unknown) => ipcRenderer.invoke(IPC.edit, opts),
  note: (opts: unknown) => ipcRenderer.invoke(IPC.note, opts),
  move: (opts: unknown) => ipcRenderer.invoke(IPC.move, opts),
  delete: (opts: unknown) => ipcRenderer.invoke(IPC.delete, opts),

  /**
   * Subscribe to noggin-change events. Returns an unsubscribe
   * function. We don't pass the underlying IpcRendererEvent through
   * to the renderer's handler — the renderer doesn't need to know
   * about electron internals.
   */
  onDidChange: (handler: () => void): (() => void) => {
    const listener = () => handler();
    ipcRenderer.on(IPC.changed, listener);
    return () => ipcRenderer.removeListener(IPC.changed, listener);
  },
});
