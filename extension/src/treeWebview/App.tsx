// Top-level webview component: receives snapshots, posts intents,
// auto-sizes the Tree, picks a key that resets state on file switch.

import * as React from 'react';
import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import type { HostMessage, TreeSnapshot, WebviewMessage } from '../treeBridge';
import { NogginTree } from './NogginTree';

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

  return <Container snapshot={snapshot} />;
}

function Container({ snapshot }: { snapshot: TreeSnapshot }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 200, h: 400 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="noggin-tree-root">
      {!snapshot.isOpen ? (
        <Empty />
      ) : snapshot.roots.length === 0 ? (
        <EmptyOpen />
      ) : (
        <NogginTree snapshot={snapshot} width={size.w} height={size.h} />
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
