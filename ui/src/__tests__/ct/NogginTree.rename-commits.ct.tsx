// Regression for "type-then-Enter loses the new row" reported on
// the desktop app:
//
//   1. The noggin has one root item ("pizza").
//   2. User selects it and presses Enter. The tree fires
//      addSiblingAfter → orchestrator drops the new (empty) row into
//      rename mode via onRequestRename(path, { isNew: true }).
//   3. User types "burger" and presses Enter.
//   4. Expected: a second row "burger" appears at /2.
//      Observed (bug):  the rename input disappears and the new row
//      vanishes — only the original "pizza" row is left.
//
// Root cause: NogginTree's Enter handler in the inline rename input
// fires `actions.rename(key, value)` (returns a Promise) and then
// synchronously calls `onRenameCancel`. The host's `onRenameCancel`
// is wired with a policy "if this was a fresh add and the row's
// title is still empty, delete it" — it reads the title BEFORE the
// rename promise has settled, sees `''`, and deletes the row.
//
// This CT exercises the exact flow against a fixture that mirrors
// the desktop host's rename-cancel policy so the bug reproduces
// against real DOM + real engine.

import { test, expect, type Page } from '@playwright/experimental-ct-react';
import { DesktopSelectionTree } from './fixtures/DesktopSelectionTree';

test.use({ viewport: { width: 600, height: 400 } });

async function focusTreeOnRow(page: Page, selectedTitle: string) {
  await expect(page.getByTestId('selected-title')).toHaveText(selectedTitle);
  const tree = page.getByRole('tree');
  await tree.focus();
  await expect(tree).toBeFocused();
}

test('Enter → type "burger" → Enter on a single-root noggin keeps the new row', async ({ mount, page }) => {
  await mount(
    <DesktopSelectionTree
      seedKind="single-root-pizza"
      initialSelectedTitle="pizza"
    />,
  );
  await focusTreeOnRow(page, 'pizza');

  // Add the sibling: tree fires addSiblingAfter, the orchestrator
  // arms rename on the new (empty) row.
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('renaming-path')).toHaveText('/2');
  await expect(page.getByTestId('item-count')).toHaveText('2');

  // Type + commit.
  const input = page.locator('.noggin-row:has(.position:text-is("/2")) input');
  await input.fill('burger');
  await input.press('Enter');

  // Give the engine's onDidChange and any post-commit settlement a
  // chance to land.
  await page.waitForTimeout(80);

  // The new row must still exist and carry the committed title.
  await expect(page.getByTestId('item-count')).toHaveText('2');
  await expect(page.getByTestId('renaming-path')).toHaveText('(none)');
  await expect(page.getByTestId('items-summary')).toContainText('/1:pizza | /2:burger');
});

test('Escape on a fresh-add empty row DOES delete it (the renamingIsNew policy still works)', async ({ mount, page }) => {
  await mount(
    <DesktopSelectionTree
      seedKind="single-root-pizza"
      initialSelectedTitle="pizza"
    />,
  );
  await focusTreeOnRow(page, 'pizza');

  await page.keyboard.press('Enter');
  await expect(page.getByTestId('item-count')).toHaveText('2');

  // No typing — user changes their mind and hits Escape.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);

  // Empty fresh-add row got deleted; only the original pizza remains.
  await expect(page.getByTestId('item-count')).toHaveText('1');
  await expect(page.getByTestId('items-summary')).toContainText('/1:pizza');
});
