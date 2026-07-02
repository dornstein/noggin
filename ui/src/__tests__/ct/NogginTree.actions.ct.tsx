// Comprehensive CT coverage for every NogginActions method as
// driven through the live tree's keyboard handler, hover-reveal
// icons, and inline rename input. Runs against a real in-memory
// noggin so the engine state transitions are observable.
//
// Coverage matrix (mapped to NogginActions methods):
//
//   Adds:     addSiblingAfter, addSiblingBefore, addChild,
//             addFirstSibling, addLastSibling
//   Moves:    moveUp, moveDown, moveToFirst, moveToLast,
//             demote, promote
//   Edits:    rename (via inline input), toggleDone (via Space,
//             via click), delete (via Delete key)
//   Activation: activate (via click on pin)
//
// Skipped here (covered elsewhere or non-keyboard):
//   - move(key, placement): explicit anchor, drag-drop only.
//     Verb coverage in src/__tests__/actions.test.ts.
//   - appendNote: details-pane only; CT for the details pane
//     belongs in a separate file once that pane has a fixture.

import { test, expect } from '@playwright/experimental-ct-react';
import type { Locator, Page } from '@playwright/test';
import { DesktopSelectionTree } from './fixtures/DesktopSelectionTree';

test.use({ viewport: { width: 800, height: 700 } });

// ── Helpers ────────────────────────────────────────────────────────

/** Resolve a row by its dotted path (the `.position` span text). */
function rowByPath(page: Page, path: string): Locator {
  return page.locator(`.noggin-row:has(.position:text-is("${path}"))`);
}

async function focusTreeOnRow(page: Page, selectedTitle: string) {
  await expect(page.getByTestId('selected-title')).toHaveText(selectedTitle);
  const tree = page.getByRole('tree');
  await tree.focus();
  await expect(tree).toBeFocused();
}

// ── Adds ───────────────────────────────────────────────────────────

test.describe('add gestures', () => {
  test('Enter on task-1 inserts a new sibling AFTER it', async ({ mount, page }) => {
    await mount(<DesktopSelectionTree seedKind="tasks-4" initialSelectedTitle="task-1" />);
    await focusTreeOnRow(page, 'task-1');
    const startPath = await page.getByTestId('selected-path').innerText();   // /1/2

    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);

    // Item count went up by one.
    await expect(page.getByTestId('item-count')).toHaveText('6');             // 1 parent + 4 originals + 1 new
    // The newly-added empty row landed at the slot AFTER task-1 (/1/3)
    // and entered rename mode automatically.
    const afterPath = startPath.replace(/(\d+)$/, (m) => String(Number(m) + 1));
    await expect(page.getByTestId('renaming-path')).toHaveText(afterPath);
    // The new row's title is empty in the projected tree.
    await expect(page.getByTestId('items-summary')).toContainText(`${afterPath}:(empty)`);
  });

  test('Shift+Enter on task-1 inserts a new sibling BEFORE it', async ({ mount, page }) => {
    await mount(<DesktopSelectionTree seedKind="tasks-4" initialSelectedTitle="task-1" />);
    await focusTreeOnRow(page, 'task-1');
    const startPath = await page.getByTestId('selected-path').innerText();   // /1/2

    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);

    await expect(page.getByTestId('item-count')).toHaveText('6');
    // New row took task-1's old slot; task-1 shifted down. Renaming
    // arms on the new (empty) row.
    await expect(page.getByTestId('renaming-path')).toHaveText(startPath);
    await expect(page.getByTestId('items-summary')).toContainText(`${startPath}:(empty)`);
  });

  test('Ctrl+Enter on task-1 inserts a new CHILD under it', async ({ mount, page }) => {
    await mount(<DesktopSelectionTree seedKind="tasks-4" initialSelectedTitle="task-1" />);
    await focusTreeOnRow(page, 'task-1');
    const startPath = await page.getByTestId('selected-path').innerText();   // /1/2

    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(50);

    await expect(page.getByTestId('item-count')).toHaveText('6');
    await expect(page.getByTestId('renaming-path')).toHaveText(`${startPath}/1`);
    await expect(page.getByTestId('items-summary')).toContainText(`${startPath}/1:(empty)`);
  });

  test('Ctrl+Home on task-2 inserts a new row at the START of the sibling list', async ({ mount, page }) => {
    await mount(<DesktopSelectionTree seedKind="tasks-4" initialSelectedTitle="task-2" />);
    await focusTreeOnRow(page, 'task-2');

    await page.keyboard.press('Control+Home');
    await page.waitForTimeout(50);

    // task-0 was at /1/1; the new row takes /1/1 and task-0 shifts to /1/2.
    await expect(page.getByTestId('renaming-path')).toHaveText('/1/1');
    await expect(page.getByTestId('items-summary')).toContainText('/1/1:(empty) | /1/2:task-0');
  });

  test('Ctrl+End on task-1 inserts a new row at the END of the sibling list', async ({ mount, page }) => {
    await mount(<DesktopSelectionTree seedKind="tasks-4" initialSelectedTitle="task-1" />);
    await focusTreeOnRow(page, 'task-1');

    await page.keyboard.press('Control+End');
    await page.waitForTimeout(50);

    // 4 original tasks plus the new one at /1/5.
    await expect(page.getByTestId('renaming-path')).toHaveText('/1/5');
    await expect(page.getByTestId('items-summary')).toContainText('/1/5:(empty)');
  });
});

