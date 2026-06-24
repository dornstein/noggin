// Electron preload script.
//
// Exposes `window.shell` — a small surface for OS-level operations the
// renderer can't perform alone (file/save dialogs, native error
// popups, opening external URLs, and application-menu wiring). The
// noggin engine itself runs entirely in the renderer process
// (nodeIntegration is enabled in the BrowserWindow), so this preload
// no longer carries the engine verbs.
//
// `contextIsolation` is `false` so the renderer main world has
// `require` and can load the engine + file backend directly. With
// isolation off, `contextBridge.exposeInMainWorld` is a no-op, so we
// set `window.shell` by direct assignment instead.

import { ipcRenderer, type IpcRendererEvent } from 'electron';
import { SHELL_IPC, type MenuAction, type MenuState, type ShellApi } from '@shared/ipc';

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
