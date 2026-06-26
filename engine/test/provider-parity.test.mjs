// Provider parity smoke.
//
// Runs a representative slice of verb-driven mutations against every
// provider so a new verb (or a provider tweak) cannot silently break
// one backend while passing on another. This is a small suite by
// design — the full verb coverage lives in the per-verb test files
// against the memory provider; here we only check that *every*
// provider executes the same recipe to the same shape.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { openNoggin, verbs } from '../noggin-api.mjs';
import '../providers/file.mjs';
import '../providers/memory.mjs';
import '../../docs/site/playground/localStorageNoggin.mjs';

import { makeBrowserStoragePair } from './provider-fixtures.mjs';

// Each provider gets opened the same way via a small factory. Tests
// run identically across all three so any divergence shows up as a
// test failure on just that provider.
const FACTORIES = [
  {
    name: 'file://',
    open: async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'noggin-parity-'));
      const file = path.join(dir, '.noggin.yaml');
      const n = await openNoggin(`file://${file}`);
      return {
        noggin: n,
        cleanup: async () => { await n.dispose(); rmSync(dir, { recursive: true, force: true }); },
      };
    },
  },
  {
    name: 'memory://',
    open: async () => {
      const n = await openNoggin('memory://parity');
      return { noggin: n, cleanup: () => n.dispose() };
    },
  },
  {
    name: 'localstorage://',
    open: async () => {
      const { storageA } = makeBrowserStoragePair();
      const n = await openNoggin('localstorage://parity', { storage: storageA });
      return { noggin: n, cleanup: () => n.dispose() };
    },
  },
];

for (const { name, open } of FACTORIES) {
  describe(`provider parity: ${name}`, () => {
    it('push → add → goto → done → note: each verb mutates the doc as expected', async () => {
      const { noggin, cleanup } = await open();
      try {
        // push: new root, becomes active.
        await verbs.push(noggin, { title: 'root' });
        assert.equal(noggin.items.length, 1);
        assert.equal(noggin.active?.title, 'root');

        // add: child of active, no focus change.
        await verbs.add(noggin, { title: 'kid' });
        assert.equal(noggin.items.length, 2);
        assert.equal(noggin.active?.title, 'root');

        // goto: focus the child.
        await verbs.goto(noggin, { path: '/1/1' });
        assert.equal(noggin.active?.title, 'kid');

        // note: appends to the child.
        await verbs.note(noggin, { text: 'thought' });
        const kid = noggin.tryResolvePath('/1/1');
        assert.equal(kid.notes.length, 1);
        assert.equal(kid.notes[0].text, 'thought');

        // done: closes the child, focus jumps to parent.
        await verbs.done(noggin);
        const kidAfter = noggin.tryResolvePath('/1/1');
        assert.equal(kidAfter.done, true);
        assert.equal(noggin.active?.title, 'root');
        // Done appends a system note.
        assert.equal(kidAfter.notes.at(-1)?.text, 'closed');
      } finally { await cleanup(); }
    });

    it('move: relocates an item to a new parent', async () => {
      const { noggin, cleanup } = await open();
      try {
        await verbs.push(noggin, { title: 'A' });
        await verbs.add(noggin, { title: 'B' });           // child of A → /1/1
        // Make C a root sibling of A by placing it after /1.
        await verbs.add(noggin, { title: 'C', placement: { kind: 'after', anchor: '/1' } });
        assert.equal(noggin.tryResolvePath('/2')?.title, 'C');

        // Move B from under A to be a child of C.
        await verbs.move(noggin, { path: '/1/1', placement: { kind: 'into', anchor: '/2' } });

        assert.equal(noggin.tryResolvePath('/1/1'), null, 'no longer under A');
        assert.equal(noggin.tryResolvePath('/2/1')?.title, 'B');
      } finally { await cleanup(); }
    });

    it('onDidChange fires once per apply', async () => {
      const { noggin, cleanup } = await open();
      try {
        let count = 0;
        const sub = noggin.onDidChange(() => { count++; });
        await verbs.push(noggin, { title: 'one' });
        await verbs.add(noggin, { title: 'two' });
        await verbs.goto(noggin, { path: '/1/1' });
        assert.equal(count, 3, 'one event per apply');
        sub.dispose();
      } finally { await cleanup(); }
    });

    it('apply queue serializes within one handle', async () => {
      const { noggin, cleanup } = await open();
      try {
        const N = 15;
        await Promise.all(
          Array.from({ length: N }, (_, i) => verbs.add(noggin, { title: `t-${i}` })),
        );
        assert.equal(noggin.items.length, N);
        const titles = noggin.items.map((i) => i.title).sort();
        const want = Array.from({ length: N }, (_, i) => `t-${i}`).sort();
        assert.deepEqual(titles, want);
      } finally { await cleanup(); }
    });
  });
}
