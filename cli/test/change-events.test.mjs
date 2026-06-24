// diffDocuments + ChangeEvent payload coverage. Verifies the small
// observer-facing vocabulary (added/removed/moved/updated/activeChanged)
// produced by both `diffDocuments` directly and the backends emitting
// onDidChange.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  diffDocuments,
  verbs,
} from '../noggin-api.mjs';
import { openMemoryNoggin } from '../backends/memory.mjs';

function doc(items, active = null) {
  return { schemaVersion: 1, active, items };
}

function item(key, parentKey, title, opts = {}) {
  return {
    key,
    parentKey,
    title,
    done: !!opts.done,
    createdAt: opts.createdAt || '2026-06-01T00:00:00.000Z',
    notes: opts.notes || [],
  };
}

describe('diffDocuments', () => {
  it('emits no changes for identical documents', () => {
    const a = doc([item('k1', null, 'one')]);
    const b = doc([item('k1', null, 'one')]);
    assert.deepEqual(diffDocuments(a, b), []);
  });

  it('detects added items with parent + position', () => {
    const a = doc([item('k1', null, 'one')]);
    const b = doc([item('k1', null, 'one'), item('k2', null, 'two'), item('k3', 'k1', 'child')]);
    const changes = diffDocuments(a, b);
    assert.deepEqual(changes, [
      { kind: 'added', key: 'k2', parentKey: null, position: 1 },
      { kind: 'added', key: 'k3', parentKey: 'k1', position: 0 },
    ]);
  });

  it('detects removed items', () => {
    const a = doc([item('k1', null, 'one'), item('k2', null, 'two')]);
    const b = doc([item('k1', null, 'one')]);
    assert.deepEqual(diffDocuments(a, b), [
      { kind: 'removed', key: 'k2' },
    ]);
  });

  it('detects moved items (different parent)', () => {
    const a = doc([item('k1', null, 'A'), item('k2', null, 'B'), item('k3', 'k2', 'C')]);
    const b = doc([item('k1', null, 'A'), item('k2', null, 'B'), item('k3', 'k1', 'C')]);
    const changes = diffDocuments(a, b);
    assert.deepEqual(changes, [
      { kind: 'moved', key: 'k3', from: { parentKey: 'k2', position: 0 }, to: { parentKey: 'k1', position: 0 } },
    ]);
  });

  it('detects moved items (sibling reorder)', () => {
    const a = doc([item('k1', null, 'A'), item('k2', null, 'B'), item('k3', null, 'C')]);
    const b = doc([item('k3', null, 'C'), item('k1', null, 'A'), item('k2', null, 'B')]);
    const changes = diffDocuments(a, b);
    // k1 moves from 0→1, k2 from 1→2, k3 from 2→0.
    assert.equal(changes.filter((c) => c.kind === 'moved').length, 3);
    const k3 = changes.find((c) => c.key === 'k3' && c.kind === 'moved');
    assert.deepEqual(k3.from, { parentKey: null, position: 2 });
    assert.deepEqual(k3.to,   { parentKey: null, position: 0 });
  });

  it('detects updated fields', () => {
    const a = doc([item('k1', null, 'old', { done: false })]);
    const b = doc([item('k1', null, 'new', { done: true, notes: [{ timestamp: 't', text: 'n' }] })]);
    assert.deepEqual(diffDocuments(a, b), [
      { kind: 'updated', key: 'k1', fields: ['title', 'done', 'notes'] },
    ]);
  });

  it('detects active changes', () => {
    const a = doc([item('k1', null, 'one')], null);
    const b = doc([item('k1', null, 'one')], 'k1');
    assert.deepEqual(diffDocuments(a, b), [
      { kind: 'activeChanged', from: null, to: 'k1' },
    ]);
  });

  it('combines multiple change kinds in one diff', () => {
    const a = doc([item('k1', null, 'A')], null);
    const b = doc([item('k1', null, 'A!'), item('k2', null, 'B')], 'k2');
    const changes = diffDocuments(a, b);
    assert.equal(changes.length, 3);
    assert.ok(changes.find((c) => c.kind === 'added' && c.key === 'k2'));
    assert.ok(changes.find((c) => c.kind === 'updated' && c.key === 'k1'));
    assert.ok(changes.find((c) => c.kind === 'activeChanged'));
  });
});

describe('ChangeEvent emission', () => {
  it('fires onDidChange with an ItemChange[] for verb-driven mutations', async () => {
    const n = await openMemoryNoggin();
    const events = [];
    const sub = n.onDidChange((changes) => events.push(changes));

    await verbs.add(n, { title: 'A' });
    await verbs.add(n, { title: 'B' });
    await verbs.goto(n, { path: '/2' });

    assert.equal(events.length, 3);
    for (const changes of events) {
      assert.ok(Array.isArray(changes));
      assert.ok(changes.length > 0);
    }
    // First add → exactly one `added` for the new root.
    const first = events[0];
    assert.equal(first.length, 1);
    assert.equal(first[0].kind, 'added');

    // goto → exactly one `activeChanged`.
    const last = events[2];
    assert.equal(last.length, 1);
    assert.equal(last[0].kind, 'activeChanged');

    sub.dispose();
    await n.dispose();
  });

  it('done emits both an updated (notes+done) and an activeChanged', async () => {
    const n = await openMemoryNoggin();
    await verbs.push(n, { title: 'root' });
    await verbs.push(n, { title: 'child' });
    const events = [];
    const sub = n.onDidChange((changes) => events.push(changes));

    await verbs.done(n);

    assert.equal(events.length, 1);
    const changes = events[0];
    const upd = changes.find((c) => c.kind === 'updated');
    const act = changes.find((c) => c.kind === 'activeChanged');
    assert.ok(upd, 'expected an updated change');
    assert.ok(act, 'expected an activeChanged change');
    assert.deepEqual(upd.fields.sort(), ['done', 'notes']);

    sub.dispose();
    await n.dispose();
  });
});
