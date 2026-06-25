// Generic RpcClient + RpcServer round-trips through MemoryTransport.

import { describe, it, expect } from 'vitest';
import { createMemoryTransportPair } from '../src/transports/memory.ts';
import { RpcClient } from '../src/client.ts';
import { RpcServer } from '../src/server.ts';
import { tick } from './helpers.ts';

function pair(): { client: RpcClient; server: RpcServer; dispose(): void } {
  const { a, b } = createMemoryTransportPair();
  const server = new RpcServer(a);
  const client = new RpcClient(b);
  return {
    client, server,
    dispose: () => { client.dispose(); server.dispose(); },
  };
}

describe('RpcClient/RpcServer', () => {
  it('round-trips a single request', async () => {
    const { client, server, dispose } = pair();
    server.on<{ a: number; b: number }, number>('add', ({ a, b }) => a + b);
    const result = await client.request<number>('add', { a: 2, b: 3 });
    expect(result).toBe(5);
    dispose();
  });

  it('correlates multiple concurrent pending requests by id', async () => {
    const { client, server, dispose } = pair();
    server.on<{ ms: number; value: string }, string>('delayed', async ({ ms, value }) => {
      await new Promise((r) => setTimeout(r, ms));
      return value;
    });
    // Fire three requests with deliberately reversed completion order.
    const p1 = client.request('delayed', { ms: 30, value: 'a' });
    const p2 = client.request('delayed', { ms: 10, value: 'b' });
    const p3 = client.request('delayed', { ms: 20, value: 'c' });
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect([r1, r2, r3]).toEqual(['a', 'b', 'c']);
    dispose();
  });

  it('returns rpc.method-not-found for unregistered methods', async () => {
    const { client, dispose } = pair();
    await expect(client.request('nope')).rejects.toMatchObject({
      name: 'NogginRpcError',
      code: 'rpc.method-not-found',
    });
    dispose();
  });

  it('handler throw round-trips as NogginRpcError with the engine-style code', async () => {
    const { client, server, dispose } = pair();
    server.on('boom', () => {
      // Engine-shaped error: code + message + exitCode.
      const e = new Error('path not found: /9') as Error & { code: string; exitCode: number };
      e.code = 'path-not-found';
      e.exitCode = 1;
      throw e;
    });
    await expect(client.request('boom')).rejects.toMatchObject({
      name: 'NogginRpcError',
      code: 'path-not-found',
      message: 'path not found: /9',
      data: { exitCode: 1 },
    });
    dispose();
  });

  it('passes server notifications to client.onNotification listeners', async () => {
    const { client, server, dispose } = pair();
    const events: Array<{ method: string; params: unknown }> = [];
    client.onNotification((method, params) => events.push({ method, params }));
    server.notify('hello', { who: 'world' });
    // The notification has to round-trip the memory transport's
    // microtask + the client's emitter — a microtask drain suffices.
    await tick();
    expect(events).toEqual([{ method: 'hello', params: { who: 'world' } }]);
    dispose();
  });

  it('rejects new requests after dispose with rpc.disposed', async () => {
    const { client, dispose } = pair();
    client.dispose();
    await expect(client.request('anything')).rejects.toMatchObject({
      code: 'rpc.disposed',
    });
    dispose();
  });

  it('refuses double-registration of the same method', () => {
    const { server, dispose } = pair();
    server.on('a', () => 1);
    expect(() => server.on('a', () => 2)).toThrow(/already registered/);
    dispose();
  });
});
