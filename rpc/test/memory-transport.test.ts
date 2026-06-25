// MemoryTransport: the in-process Transport pair used by the rest of
// the test suite. Sanity-check the transport itself before stacking
// RpcClient/RpcServer on top.

import { describe, it, expect } from 'vitest';
import { createMemoryTransportPair } from '../src/transports/memory.ts';
import type { RpcMessage } from '../src/envelope.ts';
import { tick } from './helpers.ts';

describe('MemoryTransport', () => {
  it('delivers a message from a to b', async () => {
    const { a, b } = createMemoryTransportPair();
    const received: RpcMessage[] = [];
    b.onMessage((m) => received.push(m));
    a.send({ type: 'notification', method: 'ping', params: 1 });
    await tick();
    expect(received).toEqual([{ type: 'notification', method: 'ping', params: 1 }]);
  });

  it('delivery is async (handler fires after the send call returns)', async () => {
    const { a, b } = createMemoryTransportPair();
    let firedInSync = false;
    b.onMessage(() => { firedInSync = true; });
    a.send({ type: 'notification', method: 'x' });
    // Right after send returns, the handler shouldn't have fired yet.
    expect(firedInSync).toBe(false);
    await tick();
    expect(firedInSync).toBe(true);
  });

  it('preserves message order from the same sender', async () => {
    const { a, b } = createMemoryTransportPair();
    const received: number[] = [];
    b.onMessage((m) => received.push((m as { params: number }).params));
    a.send({ type: 'notification', method: 'x', params: 1 });
    a.send({ type: 'notification', method: 'x', params: 2 });
    a.send({ type: 'notification', method: 'x', params: 3 });
    await tick();
    expect(received).toEqual([1, 2, 3]);
  });

  it('closing one side fires onDisconnect on the other', async () => {
    const { a, b } = createMemoryTransportPair();
    let aDisconnected = false;
    let bDisconnected = false;
    a.onDisconnect(() => { aDisconnected = true; });
    b.onDisconnect(() => { bDisconnected = true; });
    a.close();
    await tick();
    await tick();
    expect(aDisconnected).toBe(true);
    expect(bDisconnected).toBe(true);
  });

  it('send after close throws', () => {
    const { a } = createMemoryTransportPair();
    a.close();
    expect(() => a.send({ type: 'notification', method: 'x' })).toThrow(/close/);
  });
});
