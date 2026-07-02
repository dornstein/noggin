// CT: regression for the desktop-app bug where pressing Alt+Down on
// a row in the middle of a sibling list left selection on the row
// that took the moved row's slot, not the row the user moved.
//
// Repro (manual):
//   1. Select task-0 sitting at /1/6 (middle of an 8-child list).
//   2. Press Alt+Down.
//   3. Tree visually swaps task-0 with task-7 — correct.
//   4. The host's `selectedPath` derives via key-then-lookup over a
//      stale `nodes` snapshot — when the orchestrator fires
//      `onSelect('/1/7')` immediately after the verb settles, the
//      look-up resolves '/1/7' against the PRE-MOVE forest where
//      '/1/7' was still task-7. selectedKey becomes task-7's key,
//      and on the next render selectedPath snaps back to '/1/6'.
//
// jsdom can't reproduce this because react-arborist's virtualizer
// and real focus reconciliation don't run there. CT is the right
// tier.

import { test, expect } from '@playwright/experimental-ct-react';
import { DesktopSelectionTree } from './fixtures/DesktopSelectionTree';

test.use({ viewport: { width: 800, height: 600 } });

test('Alt+Down on a middle row keeps selection on the MOVED row, not the row that took its slot', async ({ mount, page }) => {
  await mount(<DesktopSelectionTree initialSelectedTitle="task-0" />);

  // Wait for the seed verbs to settle and the initial selection to land.
  await expect(page.getByTestId('selected-title')).toHaveText('task-0');
  const startPath = await page.getByTestId('selected-path').innerText();

  const tree = page.getByRole('tree');
  await tree.focus();
  await expect(tree).toBeFocused();

  await page.keyboard.press('Alt+ArrowDown');

  // Give the engine's onDidChange + React re-projection a beat to
  // settle, and any latent selection snap-back to fire.
  await page.waitForTimeout(100);

  // The critical assertion: the row that's selected NOW is still
  // the row we moved (task-0), not the row that took task-0's old
  // slot (task-1 or task-7 depending on the path layout).
  await expect(page.getByTestId('selected-title')).toHaveText('task-0');

  // Bonus: the path must have advanced (otherwise the move silently
  // no-op'd and the test wouldn't catch a bug).
  const endPath = await page.getByTestId('selected-path').innerText();
  expect(endPath).not.toBe(startPath);
});
