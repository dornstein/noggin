// Sidebar kebab entry builder tests (tier 1 · logic).

import { describe, it, expect, vi } from 'vitest';
import { buildAppMenuEntries, type AppMenuHandlers } from '../src/renderer/src/appMenuEntries';
import type { TreeContextMenuEntry } from '@noggin/ui';

function handlers(): AppMenuHandlers & {
  setDetailsLocation: ReturnType<typeof vi.fn>;
  onShortcuts: ReturnType<typeof vi.fn>;
  onProviders: ReturnType<typeof vi.fn>;
  onAbout: ReturnType<typeof vi.fn>;
} {
  return {
    setDetailsLocation: vi.fn(),
    onShortcuts: vi.fn(),
    onProviders: vi.fn(),
    onAbout: vi.fn(),
  };
}

function radio(entries: readonly TreeContextMenuEntry[], key: string) {
  const e = entries.find((x) => x.key === key);
  if (!e || e.kind !== 'radio') throw new Error(`not a radio: ${key}`);
  return e;
}
function item(entries: readonly TreeContextMenuEntry[], key: string) {
  const e = entries.find((x) => x.key === key);
  if (!e || e.kind !== 'item') throw new Error(`not an item: ${key}`);
  return e;
}

describe('buildAppMenuEntries', () => {
  it('surfaces the details radios + the three app actions, in order', () => {
    const entries = buildAppMenuEntries('right', handlers());
    expect(entries.map((e) => e.key)).toEqual([
      'h-details', 'details-right', 'details-below', 'sep-app',
      'shortcuts', 'providers', 'about',
    ]);
  });

  it('reflects the current details location in the radio group', () => {
    expect(radio(buildAppMenuEntries('right', handlers()), 'details-right').groupValue).toBe('right');
    expect(radio(buildAppMenuEntries('below', handlers()), 'details-below').groupValue).toBe('below');
  });

  it('dispatches a radio selection to setDetailsLocation', () => {
    const h = handlers();
    radio(buildAppMenuEntries('right', h), 'details-below').onSelectValue('below');
    expect(h.setDetailsLocation).toHaveBeenCalledWith('below');
  });

  it('wires each item click to its handler', () => {
    const h = handlers();
    const entries = buildAppMenuEntries('right', h);
    item(entries, 'shortcuts').onClick();
    item(entries, 'providers').onClick();
    item(entries, 'about').onClick();
    expect(h.onShortcuts).toHaveBeenCalledOnce();
    expect(h.onProviders).toHaveBeenCalledOnce();
    expect(h.onAbout).toHaveBeenCalledOnce();
  });
});
