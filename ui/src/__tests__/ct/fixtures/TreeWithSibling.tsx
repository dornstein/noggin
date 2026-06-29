// Fixture for the tree focus CT test. Stages the tree alongside
// another focusable element so we can verify Tab doesn't escape the
// tree (the NogginTree intercepts Tab to demote / promote rows).

import { useMemo, useState } from 'react';
import { NogginTree } from '../../../NogginTree';
import type { NogginNode } from '../../../types';
import { mockActions } from '../../helpers/mockActions';

function node(key: string, path: string, title: string, children: NogginNode[] = []): NogginNode {
  return { key, path, title, done: false, noteCount: 0, children };
}

const NODES: NogginNode[] = [
  node('k1', '/1', 'A', [node('k1c1', '/1/1', 'A.1')]),
  node('k2', '/2', 'B'),
];

export function TreeWithSibling() {
  const [selected, setSelected] = useState<string | null>('/1');
  const [lastGesture, setLastGesture] = useState<string>('');
  // Mock out actions but capture which named structural action
  // fired so the CT test can assert the tree dispatched the right
  // one. The CT covers Tab/Shift+Tab \u2192 demote/promote (and the
  // related Tab-no-leak invariant).
  const actions = useMemo(() => {
    const base = mockActions();
    base.demote.mockImplementation(async () => { setLastGesture('demote'); return { movedKey: null }; });
    base.promote.mockImplementation(async () => { setLastGesture('promote'); return { movedKey: null }; });
    return base;
  }, []);
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input data-testid="outside-input" placeholder="outside" />
      <div
        data-testid="tree-host"
        style={{ display: 'flex', flexDirection: 'column', width: 320, height: 240 }}
      >
        <NogginTree
          nodes={NODES}
          fileId="ct"
          activeKey={null}
          selectedPath={selected}
          renamingPath={null}
          actions={actions}
          onSelect={(p) => setSelected(p)}
        />
      </div>
      <div data-testid="last-gesture">{lastGesture}</div>
    </div>
  );
}
