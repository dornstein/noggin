// Desktop app-level E2E smoke (tier 4 · end-to-end).
//
// Launches the real Electron app and asserts the guarantees the
// contract test can't see: the preload surface, the renderer keyboard
// accelerators, and the app actions relocated to the sidebar kebab.
// Requires a prior `npm run build` (loads the packaged renderer bundle).

import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..', '..');

let app: ElectronApplication;
let win: Page;

test.beforeAll(async () => {
  app = await electron.launch({ args: [APP_ROOT] });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
});

test('preload exposes the two rpc bridges and no legacy shell', async () => {
  const bridges = await win.evaluate(() => ({
    shell: typeof (window as Record<string, unknown>).shell,
    nogginRpcIpc: typeof (window as Record<string, unknown>).nogginRpcIpc,
    hostServicesRpc: typeof (window as Record<string, unknown>).hostServicesRpc,
  }));
  expect(bridges.shell).toBe('undefined');
  expect(bridges.nogginRpcIpc).toBe('object');
  expect(bridges.hostServicesRpc).toBe('object');
});

test('Ctrl+B toggles the sidebar (renderer accelerator)', async () => {
  const sidebar = win.locator('.sidebar-host');
  await expect(sidebar).toHaveCount(1);
  await win.keyboard.press('Control+b');
  await expect(sidebar).toHaveCount(0);
  await win.keyboard.press('Control+b');
  await expect(sidebar).toHaveCount(1);
});

test('the sidebar kebab surfaces the relocated app actions', async () => {
  await win.locator('button[aria-label="View options"]').click();
  const menu = win.locator('[role="menu"]');
  await expect(menu).toContainText('Details pane');
  await expect(menu).toContainText('Installed providers');
  await expect(menu).toContainText('About noggin');
  await win.keyboard.press('Escape');
});
