// Fixture for the context-menu viewport-clamping test. The "open
// menu" button positions the menu at the viewport's bottom-right
// corner so the clamp logic has to engage.

import { useEffect, useState } from 'react';
import { NogginContextMenu } from '../../../NogginContextMenu';
import type { NogginContextMenuEntry } from '../../../NogginContextMenu';

const ITEMS: NogginContextMenuEntry[] = [
  { key: 'a', label: 'Action A', onClick: () => {} },
  { key: 'b', label: 'Action B', onClick: () => {} },
  { separator: true },
  { key: 'c', label: 'Action C', onClick: () => {} },
];

export function MenuAtBottomRight() {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  // Use viewport dims at click time so the test is viewport-agnostic.
  const [dims, setDims] = useState({ w: 800, h: 600 });
  useEffect(() => {
    setDims({ w: window.innerWidth, h: window.innerHeight });
  }, []);
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <button
        data-testid="open-menu"
        onClick={() => setOpen({ x: dims.w - 4, y: dims.h - 4 })}
        style={{ position: 'absolute', top: 10, left: 10 }}
      >
        Open menu
      </button>
      <NogginContextMenu
        open={open}
        items={ITEMS}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}
