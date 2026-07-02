// Shared IPC contract for the Help menu items surfaced in the
// custom title bar's hamburger.
//
// Both actions live in the main process: `openUrl` routes through
// `shell.openExternal` (so links open in the OS default browser),
// and `showAbout` triggers the same native dialog the app-menu
// handler builds.

export const HELP_IPC = {
  /** renderer → main: open a URL in the OS default browser. */
  openUrl: 'help:open-url',
  /** renderer → main: show the About dialog. */
  showAbout: 'help:show-about',
} as const;
