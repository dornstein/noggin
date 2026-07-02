// Noggin conformance suite (tier 1 · conformance).
//
// The `Noggin` interface has two implementations that MUST behave
// identically: the in-process engine noggin, and `RemoteNoggin` — the
// optimistic client proxy every UI (desktop, extension) drives over
// RPC. This suite runs the same scenarios against both and asserts the
// resulting tree STRUCTURE + active item match. Keys are independent
// per instance, so we compare by title / done / note-count / order —
// not by key.

import { describe, it, expect } from 'vitest';
import '@noggin/engine/providers/memory'; // register memory://

import type { Item, Noggin } from '@noggin/engine';
import { openMemoryNoggin } from '@noggin/engine/providers/memory';
import { RpcClient } from '../src/client.ts';
import { createNogginRpcServer } from '../src/server-adapter.ts';
import { openRemoteNoggin } from '../src/open-remote-noggin.ts';
import { createMemoryTransportPair } from '../src/transports/memory.ts';

interface Node { title: string; done: boolean; notes: number; children: Node[] }

function structure(noggin: { items: readonly Item[] }): Node[] {
  const byParent = new Map<string | null, Item[]>();
  for (const it of noggin.items) {
    const k = it.parentKey ?? null;
    const list = byParent.get(k);
    if (list) list.push(it);
    else byParent.set(k, [it]);
  }
  const build = (parentKey: string | null): Node[] =>
    (byParent.get(parentKey) ?? []).map((it) => ({
      title: it.title,
      done: it.done,
      notes: Array.isArray(it.notes) ? it.notes.length : 0,
      children: build(it.key),
    }));
  return build(null);
}

const activeTitle = (noggin: { active: Item | null }): string | null =>
  (noggin.active ? noggin.active.title : null);

type Scenario = { name: string; run: (n: Noggin) => Promise<void> };

const scenarios: Scenario[] = [
  {
    name: 'push then add children',
    run: async (n) => { await n.push({ title: 'root' }); await n.add({ title: 'c1' }); await n.add({ title: 'c2' }); },
  },
  {
    name: 'nested push chain',
    run: async (n) => { await n.push({ title: 'a' }); await n.push({ title: 'b' }); await n.push({ title: 'c' }); },
  },
  {
    name: 'done appends a close note and surfaces to parent',
    run: async (n) => { await n.push({ title: 'parent' }); await n.push({ title: 'child' }); await n.done({}); },
  },
  {
    name: 'edit renames active',
    run: async (n) => { await n.push({ title: 'old' }); await n.edit({ title: 'new' }); },
  },
  {
    name: 'notes append to active',
    run: async (n) => { await n.push({ title: 't' }); await n.note({ text: 'hi' }); await n.note({ text: 'bye' }); },
  },
  {
    name: 'delete a subtree',
    run: async (n) => { await n.push({ title: 'p' }); await n.add({ title: 'c' }); await n.delete({ path: '/1', recursive: true }); },
  },
];

async function runEngine(run: Scenario['run']) {
  const n = (await openMemoryNoggin({ label: 'conf-engine' })) as unknown as Noggin;
  try {
    await run(n);
    return { structure: structure(n as unknown as { items: readonly Item[] }), active: activeTitle(n as unknown as { active: Item | null }) };
  } finally {
    await (n as unknown as { dispose(): Promise<void> }).dispose();
  }
}

async function runRemote(run: Scenario['run']) {
  const { a, b } = createMemoryTransportPair();
  const server = createNogginRpcServer({ transport: a });
  const client = new RpcClient(b);
  const n = (await openRemoteNoggin({ client, location: 'memory://conf-remote' })) as unknown as Noggin;
  try {
    await run(n);
    return { structure: structure(n as unknown as { items: readonly Item[] }), active: activeTitle(n as unknown as { active: Item | null }) };
  } finally {
    await (n as unknown as { dispose(): Promise<void> }).dispose();
    client.dispose();
    await server.dispose();
  }
}

describe('Noggin conformance: engine ≡ RemoteNoggin', () => {
  for (const sc of scenarios) {
    it(sc.name, async () => {
      const engine = await runEngine(sc.run);
      const remote = await runRemote(sc.run);
      expect(remote.structure).toEqual(engine.structure);
      expect(remote.active).toEqual(engine.active);
    });
  }
});
