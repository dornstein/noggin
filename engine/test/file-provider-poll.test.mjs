// File provider — same-process drift polling.
//
// `fs.watch` is best-effort: it silently drops events on certain
// filesystems (network shares, some containers) and on macOS can
// take a few hundred ms to notice a rename-based atomic write. The
// file provider runs a short-interval `fs.statSync` poll as a
// safety net so drift is bounded even when the watcher is off or
// unreliable. This test exercises that path with `watch: false` so
// the poll is the ONLY thing observing the external write.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { openNoggin, SCHEMA_VERSION, verbs } from '../noggin-api.mjs';
import '../providers/file.mjs';

import { waitFor } from './provider-fixtures.mjs';

describe('file provider — drift polling', () => {
  it('picks up external writes via poll even with watch disabled', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'noggin-poll-'));
    const file = path.join(dir, '.noggin.yaml');
    try {
      // watch: false, pollIntervalMs: 10 → the only path that can
      // observe the external write is the poll.
      const n = await openNoggin(`file://${file}`, {
        watch: false,
        pollIntervalMs: 10,
      });
      await verbs.push(n, { title: 'seed' });

      const events = [];
      const sub = n.onDidChange((e) => events.push(e));

      // Write a different document to disk, bypassing apply().
      writeFileSync(file, yaml.dump({
        schemaVersion: SCHEMA_VERSION,
        active: null,
        items: [{
          key: 'i-20260101-000000-cccccc',
          parentKey: null,
          title: 'external',
          done: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          notes: [],
        }],
      }, { noRefs: true }), 'utf8');
      // Force mtime forward for filesystems with second-granularity
      // mtimes; the poll checks `mtimeMs` so this guarantees a diff.
      const t = Date.now() / 1000 + 1;
      utimesSync(file, t, t);

      await waitFor(() => events.length >= 1, { label: 'poll picked up external write' });
      assert.equal(n.items.length, 1);
      assert.equal(n.items[0].title, 'external');

      sub.dispose();
      await n.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not fire onDidChange for its own writes (mtime bookkeeping)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'noggin-poll-selfwrite-'));
    const file = path.join(dir, '.noggin.yaml');
    try {
      const n = await openNoggin(`file://${file}`, {
        watch: false,
        pollIntervalMs: 10,
      });
      const events = [];
      const sub = n.onDidChange((e) => events.push(e));
      await verbs.push(n, { title: 'a' });
      await verbs.push(n, { title: 'b' });
      await verbs.push(n, { title: 'c' });
      // Wait a few poll intervals so any spurious reload would show
      // up as an extra event. Expect exactly three (one per apply).
      await new Promise((r) => setTimeout(r, 60));
      sub.dispose();
      assert.equal(events.length, 3, 'poll must not double-fire for the provider\'s own writes');
      await n.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not poll when pollIntervalMs is 0', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'noggin-poll-off-'));
    const file = path.join(dir, '.noggin.yaml');
    try {
      const n = await openNoggin(`file://${file}`, {
        watch: false,
        pollIntervalMs: 0,
      });
      await verbs.push(n, { title: 'seed' });
      const events = [];
      const sub = n.onDidChange((e) => events.push(e));
      writeFileSync(file, yaml.dump({
        schemaVersion: SCHEMA_VERSION,
        active: null,
        items: [],
      }, { noRefs: true }), 'utf8');
      await new Promise((r) => setTimeout(r, 40));
      sub.dispose();
      assert.equal(events.length, 0, 'no watcher + no poll → no drift detection');
      assert.equal(n.items.length, 1, 'in-memory doc stays at last known value');
      await n.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
