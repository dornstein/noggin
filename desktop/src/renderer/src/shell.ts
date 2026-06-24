// Renderer-side access to the shell preload API. The renderer never
// imports from 'electron' directly; it talks to main through
// `window.shell` which the preload script populates.
//
// When the renderer is loaded outside Electron (e.g. http://localhost:5174
// in a plain browser, used for UI iteration), `window.shell` is absent
// and we substitute a no-op shim so the app boots. Dialog calls return
// "canceled" instead of opening a native picker.

import type { ShellApi, MenuAction, MenuState, ShellResult } from '@shared/ipc';

declare global {
  interface Window {
    shell?: ShellApi;
  }
}

const noopShell: ShellApi = {
  pickFile: async (): Promise<ShellResult<string | null>> =>
    ({ ok: false, error: { code: 'no-shell', message: 'Native file picker is only available in Electron. Use the sidebar to switch noggins.' } }),
  pickNewFile: async (): Promise<ShellResult<string | null>> =>
    ({ ok: false, error: { code: 'no-shell', message: 'Native file picker is only available in Electron.' } }),
  showError: (message: string, detail?: string) => {
    console.error('[shell:error]', message, detail || '');
  },
  openExternal: (url: string) => {
    // Best-effort fallback when running in a plain browser: just open
    // a new tab. In Electron, preload routes this through main.
    try { window.open(url, '_blank', 'noopener'); } catch { /* ignore */ }
  },
  setMenuState: (_state: MenuState) => { /* no menu in a plain browser */ },
  onMenuAction: (_handler: (action: MenuAction) => void) => () => { /* no menu events */ },
};

export const shell: ShellApi = window.shell ?? noopShell;
