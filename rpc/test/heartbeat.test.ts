// Heartbeat behaviour. Uses vitest fake timers so we can fast-forward
// past ping intervals and pong timeouts without real wait time.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMemoryTransportPair } from '../src/transports/memory.ts';
import { RpcClient } from '../src/client.ts';
import { RpcServer } from '../src/server.ts';

describe('heartbeat', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('idle client sends pings on its interval', async () => {
    const { a, b } = createMemoryTransportPair();
    const server = new RpcServer(a);
    const client = new RpcClient(b, { heartbeat: { intervalMs: 100, timeoutMs: 500 } });

    // Capture pings observed on the server transport so we can count
    // beats. The server itself handles ping in handleIncoming and
    // doesn't expose them; sniff via a peer onMessage listener.
    const pingsSeen: number[] = [];
    a.onMessage((m) => { if (m.type === 'ping') pingsSeen.push(Date.now()); });

    // Tick past two intervals.
    await vi.advanceTimersByTimeAsync(250);

    expect(pingsSeen.length).toBeGreaterThanOrEqual(1);

    client.dispose();
    server.dispose();
  });

  it('marks disconnected when a ping goes unanswered for timeoutMs', async () => {
    const { a, b } = createMemoryTransportPair();
    // A drop-everything server (no actual RpcServer attached): consume
    // messages but never respond.
    a.onMessage(() => {});
    const client = new RpcClient(b, { heartbeat: { intervalMs: 50, timeoutMs: 200 } });
    let disconnected = false;
    client.onDisconnect(() => { disconnected = true; });

    // Drive past the first ping + the pong timeout.
    await vi.advanceTimersByTimeAsync(300);

    expect(disconnected).toBe(true);
    expect(client.connected).toBe(false);
    client.dispose();
  });

  it('does not disconnect when pongs are answered (server handles ping reflexively)', async () => {
    const { a, b } = createMemoryTransportPair();
    const server = new RpcServer(a); // answers pings via RpcServer.handleIncoming
    const client = new RpcClient(b, { heartbeat: { intervalMs: 50, timeoutMs: 500 } });
    let disconnected = false;
    client.onDisconnect(() => { disconnected = true; });

    // Tick past several intervals.
    await vi.advanceTimersByTimeAsync(600);

    expect(disconnected).toBe(false);
    expect(client.connected).toBe(true);
    client.dispose();
    server.dispose();
  });

  it('heartbeats are disabled when intervalMs is 0 (default)', async () => {
    const { a, b } = createMemoryTransportPair();
    const server = new RpcServer(a);
    const client = new RpcClient(b); // no heartbeat opts
    const pingsSeen: number[] = [];
    a.onMessage((m) => { if (m.type === 'ping') pingsSeen.push(Date.now()); });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pingsSeen).toEqual([]);
    expect(client.connected).toBe(true);
    client.dispose();
    server.dispose();
  });
});
