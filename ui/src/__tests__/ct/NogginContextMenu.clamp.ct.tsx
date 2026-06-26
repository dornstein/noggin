// CT: NogginContextMenu must clamp to the viewport so it never
// renders off-screen. The clamp uses live `window.innerWidth/Height`
// — meaningless in jsdom, exact in a real browser.

import { test, expect } from '@playwright/experimental-ct-react';
import { MenuAtBottomRight } from './fixtures/MenuAtCorner';

test.use({ viewport: { width: 800, height: 600 } });

test('NogginContextMenu clamps to the viewport when opened near the corner', async ({ mount, page }) => {
  await mount(<MenuAtBottomRight />);

  await page.getByTestId('open-menu').click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();

  const box = await menu.boundingBox();
  if (!box) throw new Error('menu has no bounding box');

  // The menu must fit entirely inside the viewport: its right + bottom
  // edges must be strictly inside 800×600 (allowing a 1px subpixel
  // rounding slop).
  expect(box.x + box.width).toBeLessThanOrEqual(801);
  expect(box.y + box.height).toBeLessThanOrEqual(601);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
});
