// Contract: onDidChange must not fire when an apply produces no
// observable change (the diff is empty).
//
// This matters for the optimistic RPC stack: `RemoteNoggin`'s
// `handleChanged` pre-consumes the front of its pending-op queue
// whenever a `noggin.changed` notification arrives. If the engine
// fired empty-diff events, the client would shift the queue without
// receiving a corresponding effect, desyncing optimistic state from
// authoritative state. The contract is "fire iff something changed".

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { openNoggin } from '../noggin-api.mjs';
import '../providers/file.mjs';
import '../providers/memory.mjs';
import '../../docs/site/playground/localStorageNoggin.mjs';

import { makeBrowserStoragePair } from './provider-fixtures.mjs';

// Each provider exercised against the same empty-diff scenario:
// `apply([])` is the simplest no-op the public interface admits.
const PROVIDERS = [
  {
    name: 'file://',
    async open() {
      const dir = mkdtempSync(path.join(tmpdir(), 'noggin-empty-diff-'));
      const file = path.join(dir, '.noggin.yaml');
      const n = await openNoggin(`file://${file}`);
      return { n, cleanup: async () => { await n.dispose(); rmSync(dir, { recursive: true, force: true }); } };
    },
  },
  {
    name: 'memory://',
    async open() {
      const n = await openNoggin('memory://empty-diff');
      return { n, cleanup: () => n.dispose() };
    },
  },
  {
    name: 'localstorage://',
    async open() {
      const { storageA } = makeBrowserStoragePair();
      const n = await openNoggin('localstorage://empty-diff', { storage: storageA });
      return { n, cleanup: () => n.dispose() };
    },
  },
];

for (const { name, open } of PROVIDERS) {
  describe(`empty-diff onDidChange contract: ${name}`, () => {
    it('apply([]) does not fire onDidChange', async () => {
      const { n, cleanup } = await open();
      try {
        const events = [];
        const sub = n.onDidChange((e) => events.push(e));
        await n.apply([]);
        assert.equal(events.length, 0, 'no listeners should fire for an empty op list');
        sub.dispose();
      } finally { await cleanup(); }
    });

    it('an apply that produces an empty diff does not fire onDidChange', async () => {
      // setActive(null) → setActive(null) is a no-op when active is
      // already null. Two consecutive applies — the first creates a
      // state change, the second does not.
      const { n, cleanup } = await open();
      try {
        // First apply: setActive(null) when active is null — no change.
        const events = [];
        const sub = n.onDidChange((e) => events.push(e));
        await n.apply([{ type: 'setActive', key: null }]);
        assert.equal(events.length, 0, 'setActive(null) on already-null active is a no-op');
        sub.dispose();
      } finally { await cleanup(); }
    });
  });
}
