// Electron preload script.
//
// Runs in an isolated context, exposes a typed `window.noggin` API
// via `contextBridge`. The shapes match `@shared/ipc.ts` exactly.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type OpenState } from '@shared/ipc';

contextBridge.exposeInMainWorld('noggin', {
  open: (file: string) => ipcRenderer.invoke(IPC.open, file),
  close: () => ipcRenderer.invoke(IPC.close),
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

  recents: {
    list: () => ipcRenderer.invoke(IPC.recentsList),
    pickFile: () => ipcRenderer.invoke(IPC.recentsPickFile),
    remove: (location: string) => ipcRenderer.invoke(IPC.recentsRemove, location),
  },

  onDidChange: (handler: () => void): (() => void) => {
    const listener = () => handler();
    ipcRenderer.on(IPC.changed, listener);
    return () => ipcRenderer.removeListener(IPC.changed, listener);
  },

  onDidOpenChange: (handler: (state: OpenState) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, state: OpenState) => handler(state);
    ipcRenderer.on(IPC.openChanged, listener);
    return () => ipcRenderer.removeListener(IPC.openChanged, listener);
  },
});
