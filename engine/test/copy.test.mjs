// CLI golden tests — `copy`.
//
// v1 contract: `noggin copy <from> <to>` appends every item from the source
// noggin into the destination noggin (append-only, whole-noggin). Source
// roots become new roots in dest. Keys are regenerated; notes, done state,
// and createdAt timestamps are preserved verbatim. Source is not modified.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runCli, makeTempNoggin, summarize } from './helpers.mjs';

const SEED_A = `schemaVersion: 1
active: null
items:
  - key: a-1
    parentKey: null
    title: alpha
    done: false
    createdAt: '2026-01-01T00:00:00.000Z'
    notes:
      - timestamp: '2026-01-02T00:00:00.000Z'
        text: note on alpha
  - key: a-2
    parentKey: a-1
    title: alpha-child
    done: true
    createdAt: '2026-01-03T00:00:00.000Z'
    notes:
      - timestamp: '2026-01-04T00:00:00.000Z'
        text: closed
  - key: a-3
    parentKey: null
    title: beta
    done: false
    createdAt: '2026-01-05T00:00:00.000Z'
    notes: []
`;

describe('copy', () => {
  test('whole-noggin copy: dest gets every item with fresh keys', () => {
    const src = makeTempNoggin(SEED_A);
    const dst = makeTempNoggin('schemaVersion: 1\nactive: null\nitems: []\n');
    try {
      const r = runCli(['copy', src.file, dst.file, '--json'], { file: null });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.status, 'ok');
      assert.equal(r.json.data.copied, 3);
      const dstDoc = dst.read();
      assert.equal(dstDoc.items.length, 3);

      // Tree shape preserved: alpha has a child, beta is a sibling.
      const dstShape = summarize(dstDoc).roots;
      const titles = dstShape.map((n) => n.title);
      assert.deepEqual(titles, ['alpha', 'beta']);
      assert.equal(dstShape[0].children.length, 1);
      assert.equal(dstShape[0].children[0].title, 'alpha-child');

      // Keys regenerated (not the source keys).
      for (const item of dstDoc.items) {
        assert.notEqual(item.key, 'a-1');
        assert.notEqual(item.key, 'a-2');
        assert.notEqual(item.key, 'a-3');
      }
    } finally { src.cleanup(); dst.cleanup(); }
  });

  test('notes, done state, and createdAt preserved verbatim', () => {
    const src = makeTempNoggin(SEED_A);
    const dst = makeTempNoggin('schemaVersion: 1\nactive: null\nitems: []\n');
    try {
      runCli(['copy', src.file, dst.file], { file: null });
      const doc = dst.read();
      const alpha = doc.items.find((i) => i.title === 'alpha');
      const alphaChild = doc.items.find((i) => i.title === 'alpha-child');
      assert.equal(alpha.done, false);
      assert.equal(alpha.createdAt, '2026-01-01T00:00:00.000Z');
      assert.deepEqual(alpha.notes, [{ timestamp: '2026-01-02T00:00:00.000Z', text: 'note on alpha' }]);
      assert.equal(alphaChild.done, true);
      assert.equal(alphaChild.createdAt, '2026-01-03T00:00:00.000Z');
      assert.deepEqual(alphaChild.notes, [{ timestamp: '2026-01-04T00:00:00.000Z', text: 'closed' }]);
    } finally { src.cleanup(); dst.cleanup(); }
  });

  test('source is unchanged after copy', () => {
    const src = makeTempNoggin(SEED_A);
    const dst = makeTempNoggin('schemaVersion: 1\nactive: null\nitems: []\n');
    const before = src.readText();
    try {
      runCli(['copy', src.file, dst.file], { file: null });
      assert.equal(src.readText(), before);
    } finally { src.cleanup(); dst.cleanup(); }
  });

  test('append-only: existing dest items are kept and copied items appended after', () => {
    const src = makeTempNoggin(SEED_A);
    const dst = makeTempNoggin(`schemaVersion: 1
active: null
items:
  - key: d-1
    parentKey: null
    title: pre-existing
    done: false
    createdAt: '2026-02-01T00:00:00.000Z'
    notes: []
`);
    try {
      runCli(['copy', src.file, dst.file], { file: null });
      const doc = dst.read();
      const rootTitles = doc.items.filter((i) => i.parentKey === null).map((i) => i.title);
      assert.deepEqual(rootTitles, ['pre-existing', 'alpha', 'beta']);
    } finally { src.cleanup(); dst.cleanup(); }
  });

  test('empty source: copies 0 items, dest unchanged', () => {
    const src = makeTempNoggin('schemaVersion: 1\nactive: null\nitems: []\n');
    const dst = makeTempNoggin(`schemaVersion: 1
active: null
items:
  - key: d-1
    parentKey: null
    title: keep me
    done: false
    createdAt: '2026-02-01T00:00:00.000Z'
    notes: []
`);
    const dstBefore = dst.readText();
    try {
      const r = runCli(['copy', src.file, dst.file, '--json'], { file: null });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.data.copied, 0);
      assert.equal(dst.readText(), dstBefore);
    } finally { src.cleanup(); dst.cleanup(); }
  });

  test('same-noggin copy: items duplicate at the root with fresh keys', () => {
    const n = makeTempNoggin(SEED_A);
    try {
      const r = runCli(['copy', n.file, n.file, '--json'], { file: null });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.json.data.copied, 3);
      const doc = n.read();
      // Original 3 + 3 copies = 6 items total.
      assert.equal(doc.items.length, 6);
      const rootTitles = doc.items.filter((i) => i.parentKey === null).map((i) => i.title);
      assert.deepEqual(rootTitles, ['alpha', 'beta', 'alpha', 'beta']);
    } finally { n.cleanup(); }
  });

  test('dest active pointer is not changed by copy', () => {
    const src = makeTempNoggin(SEED_A);
    const dst = makeTempNoggin(`schemaVersion: 1
active: d-1
items:
  - key: d-1
    parentKey: null
    title: keep me active
    done: false
    createdAt: '2026-02-01T00:00:00.000Z'
    notes: []
`);
    try {
      runCli(['copy', src.file, dst.file], { file: null });
      const doc = dst.read();
      assert.equal(doc.active, 'd-1');
    } finally { src.cleanup(); dst.cleanup(); }
  });

  test('missing positional: exits with usage error', () => {
    const src = makeTempNoggin(SEED_A);
    try {
      const r = runCli(['copy', src.file, '--json'], { file: null });
      assert.equal(r.code, 2);
      const env = JSON.parse(r.stderr);
      assert.equal(env.status, 'error');
      assert.match(env.error.message, /usage/);
    } finally { src.cleanup(); }
  });
});
