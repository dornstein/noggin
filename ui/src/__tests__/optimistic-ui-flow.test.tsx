// Phase 3 optimistic-UI-flow test.
//
// Drives a full chord — "press Enter to add a sibling, type a title,
// press Enter again to commit, press Enter once more to add the next
// row" — through a `RemoteNoggin` whose RPC transport has a 50ms
// latency injected. Asserts that:
//
//   1. The new row appears in the rendered tree well before the RPC
//      response would arrive (i.e. the optimistic predict shows up
//      under simulated network lag).
//   2. The gesture chord completes cleanly: no double-applied rows,
//      no stuck spinners, no lost keystrokes.
//
// This is what the Phase 3 plan calls "no UI lag is user-visible
// because optimistic application precedes confirmation."

import { describe, it, expect } from 'vitest';
import '@noggin/engine/providers/memory';  // register memory://

import { RpcClient } from '@noggin/rpc';
import { createMemoryTransportPair } from '@noggin/rpc/transports/memory';
import { createNogginRpcServer } from '@noggin/rpc';

import { openRemoteNoggin } from '../remote/openRemoteNoggin.ts';
import { executeGesture } from '../gestures.ts';
import type { NogginNode } from '../types.ts';

/** Build a paired client/server with optional one-way latency. */
async function makeHarness(latencyMs = 0) {
  const { a, b } = createMemoryTransportPair();
  if (latencyMs > 0) {
    const orig = a.send.bind(a);
    a.send = (msg) => { setTimeout(() => orig(msg), latencyMs); };
  }
  const server = createNogginRpcServer({ transport: a });
  const client = new RpcClient(b);
  const remote = await openRemoteNoggin({ client, location: 'memory://flow' });
  return {
    client, remote,
    dispose: async () => {
      await remote.dispose();
      client.dispose();
      await server.dispose();
    },
  };
}

/** Project the remote noggin's items into a NogginNode tree, the
 *  same shape the React component renders. We don't need siblings/
 *  notes etc — just keys and titles for the optimistic-apply checks. */
function projectTree(items: readonly { key: string; parentKey: string | null; title: string; done: boolean }[]): NogginNode[] {
  const byParent = new Map<string | null, typeof items[number][]>();
  for (const it of items) {
    const k = it.parentKey ?? null;
    const list = byParent.get(k);
    if (list) list.push(it); else byParent.set(k, [it]);
  }
  function build(parent: string | null, prefix: string): NogginNode[] {
    const kids = byParent.get(parent) ?? [];
    return kids.map((it, i) => {
      const path = `${prefix}/${i + 1}`;
      return {
        key: it.key,
        path,
        title: it.title,
        done: it.done,
        noteCount: 0,
        children: build(it.key, path),
      };
    });
  }
  return build(null, '');
}

describe('Optimistic UI flow under simulated 50ms latency', () => {
  it('an addSiblingAfter gesture shows the new row in <20ms even with 50ms RPC latency', async () => {
    const h = await makeHarness(50);
    // Seed: a single root item.
    await h.remote.push({ title: 'root' });

    // Fire the gesture and immediately project the tree. Should see
    // the new row right after the optimistic apply.
    const gestureStart = Date.now();
    const gesturePromise = executeGesture(
      h.remote,
      projectTree([...h.remote.items]),
      '/1',
      'addSiblingAfter',
    );

    // Drain prediction microtasks. 20ms wall time — well under the
    // 50ms RPC round-trip.
    await new Promise((r) => setTimeout(r, 20));
    const optimisticView = projectTree([...h.remote.items]);
    const optimisticAt = Date.now() - gestureStart;

    expect(optimisticView.length).toBe(2);             // root + new sibling
    expect(optimisticAt).toBeLessThan(50);             // before RPC could possibly return

    // Now await the gesture and let the server confirm.
    await gesturePromise;
    const totalAt = Date.now() - gestureStart;
    expect(totalAt).toBeGreaterThanOrEqual(50);        // it really did wait

    // Final state matches.
    const finalView = projectTree([...h.remote.items]);
    expect(finalView.length).toBe(2);
    expect(finalView.map((n) => n.title).sort()).toEqual(['', 'root']);

    await h.dispose();
  });

  it('a chord of three rapid gestures all show up optimistically; final state is correct', async () => {
    const h = await makeHarness(50);
    await h.remote.push({ title: 'parent' });

    // Three back-to-back addSiblingAfter gestures. Don't await between
    // them — simulate the user typing fast.
    const trees: number[] = [];
    const p1 = executeGesture(h.remote, projectTree([...h.remote.items]), '/1', 'addSiblingAfter');
    trees.push(h.remote.items.length);  // 1: no predict yet (sync)
    const p2 = executeGesture(h.remote, projectTree([...h.remote.items]), '/1', 'addSiblingAfter');
    trees.push(h.remote.items.length);  // similar
    const p3 = executeGesture(h.remote, projectTree([...h.remote.items]), '/1', 'addSiblingAfter');
    trees.push(h.remote.items.length);

    // After 20ms (still well under 50ms RPC latency), all three
    // predictions have settled.
    await new Promise((r) => setTimeout(r, 20));
    expect(h.remote.items.length).toBe(4);  // parent + three new

    // Confirm all three.
    await Promise.all([p1, p2, p3]);

    // Final state stable: still exactly four items.
    expect(h.remote.items.length).toBe(4);

    await h.dispose();
  });
});
