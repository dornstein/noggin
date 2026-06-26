// CT: react-arborist's virtualization must NOT render all 200 nodes
// when only ~10 fit in the viewport. jsdom can't observe this — it
// has no layout, so every row's bounding box is the same.

import { test, expect } from '@playwright/experimental-ct-react';
import { LargeTree } from './fixtures/LargeTree';

test.use({ viewport: { width: 800, height: 600 } });

test('virtualizes a 200-node tree to a viewport-sized window', async ({ mount, page }) => {
  await mount(<LargeTree />);

  const rows = page.getByRole('treeitem');

  // We render at height 220 with rowHeight 22 → ~10 rows visible.
  // react-arborist over-renders a few outside the viewport for
  // smooth scrolling. Asserting `< 30` confirms it isn't rendering
  // all 200 nodes (which a broken virtualizer would do).
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(30);

  // The first node must be visible; nodes well beyond the viewport
  // must NOT be in the DOM at all.
  await expect(rows.first()).toContainText('node-0');
  await expect(page.getByText('node-150', { exact: true })).toHaveCount(0);
});