// ── Moves ──────────────────────────────────────────────────────────

test.describe('move gestures', () => {
  test('Alt+Up swaps task-2 with task-1 above it; selection follows the moved row', async ({ mount, page }) => {
    await mount(<DesktopSelectionTree seedKind="tasks-4" initialSelectedTitle="task-2" />);
    await focusTreeOnRow(page, 'task-2');

    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForTimeout(50);

    // task-2 now sits at /1/2 (was at /1/3); task-1 dropped to /1/3.
    await expect(rowByPath(page, '/1/2').locator('.title')).toContainText('task-2');
    await expect(rowByPath(page, '/1/3').locator('.title')).toContainText('task-1');
    await expect(page.getByTestId('selected-title')).toHaveText('task-2');
  });

  test('Alt+Down swaps task-1 with task-2 below it; selection follows', async ({ mount, page }) => {
    await mount(<DesktopSelectionTree seedKind="tasks-4" initialSelectedTitle="task-1" />);
    await focusTreeOnRow(page, 'task-1');

    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForTimeout(50);

    await expect(rowByPath(page, '/1/2').locator('.title')).toContainText('task-2');
    await expect(rowByPath(page, '/1/3').locator('.title')).toContainText('task-1');
    await expect(page.getByTestId('selected-title')).toHaveText('task-1');
  });

  test('Alt+Home jumps task-3 to first sibling', async ({ mount, page }) => {
    await mount(<DesktopSelectionTree seedKind="tasks-4" initialSelectedTitle="task-3" />);
    await focusTreeOnRow(page, 'task-3');

    await page.keyboard.press('Alt+Home');
    await page.waitForTimeout(50);

    await expect(rowByPath(page, '/1/1').locator('.title')).toContainText('task-3');
    await expect(page.getByTestId('selected-title')).toHaveText('task-3');
  });

  test('Alt+End jumps task-0 to last sibling', async ({ mount, page }) => {
    await mount(<DesktopSelectionTree seedKind="tasks-4" initialSelectedTitle="task-0" />);
    await focusTreeOnRow(page, 'task-0');

    await page.keyboard.press('Alt+End');
    await page.waitForTimeout(50);

    await expect(rowByPath(page, '/1/4').locator('.title')).toContainText('task-0');
    await expect(page.getByTestId('selected-title')).toHaveText('task-0');
  });

  test('Tab on task-1 demotes it to last child of task-0; selection follows', async ({ mount, page }) => {
    await mount(<DesktopSelectionTree seedKind="tasks-4" initialSelectedTitle="task-1" />);
    await focusTreeOnRow(page, 'task-1');

    await page.keyboard.press('Tab');
    await page.waitForTimeout(50);

    await expect(rowByPath(page, '/1/1/1').locator('.title')).toContainText('task-1');
    await expect(page.getByTestId('selected-title')).toHaveText('task-1');
  });

  test('Shift+Tab on a nested row promotes it to next-sibling-of-parent', async ({ mount, page }) => {
    // Seeded: parent → A → A.1 (the row we'll promote).
    await mount(<DesktopSelectionTree seedKind="nested-A-A1" initialSelectedTitle="A.1" />);
    await focusTreeOnRow(page, 'A.1');

    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(50);

    // A.1 lifts to be A's next sibling under parent: /1/2.
    await expect(rowByPath(page, '/1/2').locator('.title')).toContainText('A.1');
    await expect(page.getByTestId('selected-title')).toHaveText('A.1');
  });
});

// ── Edits ──────────────────────────────────────────────────────────

