// Phase 2 integration tests: drive the createNogginRpcServer adapter
// end-to-end against a real @noggin/engine memory noggin and a
// scripted HostServices.
//
// Coverage:
//   - noggin.open returns a session + snapshot
//   - verb.push / verb.add mutate the noggin and resolve with a view
//   - noggin.subscribe streams ChangeEvents back as noggin.changed
//     notifications BEFORE the causing verb response resolves
//   - verb errors (engine codes) survive the RPC round trip
//   - host.* calls reach the injected HostServices and return its
//     scripted answer
//   - provider.list returns the registered providers
//   - provider.create / .open reject with 'not-implemented' if no
//     providerFlows were supplied

import { describe, it, expect } from 'vitest';
import '@noggin/engine/providers/memory';  // side-effect: register memory://

import { createMemoryTransportPair } from '../src/transports/memory.ts';
import { RpcClient } from '../src/client.ts';
import { createNogginRpcServer } from '../src/server-adapter.ts';
import { createTestHostServices } from './host-services-test.ts';
import { tick } from './helpers.ts';

function pair(opts: Parameters<typeof createNogginRpcServer>[0] extends infer T ? Omit<T extends { transport: infer _ } ? T : never, 'transport'> : never) {
  const { a, b } = createMemoryTransportPair();
  const server = createNogginRpcServer({ transport: a, ...opts });
  const client = new RpcClient(b);
  return {
    client, server,
    dispose: async () => { client.dispose(); await server.dispose(); },
  };
}

describe('createNogginRpcServer — noggin.* + verb.*', () => {
  it('opens a memory noggin and returns a session + snapshot', async () => {
    const { client, dispose } = pair({});
    const r = await client.request<{ sessionId: string; snapshot: { items: unknown[]; active: string | null } }>(
      'noggin.open', { location: 'memory://demo' },
    );
    expect(r.sessionId).toMatch(/^sess-/);
    expect(r.snapshot.items).toEqual([]);
    expect(r.snapshot.active).toBeNull();
    await dispose();
  });

  it('verb.push mutates the noggin and resolves with a CurrentTreeView', async () => {
    const { client, dispose } = pair({});
    const { sessionId } = await client.request<{ sessionId: string }>('noggin.open', { location: 'memory://demo' });
    const view = await client.request<{ items: unknown[]; targetKey: string }>(
      'verb.push', { sessionId, opts: { title: 'hello world' } },
    );
    expect(view.items.length).toBeGreaterThan(0);
    expect(view.targetKey).toMatch(/^i-/);

    const { snapshot } = await client.request<{ snapshot: { items: Array<{ title: string }> } }>(
      'noggin.snapshot', { sessionId },
    );
    expect(snapshot.items.map((i) => i.title)).toEqual(['hello world']);
    await dispose();
  });

  it('subscribed clients receive noggin.changed BEFORE the verb response resolves', async () => {
    const { client, dispose } = pair({});
    const { sessionId } = await client.request<{ sessionId: string }>('noggin.open', { location: 'memory://demo' });
    const { subscriptionId } = await client.request<{ subscriptionId: string }>(
      'noggin.subscribe', { sessionId },
    );

    const events: string[] = [];
    client.onNotification((method) => events.push(`notify:${method}`));

    // We need to interleave the change-event arrival with the verb's
    // response resolution. Hold the verb promise, then assert that
    // by the time we await it the notification has already arrived.
    const verbPromise = client.request('verb.add', { sessionId, opts: { title: 'subscribed' } })
      .then(() => events.push('verb:resolved'));

    await verbPromise;
    // The first thing in `events` must be the notification, not the
    // verb resolution.
    expect(events[0]).toBe('notify:noggin.changed');
    expect(events).toContain('verb:resolved');
    expect(subscriptionId).toMatch(/^sub-/);
    await dispose();
  });

  it('verb errors round-trip with stable engine codes', async () => {
    const { client, dispose } = pair({});
    const { sessionId } = await client.request<{ sessionId: string }>('noggin.open', { location: 'memory://demo' });
    // goto a path that doesn't exist -> engine throws 'path-not-found'
    await expect(client.request('verb.goto', { sessionId, opts: { path: '/9' } })).rejects.toMatchObject({
      name: 'NogginRpcError',
      code: 'path-not-found',
    });
    await dispose();
  });

  it('noggin.close releases the session', async () => {
    const { client, dispose } = pair({});
    const { sessionId } = await client.request<{ sessionId: string }>('noggin.open', { location: 'memory://demo' });
    await client.request('noggin.close', { sessionId });
    // Subsequent calls against the closed session must fail.
    await expect(client.request('noggin.snapshot', { sessionId })).rejects.toMatchObject({
      code: 'no-session',
    });
    await dispose();
  });

  it('noggin.unsubscribe stops the change stream', async () => {
    const { client, dispose } = pair({});
    const { sessionId } = await client.request<{ sessionId: string }>('noggin.open', { location: 'memory://demo' });
    const { subscriptionId } = await client.request<{ subscriptionId: string }>(
      'noggin.subscribe', { sessionId },
    );

    const received: unknown[] = [];
    client.onNotification((method, params) => {
      if (method === 'noggin.changed') received.push(params);
    });

    await client.request('verb.push', { sessionId, opts: { title: 'a' } });
    await tick();
    const countBefore = received.length;
    expect(countBefore).toBeGreaterThan(0);

    await client.request('noggin.unsubscribe', { subscriptionId });
    await client.request('verb.push', { sessionId, opts: { title: 'b' } });
    await tick();
    expect(received.length).toBe(countBefore);
    await dispose();
  });
});

