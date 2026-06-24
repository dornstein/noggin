// Thin shell IPC contract between main and renderer.
//
// As of the single-process collapse, the renderer holds the noggin
// engine in-process (nodeIntegration: true) and talks to verbs.*
// directly. The only things that still need IPC are operations the
// renderer can't do alone:
//
//   - File / save dialogs (must run in main, anchored to BrowserWindow).
//   - Native error dialogs.
//   - Opening external URLs in the OS default browser.
//   - Application-menu wiring: renderer pushes state (which items are
//     enabled / checked), main pushes back the action when the user
//     clicks a menu item.
//
// Everything else \u2014 engine, file backend, recents list \u2014 lives in
// the renderer.

/** Result envelope used by every shell IPC call. */
export type ShellResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/** Actions the application menu can fire at the renderer. */
export type MenuAction =
  | 'new'
  | 'open'
  | 'close'
  | 'toggleSidebar'
  | 'detailsRight'
  | 'detailsBelow'
  | 'shortcuts'
  | 'about';

/** State the renderer pushes to main so menu items can update. */
export interface MenuState {
  hasNoggin: boolean;
  sidebarOpen: boolean;
  detailsLocation: 'right' | 'below';
}

/** API exposed on `window.shell` by the preload script. */
export interface ShellApi {
  /** Show a native open-file dialog for noggin YAML files. */
  pickFile(): Promise<ShellResult<string | null>>;
  /** Show a native save-file dialog and return the chosen path. */
  pickNewFile(defaultName?: string): Promise<ShellResult<string | null>>;
  /** Show a native error dialog. */
  showError(message: string, detail?: string): void;
  /** Open a URL in the OS default browser (Help menu links etc.). */
  openExternal(url: string): void;
  /** Push current renderer state so application-menu items can update enablement / checks. */
  setMenuState(state: MenuState): void;
  /** Subscribe to actions fired by the application menu. Returns unsubscribe. */
  onMenuAction(handler: (action: MenuAction) => void): () => void;
}

/** IPC channel names. Single source of truth so main + preload don't drift. */
export const SHELL_IPC = {
  pickFile: 'shell:pickFile',
  pickNewFile: 'shell:pickNewFile',
  showError: 'shell:showError',
  openExternal: 'shell:openExternal',
  setMenuState: 'shell:setMenuState',
  menuAction: 'shell:menuAction', // main → renderer
} as const;
