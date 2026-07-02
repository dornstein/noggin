// Renderer host-services helper tests (tier 1 · logic).
//
// The helper turns the sidebar `+` menu's "open / new file" pickers
// into `host.*` RPC calls. We mock the rpc client and assert the method
// names, params, response mapping, and the return-null-on-failure guard.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../src/renderer/src/rpc-client', () => ({
  getRpcClient: () => ({ request }),
}));

import { pickFile, pickNewFile } from '../src/renderer/src/host-services';

beforeEach(() => request.mockReset());

describe('renderer host-services', () => {
  it('pickFile calls host.pickFile and returns the first path', async () => {
    request.mockResolvedValue({ paths: ['/a.yaml', '/b.yaml'] });
    const p = await pickFile();
    expect(request).toHaveBeenCalledWith('host.pickFile', expect.objectContaining({ title: 'Open noggin' }));
    expect(p).toBe('/a.yaml');
  });

  it('pickFile returns null when the user cancels (no paths)', async () => {
    request.mockResolvedValue({ paths: [] });
    expect(await pickFile()).toBeNull();
  });

  it('pickNewFile calls host.pickNewFile and returns the chosen path', async () => {
    request.mockResolvedValue({ path: '/new.yaml' });
    const p = await pickNewFile();
    expect(request).toHaveBeenCalledWith('host.pickNewFile', expect.objectContaining({ defaultPath: '.noggin.yaml' }));
    expect(p).toBe('/new.yaml');
  });

  it('never throws — returns null when the call fails or the response is malformed', async () => {
    // In prod the failure is getRpcClient()/request throwing when the
    // bridge is absent; here a malformed response drives the same guard.
    request.mockReturnValue(undefined);
    expect(await pickFile()).toBeNull();
    expect(await pickNewFile()).toBeNull();
  });
});
