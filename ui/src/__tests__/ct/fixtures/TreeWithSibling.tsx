// Fixture for the tree focus CT test. Stages the tree alongside
// another focusable element so we can verify Tab doesn't escape the
// tree (the NogginTree intercepts Tab to demote / promote rows).

import { useState } from 'react';
import { NogginTree } from '../../../NogginTree';
import type { NogginNode, TreeGesture } from '../../../types';

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
          onSelect={(p) => setSelected(p)}
          onToggleDone={() => {}}
          onMove={() => {}}
          onGesture={(_path, gesture: TreeGesture) => setLastGesture(gesture)}
        />
      </div>
      <div data-testid="last-gesture">{lastGesture}</div>
    </div>
  );
}
