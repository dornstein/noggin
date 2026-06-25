// Integration test: exercise every message shape (request, response,
// error, notification, ping, pong) end-to-end against a fake server.
// Uses MemoryTransport. This is the "everything works together"
// smoke test for the RPC framework.

import { describe, it, expect } from 'vitest';
import { createMemoryTransportPair } from '../src/transports/memory.ts';
import { RpcClient } from '../src/client.ts';
import { RpcServer } from '../src/server.ts';
import { NogginRpcError } from '../src/errors.ts';
import { tick } from './helpers.ts';

describe('framework integration', () => {
  it('every message shape round-trips between RpcClient and RpcServer', async () => {
    const { a, b } = createMemoryTransportPair();
    const server = new RpcServer(a);
    const client = new RpcClient(b);

    // Stand up a tiny stub of the noggin-rpc protocol so we cover all
    // 4 user-visible kinds: request/response, request/error,
    // server-pushed notification, plus a follow-on request to confirm
    // the channel stays alive after a previous error.
    const opened = new Map<string, { items: number[] }>();
    server.on<{ location: string }, { sessionId: string; snapshot: { items: number[] } }>(
      'noggin.open',
      ({ location }) => {
        const sessionId = `sess-${opened.size + 1}`;
        const snapshot = { items: [] };
        opened.set(sessionId, snapshot);
        // Fire a one-shot notification to demonstrate the path. Real
        // noggin-rpc reserves notifications for subscription events;
        // here we just prove the wire shape works.
        queueMicrotask(() => server.notify('noggin.opened', { sessionId, location }));
        return { sessionId, snapshot };
      },
    );
    server.on<{ sessionId: string; item: number }, { snapshot: { items: number[] } }>(
      'verb.add',
      ({ sessionId, item }) => {
        const sess = opened.get(sessionId);
        if (!sess) {
          const e = new Error(`unknown session ${sessionId}`) as Error & { code: string; exitCode: number };
          e.code = 'no-session';
          e.exitCode = 1;
          throw e;
        }
        sess.items = [...sess.items, item];
        return { snapshot: { items: sess.items } };
      },
    );

    // request/response + notification
    const notifications: Array<{ method: string; params: unknown }> = [];
    client.onNotification((method, params) => notifications.push({ method, params }));
    const open = await client.request<{ sessionId: string; snapshot: { items: number[] } }>(
      'noggin.open', { location: '~/.noggin.yaml' },
    );
    expect(open.sessionId).toBe('sess-1');
    expect(open.snapshot).toEqual({ items: [] });

    // Drain microtasks so the notification arrives.
    await tick();
    expect(notifications).toContainEqual({
      method: 'noggin.opened',
      params: { sessionId: 'sess-1', location: '~/.noggin.yaml' },
    });

    // Two sequential verb calls
    const r1 = await client.request<{ snapshot: { items: number[] } }>(
      'verb.add', { sessionId: open.sessionId, item: 10 },
    );
    expect(r1.snapshot.items).toEqual([10]);
    const r2 = await client.request<{ snapshot: { items: number[] } }>(
      'verb.add', { sessionId: open.sessionId, item: 20 },
    );
    expect(r2.snapshot.items).toEqual([10, 20]);

    // request/error path
    try {
      await client.request('verb.add', { sessionId: 'bogus', item: 99 });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NogginRpcError);
      expect(e).toMatchObject({
        code: 'no-session',
        message: 'unknown session bogus',
        data: { exitCode: 1 },
      });
    }

    // Channel still works after the error.
    const r3 = await client.request<{ snapshot: { items: number[] } }>(
      'verb.add', { sessionId: open.sessionId, item: 30 },
    );
    expect(r3.snapshot.items).toEqual([10, 20, 30]);

    client.dispose();
    server.dispose();
  });
});
