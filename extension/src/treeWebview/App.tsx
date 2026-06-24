// Webview entry: top-level component that bridges host snapshots to the
// @noggin/ui <NogginTree>. Single source of truth for the tree component
// lives in the @noggin/ui package; the webview's job is wire-protocol
// translation.

import { useEffect, useMemo, useState } from 'react';
import { NogginTree, type NogginNode, type NogginMoveIntent } from '@noggin/ui';
import '@noggin/ui/styles.css';
import type { HostMessage, TreeSnapshot, WebviewMessage, TreeNodeData } from '../treeBridge';

// vscode acquired once per webview lifetime.
declare function acquireVsCodeApi(): { postMessage: (m: WebviewMessage) => void };
const vscode = acquireVsCodeApi();
export const post = (m: WebviewMessage) => vscode.postMessage(m);

const EMPTY_SNAPSHOT: TreeSnapshot = { isOpen: false, activePath: null, fileId: null, roots: [] };

export function App() {
  const [snapshot, setSnapshot] = useState<TreeSnapshot>(EMPTY_SNAPSHOT);

  useEffect(() => {
    function onMessage(e: MessageEvent<HostMessage>) {
      const msg = e.data;
      if (msg?.type === 'snapshot') setSnapshot(msg.snapshot);
    }
    window.addEventListener('message', onMessage);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const nodes = useMemo<NogginNode[]>(
    () => snapshot.roots.map(toNogginNode),
    [snapshot.roots],
  );
  const activeKey = useMemo(
    () => findActiveKey(nodes, snapshot.activePath),
    [nodes, snapshot.activePath],
  );

  return (
    <div className="noggin-tree-root">
      {!snapshot.isOpen ? (
        <Empty />
      ) : nodes.length === 0 ? (
        <EmptyOpen />
      ) : (
        <NogginTree
          nodes={nodes}
          fileId={snapshot.fileId}
          activeKey={activeKey}
          rowActions={false}
          onGoto={(path) => post({ type: 'invoke', command: 'noggin.goto', path })}
          onToggleDone={(path) => post({ type: 'invoke', command: 'noggin.toggleDone', path })}
          onMove={(intent: NogginMoveIntent) =>
            post({
              type: 'move',
              fromPath: intent.fromPath,
              kind: intent.kind,
              anchorPath: intent.anchorPath,
            })
          }
        />
      )}
    </div>
  );
}

function Empty() {
  return (
    <div className="noggin-empty">
      <p>No noggin is open.</p>
      <button onClick={() => post({ type: 'invoke', command: 'noggin.new' })}>New…</button>
      <button onClick={() => post({ type: 'invoke', command: 'noggin.openFile' })}>Open File…</button>
      <button onClick={() => post({ type: 'invoke', command: 'noggin.openWorkspaceNoggin' })}>Open Workspace Noggin</button>
    </div>
  );
}

function EmptyOpen() {
  return (
    <div className="noggin-empty">
      <p>Your noggin is empty.</p>
      <button onClick={() => post({ type: 'invoke', command: 'noggin.push' })}>Push…</button>
      <button onClick={() => post({ type: 'invoke', command: 'noggin.add' })}>Add…</button>
    </div>
  );
}

function toNogginNode(n: TreeNodeData): NogginNode {
  return {
    key: n.id,
    path: n.path,
    title: n.title,
    done: n.done,
    noteCount: n.noteCount,
    children: n.children.map(toNogginNode),
  };
}

function findActiveKey(nodes: NogginNode[], activePath: string | null): string | null {
  if (!activePath) return null;
  for (const n of nodes) {
    if (n.path === activePath) return n.key;
    const f = findActiveKey(n.children, activePath);
    if (f) return f;
  }
  return null;
}
