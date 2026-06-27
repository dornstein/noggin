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

  it('noggin.open defaults watch:true so external file writes reach the client', async () => {
    // Two desktop app instances on the same .noggin.yaml is the
    // motivating case: each main process opens via noggin.open, and
    // a write through one must show up in the other via fs.watch +
    // noggin.changed. Setting `watch: true` by default in the
    // server-adapter is what makes that work.
    await import('@noggin/engine/providers/file');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { toYaml } = await import('@noggin/engine/serializers/yaml');

    const dir = mkdtempSync(path.join(tmpdir(), 'noggin-rpc-watch-'));
    const file = path.join(dir, '.noggin.yaml');
    try {
      const { client, dispose } = pair({});
      try {
        const { sessionId } = await client.request<{ sessionId: string }>(
          'noggin.open', { location: `file://${file}` },
        );
        await client.request<{ subscriptionId: string }>(
          'noggin.subscribe', { sessionId },
        );

        const received: string[] = [];
        client.onNotification((method) => { if (method === 'noggin.changed') received.push(method); });

        // External writer simulates "the other app instance just
        // mutated the file" — bypass the server entirely.
        writeFileSync(file, toYaml({
          schemaVersion: 1,
          active: null,
          items: [{
            key: 'i-20260101-000000-abcdef',
            parentKey: null,
            title: 'from outside',
            done: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            notes: [],
          }],
        }), 'utf8');

        // fs.watch coalesces with a 50ms debounce; give it room.
        const deadline = Date.now() + 1500;
        while (received.length === 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 25));
        }
        expect(received.length).toBeGreaterThan(0);

        // Snapshot should reflect the external write.
        const { snapshot } = await client.request<{ snapshot: { items: Array<{ title: string }> } }>(
          'noggin.snapshot', { sessionId },
        );
        expect(snapshot.items.map((i) => i.title)).toEqual(['from outside']);
      } finally { await dispose(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('two RPC servers on one file: a verb through one is observed by the other', async () => {
    // The "two desktop windows / desktop + VS Code extension on the
    // same .noggin.yaml" case. Each main process stands up its own
    // RPC server backed by its own engine; they sync via fs.watch +
    // noggin.changed. Regression for the bug where the desktop app
    // and the VS Code extension didn't observe each other's writes
    // because neither side opened with watch:true.
    await import('@noggin/engine/providers/file');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');

    const dir = mkdtempSync(path.join(tmpdir(), 'noggin-rpc-twohosts-'));
    const file = path.join(dir, '.noggin.yaml');
    try {
      // Two completely independent client/server pairs — different
      // transports, different sessions, same file on disk.
      const h1 = pair({});
      const h2 = pair({});
      try {
        const { sessionId: s1 } = await h1.client.request<{ sessionId: string }>(
          'noggin.open', { location: `file://${file}` },
        );
        const { sessionId: s2 } = await h2.client.request<{ sessionId: string }>(
          'noggin.open', { location: `file://${file}` },
        );
        await h1.client.request('noggin.subscribe', { sessionId: s1 });
        await h2.client.request('noggin.subscribe', { sessionId: s2 });

        const events2: unknown[] = [];
        h2.client.onNotification((method, params) => {
          if (method === 'noggin.changed') events2.push(params);
        });

        // Mutation through host 1.
        await h1.client.request('verb.push', { sessionId: s1, opts: { title: 'from-host-1' } });

        // Host 2 should observe via fs.watch and emit noggin.changed.
        const deadline = Date.now() + 2000;
        while (events2.length === 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 25));
        }
        expect(events2.length).toBeGreaterThan(0);

        // Host 2's snapshot reflects host 1's write.
        const { snapshot } = await h2.client.request<{ snapshot: { items: Array<{ title: string }> } }>(
          'noggin.snapshot', { sessionId: s2 },
        );
        expect(snapshot.items.map((i) => i.title)).toEqual(['from-host-1']);

        // Round-trip: mutate via host 2, host 1 sees it too.
        const events1: unknown[] = [];
        h1.client.onNotification((method, params) => {
          if (method === 'noggin.changed') events1.push(params);
        });
        await h2.client.request('verb.add', { sessionId: s2, opts: { title: 'from-host-2' } });

        const deadline2 = Date.now() + 2000;
        while (events1.length === 0 && Date.now() < deadline2) {
          await new Promise((r) => setTimeout(r, 25));
        }
        expect(events1.length).toBeGreaterThan(0);

        const { snapshot: snap1 } = await h1.client.request<{ snapshot: { items: Array<{ title: string }> } }>(
          'noggin.snapshot', { sessionId: s1 },
        );
        expect(snap1.items.map((i) => i.title).sort()).toEqual(['from-host-1', 'from-host-2']);
      } finally {
        await h1.dispose();
        await h2.dispose();
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('resubscribe on a session yields a fresh subscriptionId; old id receives no further events', async () => {
    // Architect's concern: when a client unsubscribes mid-flight and
    // immediately resubscribes, do notifications from the unsubscribed
    // period leak into the new subscription? Pin: each subscribe call
    // gets a unique id, and events for an id stop the moment its
    // unsubscribe response resolves.
    const { client, dispose } = pair({});
    try {
      const { sessionId } = await client.request<{ sessionId: string }>(
        'noggin.open', { location: 'memory://resubscribe' },
      );
      const { subscriptionId: subA } = await client.request<{ subscriptionId: string }>(
        'noggin.subscribe', { sessionId },
      );

      const received: Array<{ subscriptionId: string }> = [];
      client.onNotification((method, params) => {
        if (method === 'noggin.changed') received.push(params as { subscriptionId: string });
      });

      // Burn some mutations under subscription A.
      await client.request('verb.push', { sessionId, opts: { title: 'a-1' } });
      await client.request('verb.add', { sessionId, opts: { title: 'a-2' } });
      await tick();
      const seenUnderA = received.filter((p) => p.subscriptionId === subA).length;
      expect(seenUnderA).toBeGreaterThanOrEqual(2);

      // Unsubscribe, then resubscribe to the SAME session.
      await client.request('noggin.unsubscribe', { subscriptionId: subA });
      const { subscriptionId: subB } = await client.request<{ subscriptionId: string }>(
        'noggin.subscribe', { sessionId },
      );
      expect(subB).not.toBe(subA);

      const beforeBMutations = received.length;
      await client.request('verb.add', { sessionId, opts: { title: 'b-1' } });
      await tick();

      // No further notifications under subA after its unsubscribe.
      const seenUnderAAfter = received
        .slice(beforeBMutations)
        .filter((p) => p.subscriptionId === subA).length;
      expect(seenUnderAAfter).toBe(0);

      // The new event is under subB.
      const seenUnderBNew = received
        .slice(beforeBMutations)
        .filter((p) => p.subscriptionId === subB).length;
      expect(seenUnderBNew).toBeGreaterThanOrEqual(1);
    } finally { await dispose(); }
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
