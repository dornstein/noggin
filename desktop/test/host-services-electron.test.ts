// Electron HostServices behaviour tests (tier 1 · conformance/logic).
//
// Exercises the REAL `createElectronHostServices` (not the test stub):
// native dialogs answered in-process, the http(s)-only openExternal
// guard, the pickNewFile seeding, and the three render-required prompts
// delegating to the renderer over the host-services RPC arc.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

const { showOpenDialog, showSaveDialog, showErrorBox, openExternal } = vi.hoisted(() => ({
  showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showErrorBox: vi.fn(), openExternal: vi.fn(),
}));
const { existsSync, writeFileSync } = vi.hoisted(() => ({ existsSync: vi.fn(), writeFileSync: vi.fn() }));
const { request } = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('electron', () => ({
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  dialog: { showOpenDialog, showSaveDialog, showErrorBox },
  shell: { openExternal },
}));
vi.mock('node:fs', () => ({ existsSync, writeFileSync }));
vi.mock('../src/main/host-services-rpc-client', () => ({
  createHostServicesRpcClient: () => ({ request, dispose: vi.fn() }),
}));

import { createElectronHostServices } from '../src/main/host-services-electron';

const host = createElectronHostServices({} as never);

beforeEach(() => {
  for (const m of [showOpenDialog, showSaveDialog, showErrorBox, openExternal, existsSync, writeFileSync, request]) m.mockReset();
});

describe('electron HostServices', () => {
  it('pickFile returns the dialog paths', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/a.yaml'] });
    expect(await host.pickFile({})).toEqual({ paths: ['/a.yaml'] });
  });

  it('pickFile returns no paths on cancel', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await host.pickFile({})).toEqual({ paths: [] });
  });

  it('pickNewFile returns the chosen path without seeding a file', async () => {
    const p = path.resolve('new.yaml');
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: p });
    const res = await host.pickNewFile({});
    expect(res).toEqual({ path: p });
    // Seeding is the provider create flow's job, not pickNewFile's.
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('pickNewFile returns a null path on cancel', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
    expect(await host.pickNewFile({})).toEqual({ path: null });
  });

  it('showError shows a native error box', async () => {
    expect(await host.showError({ message: 'boom', detail: 'stack' })).toEqual({ acknowledged: true });
    expect(showErrorBox).toHaveBeenCalledWith('boom', 'stack');
  });

  it('openExternal allows http(s) and blocks other schemes', async () => {
    expect(await host.openExternal({ target: 'https://example.com' })).toEqual({ opened: true });
    expect(openExternal).toHaveBeenCalledWith('https://example.com');
    openExternal.mockReset();
    expect(await host.openExternal({ target: 'file:///etc/passwd' })).toEqual({ opened: false });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('delegates the render-required prompts to the renderer over rpc', async () => {
    request.mockResolvedValue({ value: 'x' });
    await host.showInputBox({ title: 't' });
    expect(request).toHaveBeenCalledWith('inputBox', { title: 't' });

    request.mockResolvedValue({ selected: null });
    await host.showQuickPick({ items: [] });
    expect(request).toHaveBeenCalledWith('quickPick', { items: [] });

    request.mockResolvedValue({ confirmed: true });
    await host.showConfirm({ message: 'ok?' });
    expect(request).toHaveBeenCalledWith('confirm', { message: 'ok?' });
  });
});
