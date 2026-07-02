// Renderer provider-flow helper tests (tier 1 · logic).
//
// The sidebar `+` menu drives file open/create through the host's
// provider flows (`provider.open` / `provider.create`) rather than
// picking + converting in the renderer. We mock the rpc client and
// assert the method names, params, response mapping, and the
// return-null-on-failure guard.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../src/renderer/src/rpc-client', () => ({
  getRpcClient: () => ({ request }),
}));

import { open, create } from '../src/renderer/src/provider-flows';

beforeEach(() => request.mockReset());

describe('renderer provider flows', () => {
  it('open() calls provider.open and returns the location', async () => {
    request.mockResolvedValue({ location: 'file:///x.yaml' });
    const loc = await open('file://');
    expect(request).toHaveBeenCalledWith('provider.open', { scheme: 'file://' });
    expect(loc).toBe('file:///x.yaml');
  });

  it('open() returns null when the user cancels', async () => {
    request.mockResolvedValue({ location: null });
    expect(await open('file://')).toBeNull();
  });

  it('create() calls provider.create and returns the location', async () => {
    request.mockResolvedValue({ location: 'file:///new.yaml' });
    const loc = await create('file://');
    expect(request).toHaveBeenCalledWith('provider.create', { scheme: 'file://' });
    expect(loc).toBe('file:///new.yaml');
  });

  it('never throws — returns null when the call fails or the response is malformed', async () => {
    request.mockReturnValue(undefined);
    expect(await open('file://')).toBeNull();
    expect(await create('file://')).toBeNull();
  });
});
