// Electron implementation of `ProviderFlows`.
//
// The engine providers (`file`, `memory`) know how to open noggins at
// a given location, but they don't know how to PICK a location. That
// UX is host-specific — for desktop it's a native open / save dialog.
//
// We answer the three flow methods we care about today:
//   - pickToOpen('file://', …)   → native open dialog
//   - create('file://', …)       → native save dialog + an empty
//                                    YAML file at the chosen path
//   - describe(scheme)           → static labels per scheme
//
// `listInstances` isn't wired here — desktop's "recents" list lives
// in the renderer (`recents.ts` in localStorage), and Phase 4 keeps
// that arrangement. A future phase can move recents into a
// provider-listInstances surface if we want server-side recents.

import { writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { dialog, type BrowserWindow } from 'electron';

import type { ProviderFlows } from '@noggin/rpc';

const EMPTY_NOGGIN_YAML = 'schemaVersion: 1\nactive: null\nitems: []\n';

const DESCRIPTIONS: Record<string, { displayName: string; description: string }> = {
  'file://': {
    displayName: 'Local file',
    description: 'YAML file on disk. Watched for external edits.',
  },
  'memory://': {
    displayName: 'In-memory',
    description: 'Ephemeral noggin held only in this process. Lost on close.',
  },
};

export function createElectronProviderFlows(window: BrowserWindow): ProviderFlows {
  return {
    async describe(scheme: string) {
      return DESCRIPTIONS[scheme] ?? {};
    },

    async pickToOpen(scheme: string): Promise<string | null> {
      if (scheme !== 'file://') return null;
      const result = await dialog.showOpenDialog(window, {
        title: 'Open noggin',
        properties: ['openFile'],
        filters: [
          { name: 'Noggin (YAML)', extensions: ['yaml', 'yml'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      // Return a canonical `file://` location, not the raw OS path: the
      // engine's `noggin.open` resolves providers by URL scheme.
      return pathToFileURL(result.filePaths[0]).href;
    },

    async create(scheme: string): Promise<string | null> {
      if (scheme !== 'file://') return null;
      const result = await dialog.showSaveDialog(window, {
        title: 'Create new noggin',
        defaultPath: '.noggin.yaml',
        filters: [{ name: 'Noggin (YAML)', extensions: ['yaml'] }],
      });
      if (result.canceled || !result.filePath) return null;
      if (!existsSync(result.filePath)) {
        writeFileSync(result.filePath, EMPTY_NOGGIN_YAML, 'utf8');
      }
      return pathToFileURL(result.filePath).href;
    },
  };
}
