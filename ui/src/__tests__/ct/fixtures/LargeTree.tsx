// Fixture: a large tree (200 nodes) so we can assert virtualization
// only renders the visible viewport, not every node. Mounts at a
// known small height so we can predict the visible row count.

import { useState } from 'react';
import { NogginTree } from '../../../NogginTree';
import type { NogginNode } from '../../../types';
import { mockActions } from '../../helpers/mockActions';

function manyNodes(n: number): NogginNode[] {
  const out: NogginNode[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      key: `k${i}`,
      path: `/${i + 1}`,
      title: `node-${i}`,
      done: false,
      noteCount: 0,
      children: [],
    });
  }
  return out;
}

const NODES = manyNodes(200);

export function LargeTree() {
  const [selected, setSelected] = useState<string | null>('/1');
  const [actions] = useState(() => mockActions());
  return (
    <div
      data-testid="tree-host"
      style={{ display: 'flex', flexDirection: 'column', width: 400, height: 220 }}
    >
      <NogginTree
        nodes={NODES}
        fileId="ct"
        activeKey={null}
        selectedPath={selected}
        renamingPath={null}
        rowHeight={22}
        actions={actions}
        onSelect={(p) => setSelected(p)}
      />
    </div>
  );
}
