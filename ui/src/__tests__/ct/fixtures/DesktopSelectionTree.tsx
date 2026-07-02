// Fixture that mirrors the desktop renderer's selection-tracking
// pattern over a real in-memory noggin, with probes for every piece
// of state CT tests need to assert: selection (key + path + title),
// engine active, renaming path, and a flat dump of the engine's
// items list.
//
// Tests pick an initial tree shape via the `seedKind` string prop.
// Functions can't survive Playwright CT's Node → browser prop
// serialization, so each shape lives as a named entry in SEEDS
// inside this module; the test selects one by name.

import { useEffect, useMemo, useState, useCallback } from 'react';
import { NogginTree } from '../../../NogginTree';
import { createNogginActions } from '../../../actions';
import { projectTree } from '../../../treeOps';
import type { NogginNode } from '../../../types';
import type { Noggin } from '@noggin/engine';
import { openMemoryNoggin } from '@noggin/engine/providers/memory';

function findNodeByKey(nodes: NogginNode[], key: string): NogginNode | null {
  for (const n of nodes) {
    if (n.key === key) return n;
    const inChild = findNodeByKey(n.children, key);
    if (inChild) return inChild;
  }
  return null;
}

function findNodeByPath(nodes: NogginNode[], path: string): NogginNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    const inChild = findNodeByPath(n.children, path);
    if (inChild) return inChild;
  }
  return null;
}

function flatten(nodes: NogginNode[]): NogginNode[] {
  const out: NogginNode[] = [];
  const walk = (list: NogginNode[]) => {
    for (const n of list) { out.push(n); walk(n.children); }
  };
  walk(nodes);
  return out;
}

export type SeedKind =
  /** parent + 8 children task-0..task-7 (default). */
  | 'tasks-8'
  /** parent + 4 children task-0..task-3. */
  | 'tasks-4'
  /** parent + 3 children task-0..task-2. */
  | 'tasks-3'
  /** parent + 3 children, with task-1 set as active. */
  | 'tasks-3-active-task-1'
  /** parent > A > A.1 (a nested row for promote). */
  | 'nested-A-A1'
  /** Just one root item titled 'pizza'. Mirrors the smallest
   *  possible noggin — the case where add+rename has the fewest
   *  surrounding rows to mask bugs. */
  | 'single-root-pizza';

export interface DesktopSelectionTreeProps {
  /** Pick the initial tree shape. Default 'tasks-8'. */
  seedKind?: SeedKind;
  /**
   * Title of the row to start selected. Resolved against the seeded
   * tree at mount time so tests don't have to know exact paths.
   */
  initialSelectedTitle?: string;
}

async function applySeed(kind: SeedKind, n: Noggin): Promise<void> {
  if (kind === 'tasks-8' || kind === 'tasks-4' || kind === 'tasks-3' || kind === 'tasks-3-active-task-1') {
    const count = kind === 'tasks-8' ? 8 : kind === 'tasks-4' ? 4 : 3;
    await n.add({ title: 'parent' });
    for (let i = 0; i < count; i++) {
      await n.add({
        title: `task-${i}`,
        placement: { kind: 'into', anchor: '/1' },
      });
    }
    if (kind === 'tasks-3-active-task-1') {
      await n.goto({ path: '/1/2' });
    }
    return;
  }
  if (kind === 'nested-A-A1') {
    await n.add({ title: 'parent' });
    await n.add({ title: 'A', placement: { kind: 'into', anchor: '/1' } });
    await n.add({ title: 'A.1', placement: { kind: 'into', anchor: '/1/1' } });
    return;
  }
  if (kind === 'single-root-pizza') {
    await n.add({ title: 'pizza' });
    return;
  }
  throw new Error(`DesktopSelectionTree: unknown seedKind ${kind}`);
}

