// mruManager — unit tests.

import { describe, it, expect } from 'vitest';
import { createMRUManager } from '../mruManager';

const ISO = (s: string) => s; // tiny helper to make the literals read as ISO

describe('createMRUManager — basic behaviour', () => {
  it('starts empty by default', () => {
    const mru = createMRUManager();
    expect(mru.entries()).toEqual([]);
    expect(mru.recent(5)).toEqual([]);
    expect(mru.lastUsedAt('memory://x')).toBeNull();
  });

  it('seeds from initial entries (canonicalised to UTC Z)', () => {
    const mru = createMRUManager({
      initial: {
        'memory://a': ISO('2026-01-01T00:00:00.000Z'),
        'memory://b': ISO('2026-02-02T00:00:00.000Z'),
      },
    });
    expect(mru.entries()).toEqual(['memory://b', 'memory://a']);
    expect(mru.lastUsedAt('memory://b')).toBe('2026-02-02T00:00:00.000Z');
  });

  it('drops malformed initial entries', () => {
    const mru = createMRUManager({
      initial: {
        'memory://a': 'not a date',
        '': '2026-01-01T00:00:00.000Z',
        'memory://b': 123,
        'memory://c': ISO('2026-03-03T00:00:00.000Z'),
      } as unknown as Record<string, string>,
    });
    expect(mru.entries()).toEqual(['memory://c']);
  });

  it('normalises non-UTC ISO inputs into Z form', () => {
    // Date.parse accepts these; they should re-emit as Z.
    const mru = createMRUManager({
      initial: {
        'memory://offset': '2026-01-01T05:00:00.000+05:00', // == 00:00:00Z
      },
    });
    expect(mru.lastUsedAt('memory://offset')).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('createMRUManager — touch', () => {
  it('records and orders MRU-first', () => {
    const mru = createMRUManager();
    mru.touch('memory://a', new Date('2026-01-01T00:00:00.000Z'));
    mru.touch('memory://b', new Date('2026-02-02T00:00:00.000Z'));
    mru.touch('memory://c', new Date('2026-03-03T00:00:00.000Z'));
    expect(mru.entries()).toEqual(['memory://c', 'memory://b', 'memory://a']);
  });

  it('re-touching moves a URI to the front', () => {
    const mru = createMRUManager();
    mru.touch('memory://a', new Date('2026-01-01T00:00:00.000Z'));
    mru.touch('memory://b', new Date('2026-02-02T00:00:00.000Z'));
    mru.touch('memory://a', new Date('2026-03-03T00:00:00.000Z'));
    expect(mru.entries()).toEqual(['memory://a', 'memory://b']);
  });

  it('stores timestamps as UTC ISO (Z form)', () => {
    const mru = createMRUManager();
    mru.touch('memory://x', new Date('2026-06-30T12:34:56.789Z'));
    expect(mru.lastUsedAt('memory://x')).toBe('2026-06-30T12:34:56.789Z');
    expect(mru.lastUsedAt('memory://x')?.endsWith('Z')).toBe(true);
  });

  it('uses now() when no `at` is passed', () => {
    const before = Date.now();
    const mru = createMRUManager();
    mru.touch('memory://x');
    const stored = mru.lastUsedAt('memory://x');
    expect(stored).not.toBeNull();
    const ms = new Date(stored as string).getTime();
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(Date.now() + 1);
  });

  it('uses the injected now() clock (determinism seam) when no `at` is passed', () => {
    let t = 0;
    const mru = createMRUManager({ now: () => new Date(1_600_000_000_000 + (t++) * 1000) });
    mru.touch('memory://a');
    mru.touch('memory://b');
    expect(mru.lastUsedAt('memory://a')).toBe(new Date(1_600_000_000_000).toISOString());
    expect(mru.lastUsedAt('memory://b')).toBe(new Date(1_600_000_001_000).toISOString());
    expect(mru.entries()).toEqual(['memory://b', 'memory://a']);
  });

  it('skips duplicate same-iso writes (no event spam)', () => {
    const mru = createMRUManager();
    let fires = 0;
    mru.onDidChange(() => { fires += 1; });
    const at = new Date('2026-01-01T00:00:00.000Z');
    mru.touch('memory://x', at);
    mru.touch('memory://x', at);
    expect(fires).toBe(1);
  });
});

describe('createMRUManager — eviction', () => {
  it('default cap is 10', () => {
    const mru = createMRUManager();
    for (let i = 0; i < 12; i++) {
      mru.touch(`memory://${i}`, new Date(2026, 0, 1 + i));
    }
    expect(mru.entries()).toHaveLength(10);
    // Newest 10 retained, oldest 2 evicted
    expect(mru.entries()[0]).toBe('memory://11');
    expect(mru.entries()[9]).toBe('memory://2');
    expect(mru.lastUsedAt('memory://0')).toBeNull();
    expect(mru.lastUsedAt('memory://1')).toBeNull();
  });

  it('respects maxEntries override', () => {
    const mru = createMRUManager({ maxEntries: 3 });
    mru.touch('memory://a', new Date('2026-01-01T00:00:00.000Z'));
    mru.touch('memory://b', new Date('2026-02-02T00:00:00.000Z'));
    mru.touch('memory://c', new Date('2026-03-03T00:00:00.000Z'));
    mru.touch('memory://d', new Date('2026-04-04T00:00:00.000Z'));
    expect(mru.entries()).toEqual(['memory://d', 'memory://c', 'memory://b']);
  });

  it('Infinity / 0 disables eviction', () => {
    const mruInf = createMRUManager({ maxEntries: Infinity });
    const mruZero = createMRUManager({ maxEntries: 0 });
    for (let i = 0; i < 50; i++) {
      const at = new Date(2026, 0, 1 + i);
      mruInf.touch(`memory://${i}`, at);
      mruZero.touch(`memory://${i}`, at);
    }
    expect(mruInf.entries()).toHaveLength(50);
    expect(mruZero.entries()).toHaveLength(50);
  });

  it('enforces the cap against `initial` too', () => {
    const initial: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      initial[`memory://${i}`] = new Date(2026, 0, 1 + i).toISOString();
    }
    const mru = createMRUManager({ initial, maxEntries: 5 });
    expect(mru.entries()).toHaveLength(5);
    // Most-recent five only
    expect(mru.entries()[0]).toBe('memory://19');
    expect(mru.entries()[4]).toBe('memory://15');
  });
});

describe('createMRUManager — forget + clear', () => {
  it('forget() drops a single URI', () => {
    const mru = createMRUManager();
    mru.touch('memory://a', new Date('2026-01-01T00:00:00.000Z'));
    mru.touch('memory://b', new Date('2026-02-02T00:00:00.000Z'));
    mru.forget('memory://a');
    expect(mru.entries()).toEqual(['memory://b']);
    expect(mru.lastUsedAt('memory://a')).toBeNull();
  });

  it('forget() is a no-op for unknown URIs (no event)', () => {
    const mru = createMRUManager();
    let fires = 0;
    mru.onDidChange(() => { fires += 1; });
    mru.forget('memory://unknown');
    expect(fires).toBe(0);
  });

  it('clear() empties the log + fires once', () => {
    const mru = createMRUManager();
    mru.touch('memory://a', new Date('2026-01-01T00:00:00.000Z'));
    mru.touch('memory://b', new Date('2026-02-02T00:00:00.000Z'));
    let fires = 0;
    mru.onDidChange(() => { fires += 1; });
    mru.clear();
    expect(mru.entries()).toEqual([]);
    expect(fires).toBe(1);
  });

  it('clear() on an empty manager is a silent no-op', () => {
    const mru = createMRUManager();
    let fires = 0;
    mru.onDidChange(() => { fires += 1; });
    mru.clear();
    expect(fires).toBe(0);
  });
});

describe('createMRUManager — persistence callback', () => {
  it('fires onStateChange after touch + forget + clear (not for read)', () => {
    const fires: Array<Record<string, string>> = [];
    const mru = createMRUManager({
      onStateChange: ({ entries }) => fires.push({ ...entries }),
    });
    mru.touch('memory://a', new Date('2026-01-01T00:00:00.000Z'));
    mru.touch('memory://b', new Date('2026-02-02T00:00:00.000Z'));
    mru.forget('memory://a');
    mru.entries();     // read-only — no fire
    mru.clear();
    expect(fires.length).toBe(4);
    expect(fires[fires.length - 1]).toEqual({});
  });

  it('absorbs onStateChange throws (warns + continues)', () => {
    const mru = createMRUManager({
      onStateChange: () => { throw new Error('persist failed'); },
    });
    expect(() => mru.touch('memory://a')).not.toThrow();
    expect(mru.lastUsedAt('memory://a')).not.toBeNull();
  });
});

describe('createMRUManager — recent()', () => {
  it('returns the top N entries', () => {
    const mru = createMRUManager();
    for (let i = 0; i < 5; i++) {
      mru.touch(`memory://${i}`, new Date(2026, 0, 1 + i));
    }
    expect(mru.recent(3)).toEqual(['memory://4', 'memory://3', 'memory://2']);
  });

  it('caps at the log size', () => {
    const mru = createMRUManager();
    mru.touch('memory://only', new Date('2026-01-01T00:00:00.000Z'));
    expect(mru.recent(100)).toEqual(['memory://only']);
  });

  it('omitted / Infinity / negative limit returns everything', () => {
    const mru = createMRUManager();
    for (let i = 0; i < 4; i++) mru.touch(`memory://${i}`, new Date(2026, 0, 1 + i));
    expect(mru.recent()).toHaveLength(4);
    expect(mru.recent(Infinity)).toHaveLength(4);
    expect(mru.recent(-1)).toHaveLength(4);
  });
});
