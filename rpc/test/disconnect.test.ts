// Transport-disconnect behaviour: pending requests reject, onDisconnect
// fires, subsequent requests reject with rpc.disposed.

import { describe, it, expect } from 'vitest';
import { createMemoryTransportPair } from '../src/transports/memory.ts';
import { RpcClient } from '../src/client.ts';
import { RpcServer } from '../src/server.ts';
import { tick } from './helpers.ts';

describe('disconnect handling', () => {
  it('pending requests reject with rpc.disconnected when transport closes', async () => {
    const { a, b } = createMemoryTransportPair();
    const server = new RpcServer(a);
    const client = new RpcClient(b);

    server.on('slow', () => new Promise(() => {}));
    const p1 = client.request('slow');
    const p2 = client.request('slow');

    // Drop the transport from the server side; the client side should
    // see disconnect via the MemoryTransport cascade.
    a.close();

    await expect(p1).rejects.toMatchObject({ code: 'rpc.disconnected' });
    await expect(p2).rejects.toMatchObject({ code: 'rpc.disconnected' });

    client.dispose();
    server.dispose();
  });

  it('client.connected flips to false after disconnect', async () => {
    const { a, b } = createMemoryTransportPair();
    const server = new RpcServer(a);
    const client = new RpcClient(b);
    expect(client.connected).toBe(true);
    b.close();
    // The transport's cascade is microtask-deferred.
    await tick();
    await tick();
    expect(client.connected).toBe(false);
    client.dispose();
    server.dispose();
  });

  it('onDisconnect fires exactly once per disposal', async () => {
    const { a, b } = createMemoryTransportPair();
    const server = new RpcServer(a);
    const client = new RpcClient(b);
    let calls = 0;
    client.onDisconnect(() => { calls++; });
    client.dispose();
    // Disposing twice is idempotent; no extra fires.
    client.dispose();
    expect(calls).toBe(1);
    server.dispose();
  });
});