export function DesktopSelectionTree({
  seedKind = 'tasks-8',
  initialSelectedTitle = 'task-0',
}: DesktopSelectionTreeProps) {
  const [noggin, setNoggin] = useState<Noggin | null>(null);
  const [nodes, setNodes] = useState<NogginNode[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Seed the noggin once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const n = await openMemoryNoggin();
      await applySeed(seedKind, n);
      if (cancelled) { await n.dispose(); return; }
      setNoggin(n);
      setNodes(projectTree(n));
      setActiveKey(n.active?.key ?? null);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-project + re-read engine state on every change.
  useEffect(() => {
    if (!noggin) return;
    const sub = noggin.onDidChange(() => {
      setNodes(projectTree(noggin));
      setActiveKey(noggin.active?.key ?? null);
    });
    return () => sub.dispose();
  }, [noggin]);

  // Selection: key is source of truth, path derives. setSelectedPath
  // resolves via the LIVE noggin so the post-verb selection look-up
  // doesn't race React's re-projection.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedPath = useMemo(
    () => (selectedKey ? findNodeByKey(nodes, selectedKey)?.path ?? null : null),
    [selectedKey, nodes],
  );
  const setSelectedPath = useCallback((path: string | null) => {
    if (!path) { setSelectedKey(null); return; }
    const live = noggin?.tryResolvePath(path);
    if (live) { setSelectedKey(live.key); return; }
    const node = findNodeByPath(nodes, path);
    setSelectedKey(node?.key ?? null);
  }, [noggin, nodes]);

  // Rename plumbing — mirrors the desktop renderer's behaviour:
  //   - `renamingIsNew` flips on for tree-driven add-then-rename
  //     (`onRequestRename(path, { isNew: true })`), off for
  //     user-driven F2/double-click renames.
  //   - On cancel of a fresh-add rename where the user didn't type
  //     anything, the row is deleted (matches "I hit Enter by accident,
  //     never mind").
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamingIsNew, setRenamingIsNew] = useState(false);
  const onRequestRename = useCallback((path: string, opts?: { isNew?: boolean }) => {
    setRenamingPath(path);
    setRenamingIsNew(opts?.isNew === true);
  }, []);
  const onRenameEnd = useCallback(async ({ committed }: { committed: boolean }) => {
    const path = renamingPath;
    const wasNew = renamingIsNew;
    setRenamingPath(null);
    setRenamingIsNew(false);
    // Only the "abandoned" path triggers the delete-fresh-empty-row
    // policy. A committed rename has already dispatched
    // actions.rename(...) — racing it with a title-empty check (and
    // then deleting) is exactly the bug NogginTree.rename-commits.ct
    // pins.
    if (!committed && wasNew && path && noggin) {
      const live = noggin.tryResolvePath(path);
      if (live && !live.title.trim()) {
        const hasKids = noggin.childrenOf(live.key).length > 0;
        await noggin.delete({ path, recursive: hasKids });
      }
    }
  }, [renamingPath, renamingIsNew, noggin]);

  // Land the initial selection (by title) once the seed has settled.
  useEffect(() => {
    if (selectedKey || nodes.length === 0) return;
    const match = flatten(nodes).find((n) => n.title === initialSelectedTitle);
    if (match) setSelectedKey(match.key);
  }, [nodes, selectedKey, initialSelectedTitle]);

  const actions = useMemo(
    () => (noggin ? createNogginActions(noggin) : null),
    [noggin],
  );

  if (!noggin || !actions) return <div data-testid="not-ready">loading…</div>;

  const selectedNode = selectedKey ? findNodeByKey(nodes, selectedKey) : null;
  const activeNode = activeKey ? findNodeByKey(nodes, activeKey) : null;

  // Encode the whole engine state in one probe so a test can pin a
  // post-action shape with one toHaveText assertion. Format:
  //   path:title[:done] | path:title …
  const itemsSummary = flatten(nodes)
    .map((n) => `${n.path}:${n.title || '(empty)'}${n.done ? ':done' : ''}`)
    .join(' | ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 12, fontFamily: 'monospace', fontSize: 12 }}>
        <span data-testid="selected-path">{selectedPath ?? '(none)'}</span>
        <span data-testid="selected-title">{selectedNode?.title ?? '(none)'}</span>
        <span data-testid="active-path">{activeNode?.path ?? '(none)'}</span>
        <span data-testid="active-title">{activeNode?.title ?? '(none)'}</span>
        <span data-testid="renaming-path">{renamingPath ?? '(none)'}</span>
        <span data-testid="item-count">{flatten(nodes).length}</span>
      </div>
      <div data-testid="items-summary" style={{ fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap' }}>
        {itemsSummary}
      </div>
      <div style={{ width: 480, height: 360 }}>
        <NogginTree
          nodes={nodes}
          fileId="desktop-sel"
          activeKey={activeKey}
          selectedPath={selectedPath}
          renamingPath={renamingPath}
          width={480}
          height={360}
          actions={actions}
          onSelect={setSelectedPath}
          onRequestRename={onRequestRename}
          onRenameEnd={onRenameEnd}
        />
      </div>
    </div>
  );
}
