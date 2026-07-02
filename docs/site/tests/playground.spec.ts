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
  await expect(page.locator('#pg-storage-info')).toContainText(/3 items/);

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
  await expect(page.locator('#pg-storage-info')).toContainText(/1 item/);
  await switchToTab(page, 'Tree');
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await expect(page.getByRole('treeitem').first()).toContainText('persistent');
});

test('cross-window sync: edits in one tab propagate live to another', async ({ context, page }) => {
  // Two pages in the same BrowserContext share localStorage. Real
  // users see the same thing across two tabs of the docs site. The
  // regression that motivated this test: LocalStorageNoggin did not
  // listen for the DOM `storage` event, so the second tab stayed
  // stale until reload. See engine/providers/localstorage.mjs.
  const pageA = page;
  const pageB = await context.newPage();
  await pageB.goto('/playground/');
  await pageB.waitForSelector('#cli-input');

  // Sanity: both tabs start empty.
  await expect(pageA.locator('#pg-storage-info')).toHaveText('empty');
  await expect(pageB.locator('#pg-storage-info')).toHaveText('empty');

  // Add an item in A. The badge in B must update without a reload.
  await runCli(pageA, 'push "from-a"');
  await expect(pageA.locator('#pg-storage-info')).toContainText(/1 item/);
  await expect(pageB.locator('#pg-storage-info')).toContainText(/1 item/);

  // Edits made in B's Tree view must show up in A.
  await switchToTab(pageB, 'Tree');
  await expect(pageB.getByRole('treeitem')).toHaveCount(1);
  await pageB.getByRole('treeitem').first().getByRole('button', { name: 'Mark done' }).click();
  await expect(pageB.locator('#pg-storage-info')).toContainText(/1 done/);
  await expect(pageA.locator('#pg-storage-info')).toContainText(/1 done/);

  // And the live tree in A (if we switch to it) reflects B's change.
  await switchToTab(pageA, 'Tree');
  const rowA = pageA.getByRole('treeitem').first();
  await expect(rowA).toContainText('from-a');
  // Once closed, the toggle button advertises 'Reopen'.
  await expect(rowA.getByRole('button', { name: 'Reopen' })).toBeVisible();

  await pageB.close();
});

test('list rail: + menu creates a new noggin and retargets both tabs', async ({ page }) => {
  // Also wipe any extra slot we'd create so the test is hermetic.
  await page.evaluate(() => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('noggin:'))
      .forEach((k) => localStorage.removeItem(k));
  });
  await page.reload();
  await page.waitForSelector('#cli-input');

  // Open the `+` menu in the list rail.
  await page.getByRole('button', { name: 'Add a noggin' }).click();
  await page.getByRole('menuitem', { name: /New scratch noggin/ }).click();

  // The in-page modal appears (we explicitly do not use
  // window.prompt here because it's blocked in some sandboxed
  // contexts like VS Code's embedded browser).
  const input = page.locator('.pg-slug-input');
  await expect(input).toBeFocused();
  await input.fill('groceries');
  await page.getByRole('button', { name: 'Create' }).click();

  // The new entry is selected, the CLI prompt retargets, and the
  // toolbar's URI chip updates.
  await expect(page.locator('#cli-prompt')).toHaveText('$ noggin (groceries)');
  await expect(page.locator('#pg-current-uri')).toHaveText('localstorage://groceries');

  // A verb against the CLI lands in the new noggin only.
  await runCli(page, 'push "milk"');
  await expect(page.locator('#pg-storage-info')).toContainText(/1 item/);

  // The new row appears in the list.
  const rows = page.getByRole('option');
  await expect(rows.filter({ hasText: 'groceries' })).toHaveCount(1);
});

test('mru: a noggin is recorded as used on activity, surfaces in the Recent submenu, survives removal', async ({ page }) => {
  // Hermetic: wipe every noggin: key before starting.
  await page.evaluate(() => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('noggin:'))
      .forEach((k) => localStorage.removeItem(k));
  });
  await page.reload();
  await page.waitForSelector('#cli-input');

  // Create two noggins and run a verb in each so both get MRU
  // touches.
  const newScratch = async (name: string) => {
    await page.getByRole('button', { name: 'Add a noggin' }).click();
    await page.getByRole('menuitem', { name: /New scratch noggin/ }).click();
    await page.locator('.pg-slug-input').fill(name);
    await page.getByRole('button', { name: 'Create' }).click();
  };

  // The seed already created `localstorage://playground`; create
  // two more and use them.
  await newScratch('alpha');
  await runCli(page, 'push "a-item"');

  await newScratch('beta');
  await runCli(page, 'push "b-item"');

  // Persisted MRU map should now have both URIs.
  const stored = await page.evaluate(() => localStorage.getItem('noggin:playground:mru:v1'));
  expect(stored).toBeTruthy();
  const parsed = JSON.parse(stored as string);
  expect(parsed['localstorage://alpha']).toBeTruthy();
  expect(parsed['localstorage://beta']).toBeTruthy();
  // ISO UTC: must end in 'Z'.
  expect(parsed['localstorage://beta']).toMatch(/Z$/);

  // Open the + menu → Recent submenu surfaces beta (most recent)
  // first, then alpha. The seeded `playground` slot has no
  // activity and should not appear.
  await page.getByRole('button', { name: 'Add a noggin' }).click();
  // The "Recent" submenu trigger is rendered as a regular menu
  // item by Radix; its accessible name composes the inner "Recent"
  // label with the "N noggins" hint.
  const recentTrigger = page.getByRole('menuitem').filter({ hasText: /Recent/ }).first();
  await expect(recentTrigger).toBeVisible();
  await recentTrigger.hover();
  // Wait for the submenu to actually render.
  const alphaItem = page.getByRole('menuitem', { name: /alpha/ });
  const betaItem = page.getByRole('menuitem', { name: /beta/ });
  await expect(betaItem).toBeVisible();
  await expect(alphaItem).toBeVisible();

  // Close menus.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Remove `alpha` from the list. The MRU should NOT auto-forget
  // — the submenu should still offer it so the user can re-open.
  const alphaRow = page.getByRole('option').filter({ hasText: 'alpha' });
  await alphaRow.hover();
  await alphaRow.getByRole('button', { name: 'Remove from list' }).click();
  await expect(page.getByRole('option').filter({ hasText: 'alpha' })).toHaveCount(0);

  // The MRU still knows about alpha.
  const stillStored = await page.evaluate(() => localStorage.getItem('noggin:playground:mru:v1'));
  const stillParsed = JSON.parse(stillStored as string);
  expect(stillParsed['localstorage://alpha']).toBeTruthy();

  // And the Recent submenu still surfaces it.
  await page.getByRole('button', { name: 'Add a noggin' }).click();
  const recentTrigger2 = page.getByRole('menuitem').filter({ hasText: /Recent/ }).first();
  await recentTrigger2.hover();
  await expect(page.getByRole('menuitem', { name: /alpha/ })).toBeVisible();
});
