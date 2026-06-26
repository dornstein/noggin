// CT smoke for the auto-sizing path in <NogginTree>.
//
// Pins behaviour that jsdom can't observe: when the tree is mounted
// inside a `display: none` parent that later becomes visible, every
// row must render with a real (non-zero) bounding box. The tree
// uses `flex: 1` on its root and a `ResizeObserver` on the same
// element to drive its virtualized viewport, so any future change
// to either the auto-sizer or the flex layout has to keep this
// working.
//
// (Originally added after a playground tab-switch glitch where the
// tree appeared empty. We couldn't reproduce the exact failure in
// CT — modern Chromium's ResizeObserver handles the display
// transition reliably — but the code path is now under coverage so
// any genuine regression of the auto-sizer or the flex layout
// surfaces here instead of in production.)

import { test, expect } from '@playwright/experimental-ct-react';
import { TreeInHiddenParent } from './fixtures/TreeInHiddenParent';

test.use({ viewport: { width: 800, height: 600 } });

test('NogginTree renders rows when its parent becomes visible after mount', async ({ mount, page }) => {
  const component = await mount(<TreeInHiddenParent />);

  // While hidden, the tree must NOT lock in a 0×0 size. We then make
  // the parent visible and expect every row to render AND have real
  // dimensions — arborist will emit treeitems even with a 0×0
  // viewport, so we have to check the bounding box too.
  await component.getByRole('button', { name: 'Show tree' }).click();

  const rows = page.getByRole('treeitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('A');
  await expect(rows.nth(1)).toContainText('B');
  await expect(rows.nth(2)).toContainText('C');

  const tree = page.getByRole('tree');
  await expect.poll(async () => {
    const box = await tree.boundingBox();
    return box ? { w: Math.round(box.width), h: Math.round(box.height) } : null;
  }).toMatchObject({ w: expect.any(Number) });
  const box = await tree.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);
});

test('NogginTree survives parent resize from 0 -> measured -> 0 -> measured', async ({ mount, page }) => {
  const component = await mount(<TreeInHiddenParent />);
  const toggle = component.getByRole('button', { name: 'Show tree' });

  await toggle.click();                  // visible
  await expect(page.getByRole('treeitem')).toHaveCount(3);
  const firstBox = await page.getByRole('tree').boundingBox();
  expect(firstBox?.height ?? 0).toBeGreaterThan(0);

  await toggle.click();                  // hidden (0×0)
  await toggle.click();                  // visible again
  await expect(page.getByRole('treeitem')).toHaveCount(3);
  const secondBox = await page.getByRole('tree').boundingBox();
  expect(secondBox?.height ?? 0).toBeGreaterThan(0);
});