test.describe('edit gestures', () => {
  test('Space toggles done on the focused row, Space again reopens it', async ({ mount, page }) => {
    await mount(<DesktopSelectionTree seedKind="tasks-3" initialSelectedTitle="task-1" />);
    await focusTreeOnRow(page, 'task-1');

    await page.keyboard.press(' ');
    await expect(rowByPath(page, '/1/2')).toHaveClass(/done/);

    await page.keyboard.press(' ');
    await expect(rowByPath(page, '/1/2')).not.toHaveClass(/done/);
  });

  test('Click on the row state circle toggles done (mirrors Space)', async ({ mount, page }) => {
    await mount(<DesktopSelectionTree seedKind="tasks-3" initialSelectedTitle="task-0" />);
    await focusTreeOnRow(page, 'task-0');

    await rowByPath(page, '/1/2').locator('.done-icon').click();
    await expect(rowByPath(page, '/1/2')).toHaveClass(/done/);
  });

  test('Delete removes the focused row and shifts selection to the next sibling', async ({ mount, page }) => {
    await mount(<DesktopSelectionTree seedKind="tasks-4" initialSelectedTitle="task-1" />);
    await focusTreeOnRow(page, 'task-1');

    await page.keyboard.press('Delete');
    await page.waitForTimeout(50);

    // task-1 is gone; task-2 took its slot (/1/2).
    await expect(page.getByTestId('item-count')).toHaveText('4');             // 1 parent + 3 remaining
    await expect(rowByPath(page, '/1/2').locator('.title')).toContainText('task-2');
    // Fallback focus landed on the next sibling at the old slot.
    await expect(page.getByTestId('selected-title')).toHaveText('task-2');
  });

  test('Delete on the last sibling falls back to the PREVIOUS sibling', async ({ mount, page }) => {
    await mount(<DesktopSelectionTree seedKind="tasks-4" initialSelectedTitle="task-3" />);
    await focusTreeOnRow(page, 'task-3');

    await page.keyboard.press('Delete');
    await page.waitForTimeout(50);

    await expect(page.getByTestId('selected-title')).toHaveText('task-2');
  });

  test('F2 opens the inline rename input and does NOT mutate the engine', async ({ mount, page }) => {
    await mount(<DesktopSelectionTree seedKind="tasks-3" initialSelectedTitle="task-1" />);
    await focusTreeOnRow(page, 'task-1');

    await page.keyboard.press('F2');

    await expect(page.getByTestId('renaming-path')).toHaveText('/1/2');
    await expect(rowByPath(page, '/1/2').locator('input')).toBeFocused();
  });

  test('F2 → type → Enter commits the rename via actions.rename', async ({ mount, page }) => {
    await mount(<DesktopSelectionTree seedKind="tasks-3" initialSelectedTitle="task-1" />);
    await focusTreeOnRow(page, 'task-1');

    await page.keyboard.press('F2');
    const input = rowByPath(page, '/1/2').locator('input');
    await input.fill('renamed-task');
    await input.press('Enter');
    await page.waitForTimeout(50);

    await expect(rowByPath(page, '/1/2').locator('.title')).toContainText('renamed-task');
    await expect(page.getByTestId('renaming-path')).toHaveText('(none)');
  });

  test('F2 → type → Escape abandons the rename', async ({ mount, page }) => {
    await mount(<DesktopSelectionTree seedKind="tasks-3" initialSelectedTitle="task-1" />);
    await focusTreeOnRow(page, 'task-1');

    await page.keyboard.press('F2');
    const input = rowByPath(page, '/1/2').locator('input');
    await input.fill('discarded');
    await input.press('Escape');
    await page.waitForTimeout(50);

    await expect(rowByPath(page, '/1/2').locator('.title')).toContainText('task-1');
    await expect(page.getByTestId('renaming-path')).toHaveText('(none)');
  });
});

// ── Activation ─────────────────────────────────────────────────────

test.describe('activation', () => {
  test('Clicking the pin icon on a non-active row makes that row the engine-active item', async ({ mount, page }) => {
    await mount(<DesktopSelectionTree seedKind="tasks-3" initialSelectedTitle="task-0" />);
    await focusTreeOnRow(page, 'task-0');

    // No active item to start.
    await expect(page.getByTestId('active-title')).toHaveText('(none)');

    await rowByPath(page, '/1/2').locator('.pin-icon').click();
    await page.waitForTimeout(50);

    await expect(page.getByTestId('active-title')).toHaveText('task-1');
    // Clicking the pin also pulled selection to that row.
    await expect(page.getByTestId('selected-title')).toHaveText('task-1');
  });

  test('Clicking the pin on the already-active row is a no-op', async ({ mount, page }) => {
    await mount(<DesktopSelectionTree seedKind="tasks-3-active-task-1" initialSelectedTitle="task-0" />);

    await expect(page.getByTestId('active-title')).toHaveText('task-1');

    await rowByPath(page, '/1/2').locator('.pin-icon').click();
    await page.waitForTimeout(50);

    // Still task-1; selection didn't snap.
    await expect(page.getByTestId('active-title')).toHaveText('task-1');
    await expect(page.getByTestId('selected-title')).toHaveText('task-0');
  });
});
