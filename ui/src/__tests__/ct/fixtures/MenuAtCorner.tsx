// Fixture for the context-menu viewport-clamping test. The "open
// menu" button positions the menu at the viewport's bottom-right
// corner so the clamp logic has to engage.
//
// Imports the internal renderer directly. `TreeContextMenuView` is
// the noggin tree's default popup; it isn't part of @noggin/ui's
// public surface but the CT test needs to drive it in isolation to
// verify positioning behaviour.

import { useEffect, useState } from 'react';
import { TreeContextMenuView } from '../../../internal/TreeContextMenuView';
import type { TreeContextMenuEntry } from '../../../types';

const ITEMS: TreeContextMenuEntry[] = [
  { kind: 'item', key: 'a', label: 'Action A', onClick: () => {} },
  { kind: 'item', key: 'b', label: 'Action B', onClick: () => {} },
  { kind: 'separator', key: 'sep-1' },
  { kind: 'item', key: 'c', label: 'Action C', onClick: () => {} },
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
      {open && (
        <TreeContextMenuView
          position={open}
          entries={ITEMS}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
