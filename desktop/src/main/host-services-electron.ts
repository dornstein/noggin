// Electron implementation of `HostServices`.
//
// `pickFile` / `pickNewFile` / `showError` / `openExternal` are
// handled natively by main. `showInputBox` / `showQuickPick` /
// `showConfirm` need React UI, which only the renderer can render —
// so main forwards those over the host-services RPC arc to the
// renderer's `HostServicesReactImpl`, and awaits the reply. The
// channel contract is in `@shared/host-services-rpc`; this module is
// the main-side client.

import { dialog, shell, type BrowserWindow } from 'electron';
import { existsSync, writeFileSync } from 'node:fs';

import type {
  HostOpenExternalRequest,
  HostOpenExternalResponse,
  HostPickFileRequest,
  HostPickFileResponse,
  HostPickNewFileRequest,
  HostPickNewFileResponse,
  HostShowConfirmRequest,
  HostShowConfirmResponse,
  HostShowErrorRequest,
  HostShowErrorResponse,
  HostShowInputBoxRequest,
  HostShowInputBoxResponse,
  HostShowQuickPickRequest,
  HostShowQuickPickResponse,
  HostServices,
} from '@noggin/rpc';

import { createHostServicesRpcClient } from './host-services-rpc-client.js';

/** Seed content for a freshly-created noggin file. The engine's file
 *  provider won't open a path that doesn't exist yet, so `pickNewFile`
 *  writes this at the chosen path when the file is new. */
const EMPTY_NOGGIN_YAML = 'schemaVersion: 1\nactive: null\nitems: []\n';

/** Build a HostServices bound to the given window. */
export function createElectronHostServices(window: BrowserWindow): HostServices {
  const rendererImpl = createHostServicesRpcClient(window);

  return {
    async pickFile(opts: HostPickFileRequest): Promise<HostPickFileResponse> {
      const result = await dialog.showOpenDialog(window, {
        title: opts.title ?? 'Open noggin',
        defaultPath: opts.defaultPath,
        filters: toElectronFilters(opts.filters),
        properties: opts.multiple
          ? ['openFile', 'multiSelections']
          : ['openFile'],
      });
      if (result.canceled) return { paths: [] };
      return { paths: result.filePaths };
    },

    async pickNewFile(opts: HostPickNewFileRequest): Promise<HostPickNewFileResponse> {
      const result = await dialog.showSaveDialog(window, {
        title: opts.title ?? 'Create new noggin',
        defaultPath: opts.defaultPath ?? '.noggin.yaml',
        filters: toElectronFilters(opts.filters),
      });
      if (result.canceled || !result.filePath) return { path: null };
      // Seed an empty noggin if the user picked a fresh path — the file
      // provider would otherwise fail on open.
      if (!existsSync(result.filePath)) {
        writeFileSync(result.filePath, EMPTY_NOGGIN_YAML, 'utf8');
      }
      return { path: result.filePath };
    },

    async showError(opts: HostShowErrorRequest): Promise<HostShowErrorResponse> {
      // showErrorBox is sync and modal — fine for an error popup.
      dialog.showErrorBox(opts.message, opts.detail ?? '');
      return { acknowledged: true };
    },

    async openExternal(opts: HostOpenExternalRequest): Promise<HostOpenExternalResponse> {
      // Only http(s) URLs. Block mailto:, file://, app:, etc. — those
      // could surprise the user from a renderer-driven request.
      if (typeof opts.target !== 'string' || !/^https?:\/\//i.test(opts.target)) {
        return { opened: false };
      }
      await shell.openExternal(opts.target);
      return { opened: true };
    },

    showInputBox(opts: HostShowInputBoxRequest): Promise<HostShowInputBoxResponse> {
      return rendererImpl.request<HostShowInputBoxResponse>('inputBox', opts);
    },

    showQuickPick(opts: HostShowQuickPickRequest): Promise<HostShowQuickPickResponse> {
      return rendererImpl.request<HostShowQuickPickResponse>('quickPick', opts);
    },

    showConfirm(opts: HostShowConfirmRequest): Promise<HostShowConfirmResponse> {
      return rendererImpl.request<HostShowConfirmResponse>('confirm', opts);
    },
  };
}

function toElectronFilters(
  filters: readonly { readonly name: string; readonly extensions: readonly string[] }[] | undefined,
): Electron.FileFilter[] | undefined {
  if (!filters) return undefined;
  return filters.map((f) => ({ name: f.name, extensions: [...f.extensions] }));
}
