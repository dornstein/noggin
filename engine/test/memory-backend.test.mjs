// Smoke tests for the memory backend. Verifies that the same verbs
// that work against the file backend also work against memory:// —
// any behavioural divergence would mean browser-iteration screenshots
// could mislead UI work.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  openNoggin,
  verbs,
} from '../noggin-api.mjs';
import { openMemoryNoggin } from '../providers/memory.mjs';

describe('memory backend', () => {
  it('registers under memory:// and openNoggin resolves it', async () => {
    const n = await openNoggin('memory://test');
    assert.equal(n.describe(), 'memory://test');
    assert.equal(n.items.length, 0);
    await n.dispose();
  });

  it('runs the full push/add/done/move/note cycle', async () => {
    const n = await openMemoryNoggin();

    // push creates a child of active and becomes it. With no active,
    // it creates a root.
    const v1 = await verbs.push(n, { title: 'A' });
    assert.equal(n.items.length, 1);
    assert.equal(n.active?.title, 'A');
    assert.equal(v1.activePath, '/1');

    // add (no placement) → child of active, doesn't change focus.
    const v2 = await verbs.add(n, { title: 'A.1' });
    assert.equal(n.items.length, 2);
    assert.equal(n.active?.title, 'A');
    assert.equal(v2.activePath, '/1');

    // add with placement after → sibling of anchor.
    await verbs.goto(n, { path: '/1/1' });
    await verbs.add(n, { title: 'A.2', placement: { kind: 'after', anchor: '/1/1' } });
    assert.equal(n.items.length, 3);
    const a2 = n.tryResolvePath('/1/2');
    assert.equal(a2?.title, 'A.2');

    // note appends a timestamped entry.
    await verbs.note(n, { path: '/1/1', text: 'hello' });
    const a1 = n.tryResolvePath('/1/1');
    assert.equal(a1?.notes.length, 1);
    assert.equal(a1?.notes[0].text, 'hello');

    // done marks closed + appends a system 'closed' note.
    await verbs.done(n, { path: '/1/2' });
    const a2done = n.tryResolvePath('/1/2');
    assert.equal(a2done?.done, true);
    assert.equal(a2done?.notes.at(-1)?.text, 'closed');

    // move (before/after/into).
    await verbs.add(n, { title: 'B' });
    // Tree is now /1 (A) → /1/1 (A.1), /1/2 (A.2 done), /1/3 (B child of A)
    // Move B to be a root after A.
    await verbs.move(n, { path: '/1/3', placement: { kind: 'after', anchor: '/1' } });
    assert.equal(n.tryResolvePath('/2')?.title, 'B');

    await n.dispose();
  });

  it('fires onDidChange on every mutation', async () => {
    const n = await openMemoryNoggin();
    let count = 0;
    const sub = n.onDidChange(() => { count++; });
    await verbs.push(n, { title: 'X' });
    await verbs.note(n, { text: 'note' });
    await verbs.done(n);
    assert.ok(count >= 3, `expected >=3 change events, got ${count}`);
    sub.dispose();
    await n.dispose();
  });

  it('seeds from an initial document', async () => {
    const n = await openMemoryNoggin({
      initialDocument: {
        schemaVersion: 1,
        active: null,
        items: [
          { key: 'i-seed-aaa', parentKey: null, title: 'seeded', done: false, notes: [], createdAt: '2026-01-01T00:00:00.000Z' },
        ],
      },
    });
    assert.equal(n.items.length, 1);
    assert.equal(n.tryResolvePath('/1')?.title, 'seeded');
    await n.dispose();
  });
});
