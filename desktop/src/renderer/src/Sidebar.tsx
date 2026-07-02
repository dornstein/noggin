// Sidebar — desktop's wrapper around `<NogginList>` from
// `@noggin/ui`.
//
// Per the noggin-list plan (docs/plans/2026-06-noggin-list.md),
// every visible affordance — rows, badges, gauges, kebab menu,
// `+` menu, drag-reorder, copy chips, keyboard nav — lives in
// `NogginList` itself. This wrapper just hosts the store /
// providers / prefs glue and a frame for the sidebar host.
//
// Hosts that want a different surface (header background, splitter
// chrome, etc.) can fork this file; the component below intentionally
// adds zero behaviour.

import type { ReactElement } from 'react';
import {
  NogginList,
  type MRUReader,
  type NogginListStore,
  type NogginListPrefs,
  type NogginProviderTypeReader,
  type TreeContextMenuEntry,
} from '@noggin/ui';

export interface SidebarProps {
  store: NogginListStore;
  providers: NogginProviderTypeReader;
  prefs: NogginListPrefs;
  onPrefsChange: (next: NogginListPrefs) => void;
  onActivate: (uri: string) => void;
  onCloseActiveEntry: () => void;
  /** Extra entries appended to the ⋮ kebab menu (app-level actions
   *  the desktop host surfaces here instead of on a native menu). */
  extraMenuEntries?: readonly TreeContextMenuEntry[];
  /** Optional MRU reader. Drives the "Recent" submenu, sort modes,
   *  and the per-row relative-time chip. */
  recent?: MRUReader;
}

export function Sidebar(props: SidebarProps): ReactElement {
  return (
    <NogginList
      store={props.store}
      providers={props.providers}
      prefs={props.prefs}
      onPrefsChange={props.onPrefsChange}
      onActivate={props.onActivate}
      onCloseActiveEntry={props.onCloseActiveEntry}
      extraMenuEntries={props.extraMenuEntries}
      recent={props.recent}
    />
  );
}
