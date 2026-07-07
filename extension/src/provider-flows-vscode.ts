// VS Code implementation of `ProviderFlows` from @noggin/rpc.
//
// Mirrors desktop/src/main/provider-flows-electron.ts: drives the
// provider's "open" / "create" UX from the HOST process (native VS
// Code dialogs), returning a canonical `file://` location the
// engine's `noggin.open` can consume. Only `file://` is wired here —
// `memory://` noggins aren't user-creatable from a picker (see
// @noggin/ui's `defaultNogginProviders` doc comment).

import { existsSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as vscode from 'vscode';
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

function defaultNogginUri(): vscode.Uri {
  const folders = vscode.workspace.workspaceFolders;
  const defaultDir = folders && folders.length ? folders[0].uri.fsPath : os.homedir();
  return vscode.Uri.file(path.join(defaultDir, '.noggin.yaml'));
}

export function createVsCodeProviderFlows(): ProviderFlows {
  return {
    async describe(scheme: string) {
      return DESCRIPTIONS[scheme] ?? {};
    },

    async pickToOpen(scheme: string): Promise<string | null> {
      if (scheme !== 'file://') return null;
      const result = await vscode.window.showOpenDialog({
        title: 'Open noggin',
        defaultUri: defaultNogginUri(),
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: false,
        filters: { 'Noggin (YAML)': ['yaml', 'yml'], 'All files': ['*'] },
        openLabel: 'Open',
      });
      if (!result || result.length === 0) return null;
      // Return a canonical `file://` location, not the raw OS path: the
      // engine's `noggin.open` resolves providers by URL scheme.
      return pathToFileURL(result[0].fsPath).href;
    },

    async create(scheme: string): Promise<string | null> {
      if (scheme !== 'file://') return null;
      const result = await vscode.window.showSaveDialog({
        title: 'Create new noggin',
        defaultUri: defaultNogginUri(),
        filters: { 'Noggin (YAML)': ['yaml'] },
        saveLabel: 'Create',
      });
      if (!result) return null;
      if (!existsSync(result.fsPath)) {
        writeFileSync(result.fsPath, EMPTY_NOGGIN_YAML, 'utf8');
      }
      return pathToFileURL(result.fsPath).href;
    },
  };
}
