// nogginListStore — unit tests against a real in-memory noggin.
// Drives add / remove / reorder / observe / setSelectedIds and the
// onStateChange persistence callback.

import { describe, it, expect } from 'vitest';
import { createNogginListStore } from '../nogginListStore';
import { verbs } from '@noggin/engine';
import { openMemoryNoggin } from '@noggin/engine/providers/memory';

describe('createNogginListStore — entries', () => {
  it('starts empty by default', () => {
    const store = createNogginListStore();
    expect(store.entries).toEqual([]);
    expect(store.selectedIds).toEqual([]);
  });

  it('seeds initialEntries', () => {
    const store = createNogginListStore({
      initialEntries: [{ uri: 'file:///a' }, { uri: 'file:///b' }],
    });
    expect(store.entries.map((e) => e.uri)).toEqual(['file:///a', 'file:///b']);
  });

  it('dedupes duplicate URIs in initialEntries; later fields win, first position is preserved', () => {
    // A corrupt persisted JSON file can arrive with two entries for
    // the same URI. Left as-is, both rows render, both light up as
    // selected when the URI is opened, and clicks no-op ("already
    // open"). The store merges duplicates on load so the invariant
    // held by `upsert` (URI-unique entries) is guaranteed across the
    // API surface.
    const store = createNogginListStore({
      initialEntries: [
        { uri: 'file:///a', activeTitle: 'stale', itemsTotal: 0 },
        { uri: 'file:///b' },
        { uri: 'file:///a', activeTitle: 'fresh', itemsTotal: 9, itemsDone: 2 },
      ],
    });
    expect(store.entries.map((e) => e.uri)).toEqual(['file:///a', 'file:///b']);
    const a = store.entries[0];
    expect(a.activeTitle).toBe('fresh');
    expect(a.itemsTotal).toBe(9);
    expect(a.itemsDone).toBe(2);
  });

  it('add() inserts new entries at the top', () => {
    const store = createNogginListStore();
    store.add('file:///a');
    store.add('file:///b');
    expect(store.entries.map((e) => e.uri)).toEqual(['file:///b', 'file:///a']);
  });

  it('add() on an existing URI merges fields without reorder', () => {
    const store = createNogginListStore();
    store.add('file:///a', { label: 'A' });
    store.add('file:///b', { label: 'B' });
    store.add('file:///a', { activeTitle: 'updated' });
    const uris = store.entries.map((e) => e.uri);
    expect(uris).toEqual(['file:///b', 'file:///a']);
    const a = store.entries.find((e) => e.uri === 'file:///a')!;
    expect(a.label).toBe('A');
    expect(a.activeTitle).toBe('updated');
  });

  it('remove() drops the entry and clears its selection', () => {
    const store = createNogginListStore({
      initialEntries: [{ uri: 'file:///a' }, { uri: 'file:///b' }],
    });
    store.setSelectedIds(['file:///a']);
    store.remove('file:///a');
    expect(store.entries.map((e) => e.uri)).toEqual(['file:///b']);
    expect(store.selectedIds).toEqual([]);
  });

  it('reorder() moves before the anchor', () => {
    const store = createNogginListStore({
      initialEntries: [{ uri: 'a' }, { uri: 'b' }, { uri: 'c' }],
    });
    store.reorder('a', 'c');
    expect(store.entries.map((e) => e.uri)).toEqual(['b', 'a', 'c']);
  });

  it('reorder() to end (null anchor)', () => {
    const store = createNogginListStore({
      initialEntries: [{ uri: 'a' }, { uri: 'b' }, { uri: 'c' }],
    });
    store.reorder('a', null);
    expect(store.entries.map((e) => e.uri)).toEqual(['b', 'c', 'a']);
  });

  it('reorder() to current position is a silent no-op', () => {
    const store = createNogginListStore({
      initialEntries: [{ uri: 'a' }, { uri: 'b' }, { uri: 'c' }],
    });
    let saved = 0;
    const sub = store.onDidChange(() => { saved += 1; });
    // Moving a before b — a is already before b, no-op.
    store.reorder('a', 'b');
    // Moving c to end — c is already last, no-op.
    store.reorder('c', null);
    expect(saved).toBe(0);
    expect(store.entries.map((e) => e.uri)).toEqual(['a', 'b', 'c']);
    sub.dispose();
  });

  it('reorder() with missing URI is a no-op', () => {
    const store = createNogginListStore({
      initialEntries: [{ uri: 'a' }, { uri: 'b' }],
    });
    let saved = 0;
    const sub = store.onDidChange(() => { saved += 1; });
    store.reorder('zzz', 'a');
    store.reorder('a', 'zzz');
    expect(saved).toBe(0);
    expect(store.entries.map((e) => e.uri)).toEqual(['a', 'b']);
    sub.dispose();
  });

  it('setSelectedIds replaces the array; deduplicates change event', () => {
    const store = createNogginListStore({
      initialEntries: [{ uri: 'a' }, { uri: 'b' }],
    });
    let changes = 0;
    const sub = store.onDidChange(() => { changes += 1; });
    store.setSelectedIds(['a']);
    expect(changes).toBe(1);
    store.setSelectedIds(['a']);
    expect(changes).toBe(1); // no-op
    store.setSelectedIds(['b']);
    expect(changes).toBe(2);
    sub.dispose();
  });

  it('onStateChange fires for entries changes only', () => {
    let savedCount = 0;
    const store = createNogginListStore({ onStateChange: () => { savedCount += 1; } });
    store.add('file:///a');
    expect(savedCount).toBe(1);
    store.setSelectedIds(['file:///a']);
    expect(savedCount).toBe(1); // selection doesn't trigger save
    store.remove('file:///a');
    expect(savedCount).toBe(2);
  });

  it('onStateChange errors re-throw on next mutation', () => {
    let throwOn = 1;
    const store = createNogginListStore({
      onStateChange: () => {
        if (throwOn === 1) { throwOn = 0; throw new Error('save fail'); }
      },
    });
    // First add: save throws but the in-memory change still applies.
    store.add('a');
    expect(store.entries.map((e) => e.uri)).toEqual(['a']);
    // Second add: should rethrow the previous error.
    expect(() => store.add('b')).toThrow(/save fail/);
    // After the rethrow, state should be drained.
    store.add('c');
    expect(store.entries.map((e) => e.uri)).toContain('c');
  });
});

