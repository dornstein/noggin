// file:// URL → filesystem path resolution.
//
// Regression tests for the WHATWG-style file URL handling in the
// file provider. On Windows, `openNoggin('file:///C:/x.yaml')` used
// to route `/C:/x.yaml` through `path.resolve` — which garbles it to
// `C:\C:\x.yaml`, then `loadDocument` silently treats the missing
// file as an empty noggin. The desktop app manifested this as
// "clicking a noggin never refreshes the tree"; every open produced
// a phantom empty noggin instead of loading the real content.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import url from 'node:url';

import { openNoggin } from '../noggin-api.mjs';
import '../providers/file.mjs';

const YAML_WITH_ONE_ITEM = [
  'schemaVersion: 1',
  'active: null',
  'items:',
  '  - key: i-test-01',
  '    parentKey: null',
  '    title: ping',
  '    done: false',
  '    notes: []',
  '',
].join('\n');

describe('file provider: file:// URL → path resolution', () => {
  it('reads content from a WHATWG-style file URL (pathToFileURL round-trip)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'noggin-fileurl-'));
    const filePath = path.join(dir, '.noggin.yaml');
    writeFileSync(filePath, YAML_WITH_ONE_ITEM, 'utf8');
    // `pathToFileURL` produces the canonical WHATWG URL — with the
    // leading `/` before the Windows drive letter that used to garble
    // `path.resolve`.
    const fileUri = url.pathToFileURL(filePath).href;

    const n = await openNoggin(fileUri);
    try {
      assert.equal(n.items.length, 1);
      assert.equal(n.items[0].title, 'ping');
    } finally {
      await n.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still handles bare paths via openFileNoggin (no URL)', async () => {
    const { openFileNoggin } = await import('../providers/file.mjs');
    const dir = mkdtempSync(path.join(tmpdir(), 'noggin-fileurl-'));
    const filePath = path.join(dir, '.noggin.yaml');
    writeFileSync(filePath, YAML_WITH_ONE_ITEM, 'utf8');

    const n = await openFileNoggin(filePath);
    try {
      assert.equal(n.items.length, 1);
      assert.equal(n.items[0].title, 'ping');
    } finally {
      await n.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
