// CT: Tab on a focused row inside <NogginTree> must fire the `demote`
// gesture and keep DOM focus inside the tree (not flip to the outside
// input). Real browsers actually move focus on Tab; jsdom doesn't,
// so this regression class can only be caught in CT.

import { test, expect } from '@playwright/experimental-ct-react';
import { TreeWithSibling } from './fixtures/TreeWithSibling';

test.use({ viewport: { width: 800, height: 600 } });

test('Tab inside the tree fires `demote` and DOES NOT escape to the next focusable', async ({ mount, page }) => {
  await mount(<TreeWithSibling />);

  const tree = page.getByRole('tree');
  await tree.focus();
  await expect(tree).toBeFocused();

  // Pressing ArrowDown then Tab. The Tab keystroke is what we care
  // about — NogginTree must intercept it, fire the `demote` gesture,
  // and `preventDefault()` so the browser doesn't tab focus into the
  // sibling input next to the tree.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');

  await expect(page.getByTestId('last-gesture')).toHaveText('demote');

  // The critical assertion: focus did NOT escape to the next focusable
  // element. (After Tab, focus may legitimately land on body during a
  // state-driven re-render — that's not the bug class. The bug class
  // is "Tab moved focus to the next tabstop", which would steal focus
  // from a user mid-keyboard-flow.)
  await expect(page.getByTestId('outside-input')).not.toBeFocused();
});
