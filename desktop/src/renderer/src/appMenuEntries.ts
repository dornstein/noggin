// The desktop app's contribution to the sidebar's ⋮ kebab menu.
//
// When the native app menu was stripped to built-in roles, its
// app-specific actions (details-pane layout, keyboard shortcuts,
// installed providers, about) moved here — surfaced as
// `extraMenuEntries` on @noggin/ui's `NogginList`. Kept as a pure
// builder so it's unit-testable without a DOM (tier 1).

import type { TreeContextMenuEntry } from '@noggin/ui';

export type DetailsLocation = 'right' | 'below';

/** Callbacks the kebab entries dispatch to. */
export interface AppMenuHandlers {
  setDetailsLocation: (loc: DetailsLocation) => void;
  onShortcuts: () => void;
  onProviders: () => void;
  onAbout: () => void;
}

/**
 * Build the desktop-supplied kebab entries. The details-pane radios
 * reflect `detailsLocation`; every other entry dispatches to a handler.
 */
export function buildAppMenuEntries(
  detailsLocation: DetailsLocation,
  h: AppMenuHandlers,
): TreeContextMenuEntry[] {
  return [
    { kind: 'header', key: 'h-details', label: 'Details pane' },
    { kind: 'radio', key: 'details-right', label: 'On the right', groupKey: 'details', value: 'right', groupValue: detailsLocation, onSelectValue: (v) => h.setDetailsLocation(v as DetailsLocation) },
    { kind: 'radio', key: 'details-below', label: 'Below the tree', groupKey: 'details', value: 'below', groupValue: detailsLocation, onSelectValue: (v) => h.setDetailsLocation(v as DetailsLocation) },
    { kind: 'separator', key: 'sep-app' },
    { kind: 'item', key: 'shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard', onClick: h.onShortcuts },
    { kind: 'item', key: 'providers', label: 'Installed providers\u2026', icon: 'extensions', onClick: h.onProviders },
    { kind: 'item', key: 'about', label: 'About noggin', icon: 'info', onClick: h.onAbout },
  ];
}