describe('createNogginListStore — observe bridge', () => {
  it('observe() snapshots active key, title, path, and counts', async () => {
    const noggin = await openMemoryNoggin();
    await verbs.add(noggin, { title: 'parent' });
    await verbs.add(noggin, { title: 'child1', placement: { kind: 'into', anchor: '/1' } });
    await verbs.add(noggin, { title: 'child2', placement: { kind: 'into', anchor: '/1' } });
    await verbs.goto(noggin, { path: '/1/2' });

    const store = createNogginListStore();
    const sub = store.observe('memory://noggin', noggin);

    const entry = store.entries.find((e) => e.uri === 'memory://noggin')!;
    expect(entry.activeTitle).toBe('child2');
    expect(entry.activePath).toBe('/1/2');
    expect(entry.itemsTotal).toBe(3);
    expect(entry.itemsDone).toBe(0);

    sub.dispose();
    await noggin.dispose();
  });

  it('observe() reprojects on noggin.onDidChange', async () => {
    const noggin = await openMemoryNoggin();
    await verbs.add(noggin, { title: 'a' });
    await verbs.add(noggin, { title: 'b' });

    const store = createNogginListStore();
    const sub = store.observe('mem://n', noggin);
    expect(store.entries[0]?.itemsTotal).toBe(2);

    await verbs.done(noggin, { path: '/1' });
    expect(store.entries[0]?.itemsDone).toBe(1);

    sub.dispose();
    await noggin.dispose();
  });

  it('observe() upserts an entry implicitly when missing', async () => {
    const noggin = await openMemoryNoggin();
    await verbs.add(noggin, { title: 'x' });

    const store = createNogginListStore();
    expect(store.entries).toHaveLength(0);
    const sub = store.observe('mem://x', noggin);
    expect(store.entries.map((e) => e.uri)).toEqual(['mem://x']);

    sub.dispose();
    await noggin.dispose();
  });

  it('double-observe throws', async () => {
    const noggin = await openMemoryNoggin();
    const store = createNogginListStore();
    const sub = store.observe('mem://x', noggin);
    expect(() => store.observe('mem://x', noggin)).toThrow(/already observing/);
    sub.dispose();
    // After dispose, observing again is fine.
    const sub2 = store.observe('mem://x', noggin);
    sub2.dispose();
    await noggin.dispose();
  });

  it('dispose() clears selection for that URI', async () => {
    const noggin = await openMemoryNoggin();
    const store = createNogginListStore();
    const sub = store.observe('mem://x', noggin);
    store.setSelectedIds(['mem://x']);
    expect(store.selectedIds).toEqual(['mem://x']);
    sub.dispose();
    expect(store.selectedIds).toEqual([]);
    await noggin.dispose();
  });

  it('skips redundant change events when snapshot is identical', async () => {
    const noggin = await openMemoryNoggin();
    await verbs.add(noggin, { title: 'a' });

    const store = createNogginListStore();
    let changes = 0;
    const sub = store.onDidChange(() => { changes += 1; });
    const obs = store.observe('mem://x', noggin);
    const baseline = changes;
    // Trigger an onDidChange on the noggin that produces the same
    // snapshot fields — a no-op verb. The store should not fire.
    // (Adding a note doesn't change active, counts, or title.)
    await verbs.note(noggin, { path: '/1', text: 'hello' });
    // It's hard to make the snapshot truly unchanged because notes
    // affect items[] but not the snapshot fields. So this assertion
    // verifies the snapshot-equality guard works.
    expect(changes).toBe(baseline);

    obs.dispose();
    sub.dispose();
    await noggin.dispose();
  });
});

describe('createNogginListStore — onUriActivity hook', () => {
  it('fires onUriActivity on each observed onDidChange (but not the initial snapshot)', async () => {
    const noggin = await openMemoryNoggin();
    await verbs.add(noggin, { title: 'a' });

    const events: Array<{ uri: string; at: Date }> = [];
    const store = createNogginListStore({
      onUriActivity: (uri, at) => events.push({ uri, at }),
    });
    const before = events.length;
    const sub = store.observe('mem://x', noggin);
    // Initial snapshot must not count as activity.
    expect(events.length).toBe(before);

    await verbs.add(noggin, { title: 'b' });
    expect(events).toHaveLength(1);
    expect(events[0].uri).toBe('mem://x');
    expect(events[0].at).toBeInstanceOf(Date);

    await verbs.done(noggin, { path: '/1' });
    expect(events).toHaveLength(2);

    sub.dispose();
    await noggin.dispose();
  });

  it('absorbs onUriActivity throws (warns + continues)', async () => {
    const noggin = await openMemoryNoggin();
    const store = createNogginListStore({
      onUriActivity: () => { throw new Error('boom'); },
    });
    const sub = store.observe('mem://x', noggin);
    await expect(verbs.add(noggin, { title: 'a' })).resolves.not.toThrow();
    sub.dispose();
    await noggin.dispose();
  });
});
