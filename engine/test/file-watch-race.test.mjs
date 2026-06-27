// fs.watch rapid-write race: two external writes inside the file
// provider's 50ms debounce window. The final state must match the
// last write; intermediate stale values must not leak into accessors.
//
// The risk: `_scheduleReload` clears + restarts a setTimeout(50ms)
// on every fs.watch event. If two writes happen within 50ms, the
// second cancels the first's timer, so only one reload fires —
// against the final on-disk bytes. Good. But if writes happen at
// t=0ms and t=60ms (just outside the debounce), TWO reloads fire,
// each against on-disk bytes at the time of the respective timer
// settle. Both must produce a final state equal to the last write.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { openNoggin, SCHEMA_VERSION } from '../noggin-api.mjs';
import '../providers/file.mjs';

import { waitFor } from './provider-fixtures.mjs';

function makeDoc(title) {
  return {
    schemaVersion: SCHEMA_VERSION,
    active: null,
    items: [{
      key: 'i-20260101-000000-aaaaaa',
      parentKey: null,
      title,
      done: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      notes: [],
    }],
  };
}

describe('file:// fs.watch rapid-write race', () => {
  it('two writes inside the debounce window converge to the last value', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'noggin-watch-race-'));
    const file = path.join(dir, '.noggin.yaml');
    try {
      const n = await openNoggin(`file://${file}`, { watch: true });
      // Burn an initial state so the diff actually produces changes.
      writeFileSync(file, yaml.dump(makeDoc('first'), { noRefs: true }), 'utf8');
      await waitFor(() => n.items.length === 1 && n.items[0].title === 'first', {
        label: 'initial state loads', timeoutMs: 2000,
      });

      // Three rapid writes. All happen well inside the 50ms debounce,
      // so only one reload should fire — against the FINAL bytes.
      writeFileSync(file, yaml.dump(makeDoc('second'), { noRefs: true }), 'utf8');
      writeFileSync(file, yaml.dump(makeDoc('third'), { noRefs: true }), 'utf8');
      writeFileSync(file, yaml.dump(makeDoc('fourth'), { noRefs: true }), 'utf8');

      // The handle must eventually see the LAST value, never an
      // intermediate one.
      await waitFor(() => n.items[0]?.title === 'fourth', {
        label: 'handle reflects the last write', timeoutMs: 2000,
      });
      assert.equal(n.items.length, 1);
      assert.equal(n.items[0].title, 'fourth');

      await n.dispose();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('two writes straddling the debounce window also converge to the last value', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'noggin-watch-race-'));
    const file = path.join(dir, '.noggin.yaml');
    try {
      const n = await openNoggin(`file://${file}`, { watch: true });
      writeFileSync(file, yaml.dump(makeDoc('first'), { noRefs: true }), 'utf8');
      await waitFor(() => n.items[0]?.title === 'first', { label: 'initial load', timeoutMs: 2000 });

      // First write, wait long enough for the debounce to fire AND
      // the reload to land, then second write.
      writeFileSync(file, yaml.dump(makeDoc('second'), { noRefs: true }), 'utf8');
      await waitFor(() => n.items[0]?.title === 'second', { label: 'first reload', timeoutMs: 2000 });

      writeFileSync(file, yaml.dump(makeDoc('third'), { noRefs: true }), 'utf8');
      await waitFor(() => n.items[0]?.title === 'third', { label: 'second reload', timeoutMs: 2000 });

      assert.equal(n.items[0].title, 'third');
      await n.dispose();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a write that produces identical bytes does not fire onDidChange', async () => {
    // `_maybeReload` early-returns when `documentsEqual(before, next)`.
    // This protects subscribers from spurious wakeups when an external
    // tool rewrites the file without changing it (e.g., a formatter).
    const dir = mkdtempSync(path.join(tmpdir(), 'noggin-watch-race-'));
    const file = path.join(dir, '.noggin.yaml');
    try {
      const initial = yaml.dump(makeDoc('stable'), { noRefs: true });
      writeFileSync(file, initial, 'utf8');
      const n = await openNoggin(`file://${file}`, { watch: true });

      const events = [];
      const sub = n.onDidChange((e) => events.push(e));

      // Rewrite the file with IDENTICAL bytes. fs.watch may fire, but
      // _maybeReload sees no document change and suppresses the event.
      writeFileSync(file, initial, 'utf8');
      // Wait through the full debounce window plus slack.
      await new Promise((r) => setTimeout(r, 250));
      assert.equal(events.length, 0, 'no onDidChange for byte-identical rewrite');

      sub.dispose();
      await n.dispose();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
