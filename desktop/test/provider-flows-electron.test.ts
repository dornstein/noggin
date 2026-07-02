// Electron provider-flow tests (tier 1 · logic).
//
// pickToOpen / create must return a *canonical location* the engine's
// `noggin.open` can resolve — i.e. a `file://` URL with a scheme, not a
// bare OS path. (Returning a raw path was a latent contract bug.)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { showOpenDialog, showSaveDialog } = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
}));
const { existsSync, writeFileSync } = vi.hoisted(() => ({
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('electron', () => ({ dialog: { showOpenDialog, showSaveDialog } }));
vi.mock('node:fs', () => ({ existsSync, writeFileSync }));

import { createElectronProviderFlows } from '../src/main/provider-flows-electron';

// The impl only uses `window` as the dialog anchor; a stub is fine.
const flows = createElectronProviderFlows({} as never);
const OPEN_PATH = path.resolve('open-me.yaml');
const NEW_PATH = path.resolve('brand-new.yaml');

beforeEach(() => {
  showOpenDialog.mockReset();
  showSaveDialog.mockReset();
  existsSync.mockReset();
  writeFileSync.mockReset();
});

describe('electron provider flows', () => {
  it('pickToOpen returns a file:// URL, not a raw path', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [OPEN_PATH] });
    const loc = await flows.pickToOpen!('file://');
    expect(loc).toBe(pathToFileURL(OPEN_PATH).href);
    expect(loc!.startsWith('file://')).toBe(true);
    expect(loc).not.toBe(OPEN_PATH); // the bug: used to return the bare path
  });

  it('pickToOpen returns null when cancelled', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await flows.pickToOpen!('file://')).toBeNull();
  });

  it('create seeds an empty noggin and returns a file:// URL', async () => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: NEW_PATH });
    existsSync.mockReturnValue(false);
    const loc = await flows.create!('file://');
    expect(writeFileSync).toHaveBeenCalledWith(NEW_PATH, expect.stringContaining('schemaVersion'), 'utf8');
    expect(loc).toBe(pathToFileURL(NEW_PATH).href);
  });

  it('create does not overwrite an existing file', async () => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: NEW_PATH });
    existsSync.mockReturnValue(true);
    await flows.create!('file://');
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('ignores non-file schemes', async () => {
    expect(await flows.pickToOpen!('memory://')).toBeNull();
    expect(await flows.create!('memory://')).toBeNull();
  });
});
