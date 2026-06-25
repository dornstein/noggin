// Empty-title tests for the engine API.
//
// As of moving the title-required guard from the verbs to the CLI,
// in-process callers can create items with empty titles. This is
// load-bearing for the desktop renderer's add-then-rename UX: the
// renderer creates an item with an empty title, drops it into rename
// mode, and either submits a final title or cancels and deletes.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { verbs } from '../noggin-api.mjs';
import { openMemoryNoggin } from '../backends/memory.mjs';

describe('engine: empty titles', () => {
  it('verbs.add accepts an empty title and creates an item', async () => {
    const n = await openMemoryNoggin();
    const r = await verbs.add(n, { title: '' });
    assert.equal(n.items.length, 1);
    const item = n.findByKey(r.targetKey);
    assert.equal(item.title, '');
    await n.dispose();
  });

  it('verbs.push accepts an empty title and becomes active', async () => {
    const n = await openMemoryNoggin();
    await verbs.push(n, { title: '' });
    assert.equal(n.active?.title, '');
    await n.dispose();
  });

  it('verbs.add with placement after an existing item still works', async () => {
    const n = await openMemoryNoggin();
    await verbs.add(n, { title: 'A' });
    const r = await verbs.add(n, { title: '', placement: { kind: 'after', anchor: '/1' } });
    assert.equal(n.items.length, 2);
    const second = n.tryResolvePath('/2');
    assert.equal(second?.key, r.targetKey);
    assert.equal(second?.title, '');
    await n.dispose();
  });

  it('verbs.edit can replace an empty title with a real one', async () => {
    const n = await openMemoryNoggin();
    const r = await verbs.add(n, { title: '' });
    const path = n.pathOf(n.findByKey(r.targetKey));
    await verbs.edit(n, { path, title: 'Finally named' });
    assert.equal(n.findByKey(r.targetKey)?.title, 'Finally named');
    await n.dispose();
  });
});
