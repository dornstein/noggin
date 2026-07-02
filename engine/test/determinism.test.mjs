// Engine determinism seam tests.
//
// Verbs stamp timestamps (`nowIso`) and generate item keys (`newKey`).
// Both are injectable via the noggin's verb context (`now` / `newKey`
// options on the provider) so tests can pin them. The bound verb
// methods (`n.push` / `n.add`) thread the context; the free `verbs.*`
// functions take an explicit ctx.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryNoggin } from '../providers/memory.mjs';

describe('engine: determinism seam', () => {
  it('injected newKey + now make keys and timestamps reproducible', async () => {
    let k = 0;
    const n = await openMemoryNoggin({
      newKey: () => `k-${++k}`,
      now: () => new Date('2020-01-01T00:00:00.000Z'),
    });
    await n.push({ title: 'a' });
    await n.add({ title: 'b' });
    assert.deepEqual(n.items.map((i) => i.key), ['k-1', 'k-2']);
    assert.equal(n.items[0].createdAt, '2020-01-01T00:00:00.000Z');
    assert.equal(n.items[1].createdAt, '2020-01-01T00:00:00.000Z');
    await n.dispose();
  });

  it('an advancing clock yields distinct timestamps', async () => {
    let t = 0;
    const n = await openMemoryNoggin({ now: () => new Date(1_600_000_000_000 + (t++) * 1000) });
    await n.push({ title: 'a' });
    await n.add({ title: 'b' });
    assert.notEqual(n.items[0].createdAt, n.items[1].createdAt);
    await n.dispose();
  });

  it('accepts a fixed Date for now (back-compat with ctx.now: Date)', async () => {
    const n = await openMemoryNoggin({ now: new Date('2021-06-15T12:00:00.000Z') });
    await n.push({ title: 'a' });
    assert.equal(n.items[0].createdAt, '2021-06-15T12:00:00.000Z');
    await n.dispose();
  });

  it('without injection, keys are unique and timestamps are ISO', async () => {
    const n = await openMemoryNoggin();
    await n.push({ title: 'a' });
    await n.add({ title: 'b' });
    assert.equal(new Set(n.items.map((i) => i.key)).size, 2);
    assert.match(n.items[0].createdAt, /Z$/);
    await n.dispose();
  });
});
