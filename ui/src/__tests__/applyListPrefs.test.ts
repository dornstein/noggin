// applyListPrefs — unit tests for the pure projection helper.

import { describe, it, expect } from 'vitest';
import { applyListPrefs, completionStatusOf } from '../applyListPrefs';
import {
  createNogginProviderRegistry,
  defaultNogginProviders,
} from '../nogginProviderRegistry';
import {
  defaultNogginListPrefs,
  type NogginListEntry,
  type NogginListPrefs,
} from '../nogginListStore';
import { createMRUManager } from '../mruManager';

const providers = createNogginProviderRegistry(defaultNogginProviders);

function makePrefs(overrides: Partial<NogginListPrefs> = {}): NogginListPrefs {
  return { ...defaultNogginListPrefs, ...overrides };
}

// Entries carry no `lastOpenedAt` anymore — sort order comes from an
// MRU reader. We seed the MRU separately in the sort tests.
const FILE_A: NogginListEntry = { uri: 'file:///a.yaml', itemsTotal: 10, itemsDone: 4 };
const FILE_B: NogginListEntry = { uri: 'file:///b.yaml', itemsTotal: 5, itemsDone: 5 };
const URL_C: NogginListEntry = { uri: 'https://example.com/c.yaml', itemsTotal: 7, itemsDone: 0 };
const MEM_D: NogginListEntry = { uri: 'memory://d' };

function mruWith(times: Record<string, string>) {
  return createMRUManager({ initial: times, maxEntries: Infinity });
}

