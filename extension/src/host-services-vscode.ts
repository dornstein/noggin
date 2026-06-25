// VS Code implementation of `HostServices` from @noggin/rpc.
//
// The webview running the React App makes `host.*` RPC calls; the
// rpc server dispatches them through this HostServices. We answer
// with the vscode.window dialog APIs.
//
// Why HostServices and not custom IPC? Because the webview-side UI
// in @noggin/ui already calls these methods via the rpc client.
// Implementing HostServices here means the same UI code that runs in
// the desktop renderer will work unchanged inside VS Code — that's
// the whole point of Phase 5.

import * as vscode from 'vscode';

import type {
  HostOpenExternalRequest,
  HostOpenExternalResponse,
  HostPickFileRequest,
  HostPickFileResponse,
  HostPickNewFileRequest,
  HostPickNewFileResponse,
  HostServices,
  HostShowConfirmRequest,
  HostShowConfirmResponse,
  HostShowErrorRequest,
  HostShowErrorResponse,
  HostShowInputBoxRequest,
  HostShowInputBoxResponse,
  HostShowQuickPickRequest,
  HostShowQuickPickResponse,
} from '@noggin/rpc';

export function createVsCodeHostServices(): HostServices {
  return {
    async pickFile(opts: HostPickFileRequest): Promise<HostPickFileResponse> {
      const result = await vscode.window.showOpenDialog({
        title: opts.title,
        defaultUri: opts.defaultPath ? vscode.Uri.file(opts.defaultPath) : undefined,
        canSelectMany: !!opts.multiple,
        canSelectFiles: true,
        canSelectFolders: false,
        filters: toVsCodeFilters(opts.filters),
        openLabel: 'Open',
      });
      if (!result || result.length === 0) return { paths: [] };
      return { paths: result.map((u) => u.fsPath) };
    },

    async pickNewFile(opts: HostPickNewFileRequest): Promise<HostPickNewFileResponse> {
      const result = await vscode.window.showSaveDialog({
        title: opts.title,
        defaultUri: opts.defaultPath ? vscode.Uri.file(opts.defaultPath) : undefined,
        filters: toVsCodeFilters(opts.filters),
        saveLabel: 'Create',
      });
      if (!result) return { path: null };
      return { path: result.fsPath };
    },

    async showInputBox(opts: HostShowInputBoxRequest): Promise<HostShowInputBoxResponse> {
      const result = await vscode.window.showInputBox({
        title: opts.title,
        prompt: opts.prompt,
        placeHolder: opts.placeholder,
        value: opts.value,
        password: !!opts.password,
      });
      return { value: typeof result === 'string' ? result : null };
    },

    async showQuickPick(opts: HostShowQuickPickRequest): Promise<HostShowQuickPickResponse> {
      const items = opts.items.map((it, idx): vscode.QuickPickItem & { _idx: number } => ({
        label: it.label,
        description: it.description,
        detail: it.detail,
        _idx: idx,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        title: opts.title,
        placeHolder: opts.placeholder,
        canPickMany: false,
      }) as (vscode.QuickPickItem & { _idx: number }) | undefined;
      if (!picked) return { selected: null };
      const original = opts.items[picked._idx];
      return {
        selected: original
          ? {
              label: original.label,
              description: original.description,
              detail: original.detail,
              value: original.value,
            }
          : { label: picked.label },
      };
    },

    async showConfirm(opts: HostShowConfirmRequest): Promise<HostShowConfirmResponse> {
      const confirmLabel = opts.confirmLabel ?? 'OK';
      // showInformationMessage with { modal: true } gives us a real
      // modal dialog and lets us specify a custom confirm button. The
      // cancel button is built-in; opts.cancelLabel is honored via
      // `detail` on platforms where the modal supports it. (Many
      // platforms render only the title + buttons, so cancelLabel is
      // best-effort.)
      const result = await vscode.window.showInformationMessage(
        opts.message,
        { modal: true, detail: opts.title },
        confirmLabel,
      );
      return { confirmed: result === confirmLabel };
    },

    async showError(opts: HostShowErrorRequest): Promise<HostShowErrorResponse> {
      const message = opts.detail ? `${opts.message}\n\n${opts.detail}` : opts.message;
      void vscode.window.showErrorMessage(message);
      return { acknowledged: true };
    },

    async openExternal(opts: HostOpenExternalRequest): Promise<HostOpenExternalResponse> {
      try {
        const uri = vscode.Uri.parse(opts.target, true);
        if (uri.scheme !== 'http' && uri.scheme !== 'https' && uri.scheme !== 'mailto') {
          return { opened: false };
        }
        const ok = await vscode.env.openExternal(uri);
        return { opened: ok };
      } catch {
        return { opened: false };
      }
    },
  };
}

function toVsCodeFilters(
  filters: readonly { readonly name: string; readonly extensions: readonly string[] }[] | undefined,
): Record<string, string[]> | undefined {
  if (!filters || filters.length === 0) return undefined;
  const out: Record<string, string[]> = {};
  for (const f of filters) out[f.name] = [...f.extensions];
  return out;
}
