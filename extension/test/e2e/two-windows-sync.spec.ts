// End-to-end: two VS Code Extension Development Hosts on a single
// .noggin.yaml stay in sync via the file provider's fs.watch and
// the noggin-rpc `noggin.changed` notification stream.
//
// Regression for two bugs landed in quick succession:
//   1. createNogginRpcServer didn't default `watch: true`, so the
//      RPC server-adapter never started fs.watch and cross-process
//      mutations were invisible to the webview.
//   2. (Earlier) localStorageNoggin missed the DOM `storage` event;
//      that bug is covered separately by docs/site Playwright.
//
// Also covers the simpler "external file write reaches the webview"
// case which catches any regression to the fs.watch wiring itself.

import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchNogginHost, seedNogginFile, type NogginHost } from './helpers/vscode-host';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_PATH = path.resolve(__dirname, '..', '..');

const ONE_ITEM_DOC = {
  active: null,
  items: [
    { key: 'i-20260101-000000-aaaaaa', parentKey: null, title: 'first', done: false },
  ],
};

const TWO_ITEMS_DOC = {
  active: null,
  items: [
    { key: 'i-20260101-000000-aaaaaa', parentKey: null, title: 'first', done: false },
    { key: 'i-20260101-000000-bbbbbb', parentKey: null, title: 'second', done: false },
  ],
};

test.describe('extension webview ↔ file sync', () => {
  let workspaceFolder: string;
  let nogginFile: string;
  let host: NogginHost | null = null;

  test.beforeEach(() => {
    workspaceFolder = mkdtempSync(path.join(tmpdir(), 'noggin-e2e-ws-'));
    nogginFile = path.join(workspaceFolder, '.noggin.yaml');
  });

  test.afterEach(async () => {
    if (host) { await host.close(); host = null; }
    try { rmSync(workspaceFolder, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('external file write reaches the webview tree', async () => {
    seedNogginFile(nogginFile, ONE_ITEM_DOC);
    host = await launchNogginHost({ extensionPath: EXTENSION_PATH, workspaceFolder });

    // Initial state: one row.
    await expect(host.webview.getByRole('treeitem')).toHaveCount(1);
    await expect(host.webview.getByRole('treeitem').first()).toContainText('first');

    // Write the file from outside the extension. This is exactly what
    // a second app instance / the CLI / a manual editor does.
    seedNogginFile(nogginFile, TWO_ITEMS_DOC);

    // The webview must reflect the new item without a manual reload.
    await expect(host.webview.getByRole('treeitem')).toHaveCount(2, { timeout: 5_000 });
    await expect(host.webview.getByRole('treeitem').nth(1)).toContainText('second');
  });

  test('mutating done state via external write toggles the webview button', async () => {
    seedNogginFile(nogginFile, ONE_ITEM_DOC);
    host = await launchNogginHost({ extensionPath: EXTENSION_PATH, workspaceFolder });

    // Before: open item exposes a "Mark done" button.
    const row = host.webview.getByRole('treeitem').first();
    await expect(row.getByRole('button', { name: 'Mark done' })).toBeVisible();

    // Flip the item to done externally.
    seedNogginFile(nogginFile, {
      active: null,
      items: [{ ...ONE_ITEM_DOC.items[0], done: true }],
    });

    // After: the same row now exposes "Reopen" instead.
    await expect(row.getByRole('button', { name: 'Reopen' })).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('two extension dev hosts on one file', () => {
  let workspaceFolder: string;
  let nogginFile: string;
  let host1: NogginHost | null = null;
  let host2: NogginHost | null = null;

  test.beforeEach(() => {
    workspaceFolder = mkdtempSync(path.join(tmpdir(), 'noggin-e2e-ws2-'));
    nogginFile = path.join(workspaceFolder, '.noggin.yaml');
  });

  test.afterEach(async () => {
    if (host1) { await host1.close(); host1 = null; }
    if (host2) { await host2.close(); host2 = null; }
    try { rmSync(workspaceFolder, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('a mutation through host 1 appears in host 2', async () => {
    seedNogginFile(nogginFile, ONE_ITEM_DOC);
    host1 = await launchNogginHost({ extensionPath: EXTENSION_PATH, workspaceFolder });
    host2 = await launchNogginHost({ extensionPath: EXTENSION_PATH, workspaceFolder });

    // Both should show the same single row.
    await expect(host1.webview.getByRole('treeitem')).toHaveCount(1);
    await expect(host2.webview.getByRole('treeitem')).toHaveCount(1);

    // Toggle done in host 1's webview.
    await host1.webview.getByRole('treeitem').first()
      .getByRole('button', { name: 'Mark done' }).click();

    // Host 2 must reflect the change via fs.watch + noggin.changed.
    await expect(
      host2.webview.getByRole('treeitem').first().getByRole('button', { name: 'Reopen' }),
    ).toBeVisible({ timeout: 5_000 });

    // Round-trip: reopen via host 2 → host 1 sees it.
    await host2.webview.getByRole('treeitem').first()
      .getByRole('button', { name: 'Reopen' }).click();
    await expect(
      host1.webview.getByRole('treeitem').first().getByRole('button', { name: 'Mark done' }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
