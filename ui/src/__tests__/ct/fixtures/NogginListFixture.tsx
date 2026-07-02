// Fixture mounting <NogginList> against a real in-memory noggin
// plus a controlled prefs holder and a probe panel exposing the
// store's state for test assertions.
//
// CT can't ship callable props (Node→browser serialization), so
// the fixture mirrors what desktop's Sidebar does: it creates the
// noggin + store + registry locally and wires them together.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { NogginList } from '../../../NogginList';
import {
  createNogginListStore,
  defaultNogginListPrefs,
  type NogginListEntry,
  type NogginListPrefs,
  type NogginListStore,
} from '../../../nogginListStore';
import {
  createNogginProviderRegistry,
  defaultNogginProviders,
} from '../../../nogginProviderRegistry';
import { createMRUManager, type MRUManager } from '../../../mruManager';
import { openMemoryNoggin } from '@noggin/engine/providers/memory';
import type { Noggin } from '@noggin/engine';

export type NogginListFixtureSeed =
  /** Three file entries; the first is observed and selected. */
  | 'three-files'
  /** One file entry observed; second is closed memory; third is closed https. */
  | 'mixed-types'
  /** Empty store. */
  | 'empty'
  /** Three file entries, none observed (all closed-state). */
  | 'three-closed';

export interface NogginListFixtureProps {
  seed?: NogginListFixtureSeed;
  /** Optional prefs override merged with defaultNogginListPrefs. */
  initialPrefs?: Partial<NogginListPrefs>;
}

export function NogginListFixture({
  seed = 'three-files',
  initialPrefs,
}: NogginListFixtureProps) {
  const providers = useMemo(
    () => createNogginProviderRegistry(defaultNogginProviders),
    [],
  );
  const [store, setStore] = useState<NogginListStore | null>(null);
  const [mru, setMru] = useState<MRUManager | null>(null);
  const [noggin, setNoggin] = useState<Noggin | null>(null);
  const [prefs, setPrefs] = useState<NogginListPrefs>({
    ...defaultNogginListPrefs,
    ...initialPrefs,
  });
  const [activated, setActivated] = useState<string | null>(null);
  const [closed, setClosed] = useState(0);
  // Re-render on store changes so probes see the latest state.
  const [, bump] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let n: Noggin | null = null;
    (async () => {
      const entries: NogginListEntry[] = [];
      const mruSeed: Record<string, string> = {};
      let observedUri: string | null = null;

      if (seed === 'empty') {
        // no entries, no live noggin
      } else if (seed === 'three-files') {
        entries.push(
          { uri: 'file:///alpha.yaml' },
          { uri: 'file:///beta.yaml' },
          { uri: 'file:///gamma.yaml' },
        );
        mruSeed['file:///alpha.yaml'] = '2026-06-01T10:00:00.000Z';
        mruSeed['file:///beta.yaml']  = '2026-06-02T10:00:00.000Z';
        mruSeed['file:///gamma.yaml'] = '2026-06-03T10:00:00.000Z';
        observedUri = 'file:///alpha.yaml';
      } else if (seed === 'mixed-types') {
        entries.push(
          { uri: 'file:///work.yaml' },
          { uri: 'memory://scratch' },
          { uri: 'https://example.com/r.yaml' },
        );
        mruSeed['file:///work.yaml']          = '2026-06-03T10:00:00.000Z';
        mruSeed['memory://scratch']           = '2026-06-02T10:00:00.000Z';
        mruSeed['https://example.com/r.yaml'] = '2026-06-01T10:00:00.000Z';
        observedUri = 'file:///work.yaml';
      } else if (seed === 'three-closed') {
        entries.push(
          { uri: 'file:///c1.yaml', itemsTotal: 5, itemsDone: 5 },
          { uri: 'file:///c2.yaml', itemsTotal: 4, itemsDone: 2 },
          { uri: 'file:///c3.yaml' },
        );
        mruSeed['file:///c1.yaml'] = '2026-06-01T10:00:00.000Z';
        mruSeed['file:///c2.yaml'] = '2026-06-02T10:00:00.000Z';
        mruSeed['file:///c3.yaml'] = '2026-06-03T10:00:00.000Z';
      }

      if (observedUri) {
        n = await openMemoryNoggin();
        await n.add({ title: 'parent' });
        await n.add({ title: 'child-1', placement: { kind: 'into', anchor: '/1' } });
        await n.add({ title: 'child-2', placement: { kind: 'into', anchor: '/1' } });
        await n.goto({ path: '/1/2' });
      }

      if (cancelled) {
        if (n) await n.dispose();
        return;
      }

      const m = createMRUManager({ initial: mruSeed, maxEntries: Infinity });
      const s = createNogginListStore({
        initialEntries: entries,
        onUriActivity: (uri) => m.touch(uri),
      });
      s.onDidChange(() => bump((v) => v + 1));
      m.onDidChange(() => bump((v) => v + 1));
      if (observedUri && n) {
        s.observe(observedUri, n);
        s.setSelectedIds([observedUri]);
      }
      setStore(s);
      setMru(m);
      setNoggin(n);
    })();
    return () => {
      cancelled = true;
      if (n) void n.dispose();
    };
  }, [seed]);

  const onActivate = useCallback((uri: string) => {
    setActivated(uri);
    store?.setSelectedIds([uri]);
  }, [store]);

  const onCloseActiveEntry = useCallback(() => {
    setClosed((c) => c + 1);
    store?.setSelectedIds([]);
  }, [store]);

  if (!store) return <div data-testid="not-ready">loading…</div>;

  const entriesSummary = store.entries.map((e) => e.uri).join(' | ');
  const selectedSummary = store.selectedIds.join(' | ');
  const visibleCount = store.entries.length;

  // Optional verb buttons so tests can mutate the live noggin without
  // typing inside the tree.
  const markActiveDone = async (): Promise<void> => {
    if (!noggin) return;
    await noggin.done({ path: '/1/2' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
      <div style={{ display: 'flex', gap: 12, fontFamily: 'monospace', fontSize: 11, flexWrap: 'wrap' }}>
        <span data-testid="entries-count">{visibleCount}</span>
        <span data-testid="entries-summary">{entriesSummary}</span>
        <span data-testid="selected-summary">{selectedSummary || '(none)'}</span>
        <span data-testid="last-activated">{activated ?? '(none)'}</span>
        <span data-testid="close-count">{closed}</span>
        <span data-testid="sort-mode">{prefs.sortMode}</span>
        <span data-testid="type-filter">{prefs.typeFilter === null ? '(all)' : prefs.typeFilter.join(',')}</span>
        <span data-testid="completion-filter">{prefs.completionFilter}</span>
        <span data-testid="show-path">{prefs.showPath ? 'y' : 'n'}</span>
        <span data-testid="show-key">{prefs.showKey ? 'y' : 'n'}</span>
        <span data-testid="show-title">{prefs.showTitle ? 'y' : 'n'}</span>
        <span data-testid="show-type">{prefs.showType ? 'y' : 'n'}</span>
        <button data-testid="mark-active-done" onClick={() => { void markActiveDone(); }}>mark done</button>
      </div>
      <div style={{ width: 360, height: 460, border: '1px solid #ccc' }}>
        <NogginList
          store={store}
          providers={providers}
          prefs={prefs}
          onPrefsChange={setPrefs}
          onActivate={(uri) => { onActivate(uri); }}
          onCloseActiveEntry={onCloseActiveEntry}
          recent={mru ?? undefined}
        />
      </div>
    </div>
  );
}
