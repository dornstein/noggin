// Tier 4 E2E: the docs site's in-browser playground. Exercises the
// full app — CLI input drives the same noggin the Tree tab reads,
// localStorage persistence, tab switching. The regression that
// motivated the test suite: "add items via CLI while Tree tab is
// hidden, switch tabs, tree was empty." See:
//   docs/site/pages/contributors/testing.md
//
// Each test starts by wiping the playground's localStorage entry so
// runs are deterministic.

import { test, expect } from '@playwright/test';

const STORAGE_KEY = 'noggin:playground';

test.beforeEach(async ({ page }) => {
  await page.goto('/playground/');
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  await page.reload();
  // Wait for the CLI input to render so the bundle is live.
  await page.waitForSelector('#cli-input');
});

async function runCli(page: import('@playwright/test').Page, line: string) {
  await page.fill('#cli-input', line);
  await page.press('#cli-input', 'Enter');
}

async function switchToTab(page: import('@playwright/test').Page, label: 'CLI' | 'Tree') {
  await page.locator('.pg-tab').filter({ hasText: label }).click();
}

test('cross-tab sync: CLI adds appear in the Tree tab when switched', async ({ page }) => {
  // Add items while the Tree tab is hidden. This is the exact
  // sequence that caused the playground bug — issue link:
  // https://github.com/dornstein/noggin/issues
  await runCli(page, 'push "alpha"');
  await runCli(page, 'push "beta"');
  await runCli(page, 'add "gamma"');

  // Storage badge updates live even before switching tabs.
  await expect(page.getByText(/3 items/)).toBeVisible();

  // Switch to the Tree tab — every row must render.
  await switchToTab(page, 'Tree');
  const rows = page.getByRole('treeitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('alpha');
  await expect(rows.nth(1)).toContainText('beta');
  await expect(rows.nth(2)).toContainText('gamma');
});

test('cross-tab sync: Tree edits appear in the CLI tab', async ({ page }) => {
  // Seed the noggin via the CLI first so the tree has rows to edit.
  await runCli(page, 'push "root"');
  await switchToTab(page, 'Tree');

  // Toggle done on the first row via its "Mark done" button.
  const row = page.getByRole('treeitem').first();
  await row.getByRole('button', { name: 'Mark done' }).click();

  // Back to the CLI tab — `show /1` must report the now-closed
  // root. (`done` clears active when the closed item has no parent,
  // so a bare `show` would error out; we ask for `/1` explicitly to
  // verify cross-tab state sync independent of active-pointer
  // semantics.)
  await switchToTab(page, 'CLI');
  await runCli(page, 'show /1');
  await expect(page.locator('.cli-out').last()).toContainText('root');
});

test('persistence: localStorage round-trips across reload', async ({ page }) => {
  await runCli(page, 'push "persistent"');
  await page.reload();
  await page.waitForSelector('#cli-input');
  // Storage badge confirms data survived without a fresh run.
  await expect(page.getByText(/1 item/)).toBeVisible();
  await switchToTab(page, 'Tree');
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await expect(page.getByRole('treeitem').first()).toContainText('persistent');
});

test('cross-window sync: edits in one tab propagate live to another', async ({ context, page }) => {
  // Two pages in the same BrowserContext share localStorage. Real
  // users see the same thing across two tabs of the docs site. The
  // regression that motivated this test: LocalStorageNoggin did not
  // listen for the DOM `storage` event, so the second tab stayed
  // stale until reload. See docs/site/playground/localStorageNoggin.mjs.
  const pageA = page;
  const pageB = await context.newPage();
  await pageB.goto('/playground/');
  await pageB.waitForSelector('#cli-input');

  // Sanity: both tabs start empty.
  await expect(pageA.getByText('empty')).toBeVisible();
  await expect(pageB.getByText('empty')).toBeVisible();

  // Add an item in A. The badge in B must update without a reload.
  await runCli(pageA, 'push "from-a"');
  await expect(pageA.getByText(/1 item/)).toBeVisible();
  await expect(pageB.getByText(/1 item/)).toBeVisible();

  // Edits made in B's Tree view must show up in A.
  await switchToTab(pageB, 'Tree');
  await expect(pageB.getByRole('treeitem')).toHaveCount(1);
  await pageB.getByRole('treeitem').first().getByRole('button', { name: 'Mark done' }).click();
  await expect(pageB.getByText(/1 done/)).toBeVisible();
  await expect(pageA.getByText(/1 done/)).toBeVisible();

  // And the live tree in A (if we switch to it) reflects B's change.
  await switchToTab(pageA, 'Tree');
  const rowA = pageA.getByRole('treeitem').first();
  await expect(rowA).toContainText('from-a');
  // Once closed, the toggle button advertises 'Reopen'.
  await expect(rowA.getByRole('button', { name: 'Reopen' })).toBeVisible();

  await pageB.close();
});