describe('createNogginRpcServer — host.*', () => {
  it('host.showInputBox routes to the injected HostServices and returns its scripted answer', async () => {
    const host = createTestHostServices({ showInputBox: { value: 'typed by user' } });
    const { client, dispose } = pair({ hostServices: host });
    const r = await client.request<{ value: string | null }>('host.showInputBox', { prompt: 'go?' });
    expect(r.value).toBe('typed by user');
    expect(host.calls).toEqual([{ method: 'showInputBox', request: { prompt: 'go?' } }]);
    await dispose();
  });

  it('host.pickFile relays paths from the host', async () => {
    const host = createTestHostServices({ pickFile: { paths: ['/picked.yaml'] } });
    const { client, dispose } = pair({ hostServices: host });
    const r = await client.request<{ paths: string[] }>('host.pickFile', { title: 'Open noggin' });
    expect(r.paths).toEqual(['/picked.yaml']);
    await dispose();
  });

  it('rejects host.* when no HostServices was supplied', async () => {
    const { client, dispose } = pair({});
    await expect(client.request('host.showInputBox', {})).rejects.toMatchObject({
      code: 'not-implemented',
    });
    await dispose();
  });
});

describe('createNogginRpcServer — provider.*', () => {
  it('provider.list returns at least the memory provider', async () => {
    const { client, dispose } = pair({});
    const r = await client.request<{ providers: Array<{ scheme: string }> }>('provider.list', {});
    const schemes = r.providers.map((p) => p.scheme);
    expect(schemes).toContain('memory');
    await dispose();
  });

  it('provider.describe returns scheme + default flag + optional display info', async () => {
    const { client, dispose } = pair({
      providerFlows: {
        describe: async (scheme) => ({ displayName: `Display: ${scheme}`, description: 'd' }),
      },
    });
    const r = await client.request<{ scheme: string; displayName?: string }>('provider.describe', { scheme: 'memory' });
    expect(r.scheme).toBe('memory');
    expect(r.displayName).toBe('Display: memory');
    await dispose();
  });

  it('provider.describe on an unknown scheme errors with no-provider', async () => {
    const { client, dispose } = pair({});
    await expect(client.request('provider.describe', { scheme: 'nope' })).rejects.toMatchObject({
      code: 'no-provider',
    });
    await dispose();
  });

  it('provider.create routes to the injected flow and returns its location', async () => {
    const { client, dispose } = pair({
      providerFlows: {
        create: async (scheme) => `${scheme}://newly-created`,
      },
    });
    const r = await client.request<{ location: string | null }>('provider.create', { scheme: 'memory' });
    expect(r.location).toBe('memory://newly-created');
    await dispose();
  });

  it('rejects provider.create when no flow was supplied', async () => {
    const { client, dispose } = pair({});
    await expect(client.request('provider.create', { scheme: 'memory' })).rejects.toMatchObject({
      code: 'not-implemented',
    });
    await dispose();
  });
});
