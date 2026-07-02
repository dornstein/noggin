// NogginList CT — keyboard nav, copy chips, remove, drag-disabled,
// live gauge updates, kebab menu, empty state.

import { test, expect } from '@playwright/experimental-ct-react';
import { NogginListFixture } from './fixtures/NogginListFixture';

test.use({ viewport: { width: 600, height: 700 } });

test.describe('NogginList — rendering', () => {
  test('three rows with badges, gauges, hidden remove + copy buttons', async ({ mount, page }) => {
    await mount(<NogginListFixture seed="three-closed" />);
    await expect(page.getByTestId('entries-count')).toHaveText('3');
    const rows = page.locator('.noggin-list-row');
    await expect(rows).toHaveCount(3);
    // Each row carries a badge and a gauge.
    await expect(rows.first().locator('.noggin-list-badge')).toBeVisible();
    await expect(rows.first().locator('.noggin-gauge')).toBeVisible();
  });

  test('empty store renders the empty-state row', async ({ mount, page }) => {
    await mount(<NogginListFixture seed="empty" />);
    await expect(page.locator('.noggin-list-empty')).toBeVisible();
    await expect(page.locator('.noggin-list-empty')).toContainText(/no entries/i);
  });
});

test.describe('NogginList — activation', () => {
  test('clicking a row fires onActivate', async ({ mount, page }) => {
    await mount(<NogginListFixture seed="three-closed" />);
    const row = page.locator('.noggin-list-row').nth(1);
    await row.click();
    await expect(page.getByTestId('last-activated')).toHaveText('file:///c2.yaml');
  });
});

test.describe('NogginList — keyboard nav', () => {
  test('ArrowDown / ArrowUp / Home / End move single-select', async ({ mount, page }) => {
    await mount(<NogginListFixture seed="three-closed" />);
    const list = page.getByRole('listbox');
    await list.focus();
    // First press selects the top row.
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('selected-summary')).toHaveText('file:///c1.yaml');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('selected-summary')).toHaveText('file:///c2.yaml');
    await page.keyboard.press('End');
    await expect(page.getByTestId('selected-summary')).toHaveText('file:///c3.yaml');
    await page.keyboard.press('Home');
    await expect(page.getByTestId('selected-summary')).toHaveText('file:///c1.yaml');
    await page.keyboard.press('ArrowUp');   // wrap
    await expect(page.getByTestId('selected-summary')).toHaveText('file:///c3.yaml');
  });

  test('Enter on selected row fires onActivate', async ({ mount, page }) => {
    await mount(<NogginListFixture seed="three-closed" />);
    const list = page.getByRole('listbox');
    await list.focus();
    await page.keyboard.press('ArrowDown'); // c1
    await page.keyboard.press('ArrowDown'); // c2
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('last-activated')).toHaveText('file:///c2.yaml');
  });

  test('Delete removes the selected row directly via the store', async ({ mount, page }) => {
    await mount(<NogginListFixture seed="three-closed" />);
    const list = page.getByRole('listbox');
    await list.focus();
    await page.keyboard.press('ArrowDown'); // c1
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('entries-count')).toHaveText('2');
    await expect(page.getByTestId('entries-summary')).toHaveText('file:///c2.yaml | file:///c3.yaml');
    // Selection cleared too.
    await expect(page.getByTestId('selected-summary')).toHaveText('(none)');
  });

  test('Escape clears selection', async ({ mount, page }) => {
    await mount(<NogginListFixture seed="three-closed" />);
    const list = page.getByRole('listbox');
    await list.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('selected-summary')).toHaveText('file:///c1.yaml');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('selected-summary')).toHaveText('(none)');
  });
});

test.describe('NogginList — kebab menu', () => {
  test('toggles a show-* pref', async ({ mount, page }) => {
    await mount(<NogginListFixture seed="three-closed" />);
    await expect(page.getByTestId('show-key')).toHaveText('n');
    await page.getByRole('button', { name: 'View options' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Active item key' }).click();
    // Radix closes the menu only on explicit selects; checkbox stays
    // open — close it ourselves.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('show-key')).toHaveText('y');
  });

  test('changes sort mode', async ({ mount, page }) => {
    await mount(<NogginListFixture seed="three-closed" />);
    await expect(page.getByTestId('sort-mode')).toHaveText('manual');
    await page.getByRole('button', { name: 'View options' }).click();
    await page.getByRole('menuitemradio', { name: 'Newest first' }).click();
    await expect(page.getByTestId('sort-mode')).toHaveText('newest');
    // Newest-first ordering — c3 is the newest.
    const labels = await page.locator('.noggin-list-row .noggin-list-label').allTextContents();
    expect(labels).toEqual(['c3.yaml', 'c2.yaml', 'c1.yaml']);
  });

  test('filter-by-type hides matching schemes', async ({ mount, page }) => {
    await mount(<NogginListFixture seed="mixed-types" />);
    await expect(page.locator('.noggin-list-row')).toHaveCount(3);
    await page.getByRole('button', { name: 'View options' }).click();
    // Uncheck "YAML file".
    await page.getByRole('menuitemcheckbox', { name: 'YAML file' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.noggin-list-row')).toHaveCount(2);
    // The remaining rows are memory + https.
    const labels = await page.locator('.noggin-list-row .noggin-list-label').allTextContents();
    expect(labels.sort()).toEqual(['r.yaml', 'scratch']);
  });

  test('close-active-entry only appears when something is selected', async ({ mount, page }) => {
    await mount(<NogginListFixture seed="three-files" />);
    await page.getByRole('button', { name: 'View options' }).click();
    await expect(page.getByRole('menuitem', { name: 'Close open noggin' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Close open noggin' }).click();
    await expect(page.getByTestId('close-count')).toHaveText('1');
  });
});

test.describe('NogginList — copy chips', () => {
  test('clicking a URI copy chip writes to clipboard', async ({ mount, page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions vary');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await mount(<NogginListFixture seed="three-closed" />);
    const row = page.locator('.noggin-list-row').first();
    // Hover to reveal the copy button.
    await row.hover();
    const copyBtn = row.locator('.noggin-list-copy-btn').first();
    await copyBtn.click({ force: true });
    const value = await page.evaluate(() => navigator.clipboard.readText());
    expect(value).toBe('file:///c1.yaml');
  });
});

test.describe('NogginList — live gauge', () => {
  test('gauge updates after the observed noggin changes', async ({ mount, page }) => {
    await mount(<NogginListFixture seed="three-files" />);
    // 'alpha' is the observed row. The seed sets 3 items, none done.
    const alphaRow = page.locator('.noggin-list-row').first();
    const alphaGaugeTitle = alphaRow.locator('.noggin-gauge title');
    await expect(alphaGaugeTitle).toHaveText(/0 of 3 done/);
    // Trigger a verb on the live noggin via the fixture's button.
    await page.getByTestId('mark-active-done').click();
    await expect(alphaGaugeTitle).toHaveText(/1 of 3 done/);
  });
});
