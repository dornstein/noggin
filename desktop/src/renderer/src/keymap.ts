// Keyboard accelerators for the desktop app.
//
// The native application menu is purely native now (built-in roles +
// Help links) and no longer registers app shortcuts, so the renderer
// handles these itself. Kept as a pure function so it's unit-testable
// without a DOM (tier 1).

/** An app-level action a global accelerator can trigger. */
export type AppAccelerator = 'new' | 'open' | 'close' | 'toggleSidebar' | 'shortcuts';

/** The subset of a `KeyboardEvent` the matcher reads. */
export interface AcceleratorEvent {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly key: string;
}

/**
 * Map a keydown event to an app accelerator, or `null` if it isn't one.
 *
 * Requires Ctrl (Win/Linux) or Cmd (mac) and explicitly rejects Alt, so
 * it never steals Alt-mnemonics or AltGr combos. Cut / Copy / Paste /
 * Select-All are deliberately absent — those stay on the native
 * Edit-menu roles.
 */
export function matchAccelerator(e: AcceleratorEvent): AppAccelerator | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  switch (e.key.toLowerCase()) {
    case 'n': return 'new';
    case 'o': return 'open';
    case 'w': return 'close';
    case 'b': return 'toggleSidebar';
    case '/': return 'shortcuts';
    default: return null;
  }
}
