// Regression test for a selection-snap bug observed in the desktop
// app:
//
//   1. Select a row in the middle of a sibling list (e.g. task-0
//      sitting at /1/6).
//   2. Press Alt+Down to move it down by one.
//   3. The row moves and selection follows it to /1/7 — correct.
//   4. Moments later, selection snaps BACK to /1/7 \u2014 but now /1/7
//      is the row that was swapped in (task-7), not the row the user
//      moved. The user's row has effectively been "lost".
//
// The fix this test pins: after a move action, the row keyed to the
// moved item must remain selected, regardless of how many extra
// onDidChange events the engine emits or how arborist's internal
// focus reconciliation interacts with the new node positions.

import { useEffect, useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

import { NogginTree } from '../NogginTree';
import { createNogginActions } from '../actions';
import { projectTree } from '../treeOps';
import type { NogginNode } from '../types';
import { verbs, type Noggin } from '@noggin/engine';
import { openMemoryNoggin } from '@noggin/engine/providers/memory';

/**
 * Mount NogginTree against a real in-memory noggin so `nodes`
 * actually re-projects on every engine onDidChange, and the action
 * surface returns real result envelopes the tree's orchestrator
 * consumes.
 */
function Harness({ noggin, initialSelectedPath, onSelectionChange }: {
  noggin: Noggin;
  initialSelectedPath: string;
  onSelectionChange: (p: string | null) => void;
}) {
  const [nodes, setNodes] = useState<NogginNode[]>(() => projectTree(noggin));
  const [selectedPath, setSelectedPath] = useState<string | null>(initialSelectedPath);

  useEffect(() => {
    const sub = noggin.onDidChange(() => {
      setNodes(projectTree(noggin));
    });
    return () => sub.dispose();
  }, [noggin]);

  useEffect(() => { onSelectionChange(selectedPath); }, [selectedPath, onSelectionChange]);

  const actions = createNogginActions(noggin);

  return (
    <div style={{ width: 480, height: 320 }}>
      <NogginTree
        nodes={nodes}
        fileId="regression"
        activeKey={noggin.active?.key ?? null}
        selectedPath={selectedPath}
        renamingPath={null}
        width={480}
        height={320}
        actions={actions}
        onSelect={setSelectedPath}
      />
    </div>
  );
}

function getTreeRoot(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[role="tree"]');
  if (!el) throw new Error('tree root not mounted');
  return el;
}

describe('<NogginTree> — selection follows a moved row, does not snap back', () => {
  it('Alt+Down on task-0 at /1/6 leaves selection on task-0\'s new path (/1/7)', async () => {
    // Build a parent with 8 distinguishable children. The test
    // targets the 6th child by path, which holds the title 'task-0'.
    const noggin = await openMemoryNoggin();
    await verbs.add(noggin, { title: 'parent' });
    for (let i = 0; i < 8; i++) {
      await verbs.add(noggin, {
        title: `task-${i}`,
        placement: { kind: 'into', anchor: '/1' },
      });
    }
    // Sanity: /1/6 is task-5 (1-indexed paths over a 0-indexed task
    // list \u2014 child #1 is task-0). Rebuild title→path so the test reads
    // naturally regardless of the indexing convention: find the path
    // for 'task-0' explicitly.
    const startNode = projectTree(noggin)[0]!.children.find((c) => c.title === 'task-0');
    if (!startNode) throw new Error('fixture: no task-0 row');
    const startPath = startNode.path;
    const startKey = startNode.key;

    // Capture every selection change the host sees, so the
    // assertion error reports the full trajectory (not just the
    // final value) when this regresses.
    const selections: (string | null)[] = [];
    render(
      <Harness
        noggin={noggin}
        initialSelectedPath={startPath}
        onSelectionChange={(p) => selections.push(p)}
      />,
    );

    act(() => { getTreeRoot().focus(); });

    // Fire Alt+Down. The tree should: run actions.moveDown(startKey)
    // \u2192 engine swaps task-0 with its next sibling \u2192 orchestrator
    // calls onSelect with task-0's new path.
    await act(async () => {
      fireEvent.keyDown(getTreeRoot(), { key: 'ArrowDown', code: 'ArrowDown', altKey: true });
      // Let every pending microtask AND the engine's onDidChange
      // re-projection settle so any follow-up selection snap-back
      // has had a chance to fire.
      await new Promise((r) => setTimeout(r, 50));
    });

    // Where did task-0 actually end up, according to the engine?
    const movedNode = projectTree(noggin)[0]!.children.find((c) => c.key === startKey);
    if (!movedNode) throw new Error('post-move: task-0 vanished from tree');
    const expectedPath = movedNode.path;

    // The host's selectedPath right now must point at task-0's new
    // path, not at the row that took task-0's old slot.
    expect(selections[selections.length - 1]).toBe(expectedPath);

    // Defensive: whichever row is currently selected must still be
    // the row we asked to move.
    const finalNode = projectTree(noggin)[0]!.children.find(
      (c) => c.path === selections[selections.length - 1],
    );
    expect(finalNode?.key).toBe(startKey);
    expect(finalNode?.title).toBe('task-0');

    await noggin.dispose();
  });
});
