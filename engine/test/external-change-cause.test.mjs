// External-cause change events.
//
// When a noggin's underlying store is mutated outside this process
// (another VS Code window writing to the same `.noggin.yaml`, the
// CLI editing it, a peer browser tab writing localStorage), the
// in-process handle must observe and emit a change. This pins the
// behaviour today and flags inconsistencies in the event payload
// shape that option B should normalize.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { openNoggin, SCHEMA_VERSION, verbs } from '../noggin-api.mjs';
import '../providers/file.mjs';
import '../../docs/site/playground/localStorageNoggin.mjs';

import { makeBrowserStoragePair, waitFor } from './provider-fixtures.mjs';

describe('external mutation: file://', () => {
  it('writing the file from outside fires onDidChange on a watching handle', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'noggin-extchg-'));
    const file = path.join(dir, '.noggin.yaml');
    try {
      const n = await openNoggin(`file://${file}`, { watch: true });
      const events = [];
      const sub = n.onDidChange((e) => events.push(e));

      // Write a fully-formed document to disk, bypassing the provider.
      const doc = {
        schemaVersion: SCHEMA_VERSION,
        active: null,
        items: [
          {
            key: 'i-20260101-000000-aaaaaa',
            parentKey: null,
            title: 'external',
            done: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            notes: [],
          },
        ],
      };
      writeFileSync(file, yaml.dump(doc, { noRefs: true }), 'utf8');

      await waitFor(() => events.length >= 1, { label: 'change event from external write' });
      assert.equal(n.items.length, 1);
      assert.equal(n.items[0].title, 'external');

      sub.dispose();
      await n.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('today: file://\'s external change payload is wrapped in {changes, cause:"external"}', async () => {
    // This pins the CURRENT divergence between in-process and external
    // event shapes. The public ChangeEvent type is `readonly ItemChange[]`,
    // but file.mjs fires `{ changes, cause: 'external' }` on external
    // reloads. Option B should normalize to a single shape; this test
    // tells us when that happens.
    const dir = mkdtempSync(path.join(tmpdir(), 'noggin-extchg-'));
    const file = path.join(dir, '.noggin.yaml');
    try {
      const n = await openNoggin(`file://${file}`, { watch: true });
      const events = [];
      const sub = n.onDidChange((e) => events.push(e));

      writeFileSync(file, yaml.dump({
        schemaVersion: SCHEMA_VERSION,
        active: null,
        items: [{
          key: 'i-20260101-000000-bbbbbb',
          parentKey: null,
          title: 'ext',
          done: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          notes: [],
        }],
      }, { noRefs: true }), 'utf8');

      await waitFor(() => events.length >= 1, { label: 'external event' });
      const payload = events[0];
      // Pin today's wrapped shape. Update this assertion (and the file
      // provider) together when option B normalizes the contract.
      assert.equal(typeof payload, 'object');
      assert.ok('changes' in payload, 'external event wraps changes today');
      assert.equal(payload.cause, 'external');
      assert.ok(Array.isArray(payload.changes));

      sub.dispose();
      await n.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('external mutation: localstorage://', () => {
  it('cross-window write fires onDidChange on the peer', async () => {
    const { storageA, storageB } = makeBrowserStoragePair();
    // Distinct underlying instances (one per simulated window).
    const a = await openNoggin('localstorage://ext-xwin', { storage: storageA, shared: false });
    const b = await openNoggin('localstorage://ext-xwin', { storage: storageB, shared: false });

    const bEvents = [];
    const sub = b.onDidChange((e) => bEvents.push(e));

    await verbs.push(a, { title: 'cross-window' });

    assert.ok(bEvents.length >= 1, 'b fires change event for cross-window write');
    assert.equal(b.items.length, 1);

    sub.dispose();
    await a.dispose();
    await b.dispose();
  });

  it('storage events for unrelated keys do not fire onDidChange', async () => {
    const { storageA, storageB } = makeBrowserStoragePair();
    const a = await openNoggin('localstorage://ext-target-a', { storage: storageA, shared: false });

    const events = [];
    const sub = a.onDidChange((e) => events.push(e));

    // Write through B into a DIFFERENT key. The peer should ignore it.
    storageB.setItem('noggin:ext-target-b', 'irrelevant');
    storageB.setItem('unrelated-app-data', 'nope');

    assert.equal(events.length, 0, 'a only listens for its own key');

    sub.dispose();
    await a.dispose();
  });
});