describe('applyListPrefs', () => {
  it('manual sort preserves input order', () => {
    const out = applyListPrefs([FILE_A, FILE_B, URL_C], makePrefs(), providers);
    expect(out.map((e) => e.uri)).toEqual([FILE_A.uri, FILE_B.uri, URL_C.uri]);
  });

  it('newest sort orders by MRU lastUsedAt desc', () => {
    const mru = mruWith({
      [FILE_A.uri]: '2026-06-01T00:00:00.000Z',
      [FILE_B.uri]: '2026-06-02T00:00:00.000Z',
      [URL_C.uri]: '2026-06-03T00:00:00.000Z',
      [MEM_D.uri]: '2026-05-20T00:00:00.000Z',
    });
    const out = applyListPrefs([FILE_A, FILE_B, URL_C, MEM_D], makePrefs({ sortMode: 'newest' }), providers, mru);
    expect(out.map((e) => e.uri)).toEqual([URL_C.uri, FILE_B.uri, FILE_A.uri, MEM_D.uri]);
  });

  it('oldest sort orders by MRU lastUsedAt asc', () => {
    const mru = mruWith({
      [FILE_A.uri]: '2026-06-01T00:00:00.000Z',
      [FILE_B.uri]: '2026-06-02T00:00:00.000Z',
      [URL_C.uri]: '2026-06-03T00:00:00.000Z',
      [MEM_D.uri]: '2026-05-20T00:00:00.000Z',
    });
    const out = applyListPrefs([FILE_A, FILE_B, URL_C, MEM_D], makePrefs({ sortMode: 'oldest' }), providers, mru);
    expect(out.map((e) => e.uri)).toEqual([MEM_D.uri, FILE_A.uri, FILE_B.uri, URL_C.uri]);
  });

  it('newest/oldest fall back to manual when no MRU reader is supplied', () => {
    const input = [FILE_A, FILE_B, URL_C, MEM_D];
    const out = applyListPrefs(input, makePrefs({ sortMode: 'newest' }), providers);
    expect(out.map((e) => e.uri)).toEqual(input.map((e) => e.uri));
  });

  it('entries with no MRU timestamp sink to the end of newest sort', () => {
    const mru = mruWith({
      [FILE_B.uri]: '2026-06-02T00:00:00.000Z',
      // FILE_A and URL_C never touched
    });
    const out = applyListPrefs([FILE_A, FILE_B, URL_C], makePrefs({ sortMode: 'newest' }), providers, mru);
    expect(out[0].uri).toBe(FILE_B.uri); // only touched
  });

  it('typeFilter=null shows everything', () => {
    const out = applyListPrefs([FILE_A, URL_C, MEM_D], makePrefs({ typeFilter: null }), providers);
    expect(out).toHaveLength(3);
  });

  it('typeFilter=[file] hides everything else', () => {
    const out = applyListPrefs([FILE_A, URL_C, MEM_D], makePrefs({ typeFilter: ['file'] }), providers);
    expect(out.map((e) => e.uri)).toEqual([FILE_A.uri]);
  });

  it('typeFilter=[https] includes alias http via registry', () => {
    const httpEntry: NogginListEntry = { uri: 'http://example.com/x.yaml' };
    const out = applyListPrefs([FILE_A, URL_C, httpEntry], makePrefs({ typeFilter: ['https'] }), providers);
    expect(out.map((e) => e.uri)).toEqual([URL_C.uri, httpEntry.uri]);
  });

  it('typeFilter listing every registered scheme is equivalent to null', () => {
    const all: NogginListEntry[] = [FILE_A, URL_C, MEM_D];
    const withAll = applyListPrefs(
      all,
      makePrefs({ typeFilter: ['file', 'https', 'memory'] }),
      providers,
    );
    const withNull = applyListPrefs(all, makePrefs({ typeFilter: null }), providers);
    expect(withAll.map((e) => e.uri)).toEqual(withNull.map((e) => e.uri));
  });

  it('completionFilter=complete keeps only fully-done entries', () => {
    const out = applyListPrefs([FILE_A, FILE_B, URL_C, MEM_D], makePrefs({ completionFilter: 'complete' }), providers);
    expect(out.map((e) => e.uri)).toEqual([FILE_B.uri]);
  });

  it('completionFilter=incomplete buckets unknown entries with incomplete', () => {
    const out = applyListPrefs([FILE_A, FILE_B, URL_C, MEM_D], makePrefs({ completionFilter: 'incomplete' }), providers);
    expect(out.map((e) => e.uri)).toEqual([FILE_A.uri, URL_C.uri, MEM_D.uri]);
  });

  it('filters compose with sort', () => {
    const mru = mruWith({
      [FILE_A.uri]: '2026-06-01T00:00:00.000Z',
      [FILE_B.uri]: '2026-06-02T00:00:00.000Z',
    });
    const out = applyListPrefs(
      [FILE_A, FILE_B, URL_C, MEM_D],
      makePrefs({ typeFilter: ['file'], sortMode: 'newest' }),
      providers,
      mru,
    );
    expect(out.map((e) => e.uri)).toEqual([FILE_B.uri, FILE_A.uri]);
  });

  it('does not mutate input', () => {
    const mru = mruWith({
      [FILE_A.uri]: '2026-06-01T00:00:00.000Z',
      [FILE_B.uri]: '2026-06-02T00:00:00.000Z',
      [URL_C.uri]: '2026-06-03T00:00:00.000Z',
    });
    const input = [FILE_A, FILE_B, URL_C];
    const original = input.slice();
    applyListPrefs(input, makePrefs({ sortMode: 'newest' }), providers, mru);
    expect(input).toEqual(original);
  });
});

describe('completionStatusOf', () => {
  it('returns unknown when itemsTotal absent', () => {
    expect(completionStatusOf({ uri: 'x' })).toBe('unknown');
  });

  it('returns unknown when itemsTotal known but itemsDone absent', () => {
    expect(completionStatusOf({ uri: 'x', itemsTotal: 5 })).toBe('unknown');
  });

  it('returns incomplete for empty noggin (0/0)', () => {
    expect(completionStatusOf({ uri: 'x', itemsTotal: 0, itemsDone: 0 })).toBe('incomplete');
  });

  it('returns complete when done === total > 0', () => {
    expect(completionStatusOf({ uri: 'x', itemsTotal: 5, itemsDone: 5 })).toBe('complete');
  });

  it('returns incomplete when done < total', () => {
    expect(completionStatusOf({ uri: 'x', itemsTotal: 5, itemsDone: 2 })).toBe('incomplete');
  });
});
