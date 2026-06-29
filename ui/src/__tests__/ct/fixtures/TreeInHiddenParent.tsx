// Fixtures for CT tests. Kept out of the test file because
// Playwright CT transforms the `mount(<Component .../>)` AST at
// build time and disallows arbitrary props in that call site — so
// any JSX with handlers/state lives in dedicated fixture
// components like the ones below.

import { useState } from 'react';
import { NogginTree } from '../../../NogginTree';
import type { NogginNode } from '../../../types';
import { mockActions } from '../../helpers/mockActions';

function node(key: string, path: string, title: string, children: NogginNode[] = []): NogginNode {
  return { key, path, title, done: false, noteCount: 0, children };
}

const THREE_ROOTS: NogginNode[] = [
  node('k1', '/1', 'A'),
  node('k2', '/2', 'B'),
  node('k3', '/3', 'C'),
];

/**
 * Mounts <NogginTree> inside a togglable container. The container
 * starts hidden (`display: none`) so the auto-sizer's first
 * measurement reads 0×0 — the trigger condition for the regression
 * we're pinning.
 *
 * NogginTree is mounted with NO explicit width/height, so its
 * auto-sizer (the regressed code path) is fully exercised. The host
 * is a flex column at fixed pixel dimensions, mirroring the docs
 * playground's `.pg-tree-pane` layout where the bug originally
 * surfaced — NogginTree's root uses `flex: 1` so its measured size
 * depends on the parent being a flex container.
 */
export function TreeInHiddenParent() {
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<string | null>('/1');
  const [actions] = useState(() => mockActions());
  return (
    <div>
      <button onClick={() => setVisible((v) => !v)}>Show tree</button>
      <div
        data-testid="tree-host"
        style={{
          display: visible ? 'flex' : 'none',
          flexDirection: 'column',
          width: 400,
          height: 300,
        }}
      >
        <NogginTree
          nodes={THREE_ROOTS}
          fileId="ct"
          activeKey={null}
          selectedPath={selected}
          renamingPath={null}
          actions={actions}
          onSelect={(p) => setSelected(p)}
        />
      </div>
    </div>
  );
}
