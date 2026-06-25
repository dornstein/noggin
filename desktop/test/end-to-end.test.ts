// End-to-end Phase 4 test.
//
// Stands up the same noggin-rpc stack the desktop ships, minus
// Electron itself: a `createNogginRpcServer` on one end (with the
// real engine providers + a stub HostServices) and a `RemoteNoggin`
// on the other end. The two halves are bridged via a memory
// transport pair — the same shape `ElectronIpcTransport` would have
// in production.
//
// Verifies the contract Phase 4 promises:
//   - The renderer drives verbs through the rpc server into the
//     engine, snapshots propagate back, and the optimistic predict
//     happens locally.
//   - host.* RPC methods round-trip through the HostServices stub.
//
// Doesn't test Electron-specific code paths (Electron's IPC
// transport, the application menu wiring, the file dialog). Those
// live in their own modules and are tested manually with the dev
// build.

import { describe, it, expect } from 'vitest';

import '@noggin/engine/providers/memory';
import {
  createNogginRpcServer,
  RpcClient,
  type HostPickFileResponse,
  type HostServices,
} from '@noggin/rpc';
import { createMemoryTransportPair } from '@noggin/rpc/transports/memory';

import { openRemoteNoggin } from '../../ui/src/remote/openRemoteNoggin';

interface Harness {
  client: RpcClient;
  hostCalls: { method: string; opts: unknown }[];
  dispose(): Promise<void>;
}

function makeHarness(): Harness {
  const hostCalls: { method: string; opts: unknown }[] = [];
  const hostServices: HostServices = {
    pickFile: async (opts) => {
      hostCalls.push({ method: 'pickFile', opts });
      const r: HostPickFileResponse = { paths: ['/stub/picked.yaml'] };
      return r;
    },
    pickNewFile: async (opts) => {
      hostCalls.push({ method: 'pickNewFile', opts });
      return { path: '/stub/new.yaml' };
    },
    showInputBox: async (opts) => {
      hostCalls.push({ method: 'showInputBox', opts });
      return { value: 'stub-input' };
    },
    showQuickPick: async (opts) => {
      hostCalls.push({ method: 'showQuickPick', opts });
      return { selected: null };
    },
    showConfirm: async (opts) => {
      hostCalls.push({ method: 'showConfirm', opts });
      return { confirmed: true };
    },
    showError: async (opts) => {
      hostCalls.push({ method: 'showError', opts });
      return { acknowledged: true as const };
    },
    openExternal: async (opts) => {
      hostCalls.push({ method: 'openExternal', opts });
      return { opened: true };
    },
  };

  const { a, b } = createMemoryTransportPair();
  const server = createNogginRpcServer({ transport: a, hostServices });
  const client = new RpcClient(b);

  return {
    client,
    hostCalls,
    async dispose() {
      client.dispose();
      await server.dispose();
    },
  };
}

describe('Phase 4 end-to-end', () => {
  it('opens a noggin and seeds the snapshot', async () => {
    const h = makeHarness();
    const remote = await openRemoteNoggin({ client: h.client, location: 'memory://e2e' });
    expect(remote.items.length).toBe(0);
    expect(remote.active).toBeNull();
    await remote.dispose();
    await h.dispose();
  });

  it('drives a verb chain through the server', async () => {
    const h = makeHarness();
    const remote = await openRemoteNoggin({ client: h.client, location: 'memory://e2e' });
    await remote.push({ title: 'one' });
    await remote.push({ title: 'one-child' });   // child of "one"
    await remote.add({ title: 'two' });          // sibling at the active level
    expect(remote.items.map((i) => i.title).sort()).toEqual(['one', 'one-child', 'two']);
    await remote.dispose();
    await h.dispose();
  });

  it('routes host.* RPC requests through HostServices', async () => {
    const h = makeHarness();
    const result = await h.client.request<HostPickFileResponse>('host.pickFile', { title: 'pick' });
    expect(result.paths).toEqual(['/stub/picked.yaml']);
    expect(h.hostCalls).toEqual([
      { method: 'pickFile', opts: { title: 'pick' } },
    ]);
    await h.dispose();
  });

  it('survives a disposed Remote — server resources tear down cleanly', async () => {
    const h = makeHarness();
    const remote = await openRemoteNoggin({ client: h.client, location: 'memory://e2e' });
    await remote.push({ title: 'before-dispose' });
    await remote.dispose();

    // Re-open against the same server — fresh session.
    const remote2 = await openRemoteNoggin({ client: h.client, location: 'memory://e2e' });
    // memory:// noggins are per-session in-memory, so the second open
    // sees an empty document.
    expect(remote2.items.length).toBe(0);
    await remote2.dispose();
    await h.dispose();
  });
});
