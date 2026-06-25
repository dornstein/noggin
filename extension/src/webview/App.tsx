// Webview-side App.
//
// Mounts @noggin/ui components against a `RemoteNoggin` driven over
// the tagged-envelope transport. The location comes from the host
// via `{ kind: 'session', location }` frames; whenever it changes we
// open the new noggin and dispose the old one.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';

import {
  NogginTree,
  NogginDetails,
  type NogginNode,
  type NogginDetailsItem,
} from '@noggin/ui';
import {
  openRemoteNoggin,
  type NogginClient,
} from '@noggin/ui/remote';
import { RpcClient } from '@noggin/rpc';
import type { Transport } from '@noggin/rpc';
import { executeGesture } from '@noggin/ui/gestures';
import type {
  ChangeEvent,
  Item,
  NogginError,
} from '../../skills/noggin/noggin-api.mjs';
import { isRpcFrame, type HostFrame, type WebviewFrame } from '../shared-webview-protocol';

declare function acquireVsCodeApi(): { postMessage: (m: WebviewFrame) => void };
const vscode = acquireVsCodeApi();

// ── Transport ────────────────────────────────────────────────────────

const post = (m: WebviewFrame) => vscode.postMessage(m);

function createWebviewRpcTransport(): Transport {
  const onMessageHandlers: Array<(msg: unknown) => void> = [];
  const onDisconnectHandlers: Array<() => void> = [];
  window.addEventListener('message', (ev: MessageEvent<HostFrame>) => {
    if (!isRpcFrame(ev.data)) return;
    for (const h of onMessageHandlers) h(ev.data.payload);
  });
  return {
    send: (message) => post({ kind: 'rpc', payload: message }),
    onMessage: (h) => {
      onMessageHandlers.push(h as (m: unknown) => void);
      return { dispose: () => {
        const i = onMessageHandlers.indexOf(h as (m: unknown) => void);
        if (i >= 0) onMessageHandlers.splice(i, 1);
      } };
    },
    onDisconnect: (h) => {
      onDisconnectHandlers.push(h);
      return { dispose: () => {
        const i = onDisconnectHandlers.indexOf(h);
        if (i >= 0) onDisconnectHandlers.splice(i, 1);
      } };
    },
    close: () => {
      for (const h of onDisconnectHandlers.splice(0)) { try { h(); } catch { /* swallow */ } }
    },
  };
}

let cachedClient: RpcClient | null = null;
function getRpcClient(): RpcClient {
  if (cachedClient) return cachedClient;
  cachedClient = new RpcClient(createWebviewRpcTransport());
  return cachedClient;
}

// ── Tree projection (mirrors desktop) ───────────────────────────────

function projectTree(noggin: NogginClient): NogginNode[] {
  const items = noggin.items as readonly Item[];
  const byParent = new Map<string | null, Item[]>();
  for (const it of items) {
    const key = it.parentKey ?? null;
    const list = byParent.get(key);
    if (list) list.push(it);
    else byParent.set(key, [it]);
  }
  function build(parentKey: string | null, prefix: string): NogginNode[] {
    const kids = byParent.get(parentKey) || [];
    return kids.map((item, i) => {
      const path = `${prefix}/${i + 1}`;
      return {
        key: item.key,
        path,
        title: item.title,
        done: item.done,
        noteCount: Array.isArray(item.notes) ? item.notes.length : 0,
        children: build(item.key, path),
      };
    });
  }
  return build(null, '');
}

// ── Hook ─────────────────────────────────────────────────────────────

function useSessionLocation(): string | null {
  const [location, setLocation] = useState<string | null>(null);
  useEffect(() => {
    function onMessage(ev: MessageEvent<HostFrame>) {
      const f = ev.data;
      if (f?.kind === 'session') setLocation(f.location);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return location;
}

interface NogginState {
  noggin: NogginClient | null;
  nodes: NogginNode[];
  activeKey: string | null;
  activePath: string | null;
  error: string | null;
  setError(msg: string | null): void;
}

function useNogginState(location: string | null): NogginState {
  const [noggin, setNoggin] = useState<NogginClient | null>(null);
  const [nodes, setNodes] = useState<NogginNode[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const subRef = useRef<{ dispose(): void } | null>(null);
  const errorSubRef = useRef<{ dispose(): void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let opened: NogginClient | null = null;

    async function run() {
      if (subRef.current) { subRef.current.dispose(); subRef.current = null; }
      if (errorSubRef.current) { errorSubRef.current.dispose(); errorSubRef.current = null; }
      if (!location) {
        setNoggin(null); setNodes([]); setActiveKey(null); setActivePath(null); setError(null);
        return;
      }
      try {
        const client = getRpcClient();
        const n = await openRemoteNoggin({ client, location });
        if (cancelled) { await n.dispose(); return; }
        opened = n;
        const tree = projectTree(n);
        setNoggin(n);
        setNodes(tree);
        const a = n.active;
        setActiveKey(a ? a.key : null);
        setActivePath(a ? n.pathOf(a) : null);
        setError(null);
        subRef.current = n.onDidChange((_changes: ChangeEvent) => {
          // Full re-projection on every change — the extension webview is
          // small and snapshots are cheap. (Desktop uses incremental
          // applyChanges for perf; we keep parity later if profiling
          // demands it.)
          const t2 = projectTree(n);
          setNodes(t2);
          const a2 = n.active;
          setActiveKey(a2 ? a2.key : null);
          setActivePath(a2 ? n.pathOf(a2) : null);
        });
        errorSubRef.current = n.onDidError((err: NogginError) => setError(err.message));
      } catch (err) {
        if (cancelled) return;
        setNoggin(null); setNodes([]); setActiveKey(null); setActivePath(null);
        setError((err as Error).message ?? String(err));
      }
    }

    void run();
    return () => {
      cancelled = true;
      if (subRef.current) { subRef.current.dispose(); subRef.current = null; }
      if (errorSubRef.current) { errorSubRef.current.dispose(); errorSubRef.current = null; }
      if (opened) void opened.dispose();
    };
  }, [location]);

  return { noggin, nodes, activeKey, activePath, error, setError };
}

// ── App ──────────────────────────────────────────────────────────────

export function App(): ReactElement {
  const location = useSessionLocation();
  const { noggin, nodes, activeKey, activePath, error, setError } = useNogginState(location);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedPath = useMemo(
    () => (selectedKey ? findPath(nodes, selectedKey) : null),
    [selectedKey, nodes],
  );
  const setSelectedPath = useCallback((path: string | null) => {
    if (!path) { setSelectedKey(null); return; }
    const node = findByPath(nodes, path);
    setSelectedKey(node?.key ?? null);
  }, [nodes]);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamingIsNew, setRenamingIsNew] = useState(false);
  const [pendingRenameKey, setPendingRenameKey] = useState<string | null>(null);
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingRenameKey) return;
    const path = findPath(nodes, pendingRenameKey);
    if (path) {
      setRenamingPath(path);
      setRenamingIsNew(true);
      setSelectedKey(pendingRenameKey);
      setPendingRenameKey(null);
    }
  }, [pendingRenameKey, nodes]);

  useEffect(() => {
    if (!pendingFocusKey) return;
    if (!findPath(nodes, pendingFocusKey)) return;
    setSelectedKey(pendingFocusKey);
    setPendingFocusKey(null);
  }, [pendingFocusKey, nodes]);

  const runVerb = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    if (!noggin) return null;
    try { return await fn(); }
    catch (err) {
      setError((err as Error).message ?? String(err));
      return null;
    }
  }, [noggin, setError]);

  const onGoto = useCallback((path: string) => runVerb(() => noggin!.goto({ path })), [noggin, runVerb]);
  const onActivate = useCallback((path: string) => {
    setSelectedPath(path);
    return onGoto(path);
  }, [onGoto, setSelectedPath]);
  const onToggleDone = useCallback(async (path: string, currentlyDone: boolean) => {
    if (currentlyDone) await runVerb(() => noggin!.edit({ path, done: false }));
    else await runVerb(() => noggin!.done({ path }));
  }, [noggin, runVerb]);
  const onMove = useCallback((intent: { fromPath: string; kind: 'before' | 'after' | 'into'; anchorPath: string }) =>
    runVerb(() => noggin!.move({
      path: intent.fromPath,
      placement: { kind: intent.kind, anchor: intent.anchorPath },
    })), [noggin, runVerb]);
  const onGesture = useCallback(async (path: string, gesture: import('@noggin/ui').TreeGesture) => {
    if (!noggin) return;
    if (gesture === 'rename') { setRenamingPath(path); setRenamingIsNew(false); return; }
    const result = await runVerb(() => executeGesture(noggin, nodes, path, gesture));
    if (!result) return;
    if (result.newKey) setPendingRenameKey(result.newKey);
    if (result.movedKey) setPendingFocusKey(result.movedKey);
  }, [noggin, nodes, runVerb]);

  const onAppendNote = useCallback((path: string, text: string) =>
    runVerb(() => noggin!.note({ path, text })), [noggin, runVerb]);

  const onRetitle = useCallback((path: string, title: string) =>
    runVerb(() => noggin!.edit({ path, title })), [noggin, runVerb]);

  const onRenameSubmit = useCallback(async (path: string, title: string) => {
    setRenamingPath(null);
    setRenamingIsNew(false);
    await runVerb(() => noggin!.edit({ path, title }));
  }, [noggin, runVerb]);

  const onRenameCancel = useCallback(async () => {
    const p = renamingPath;
    const wasNew = renamingIsNew;
    setRenamingPath(null);
    setRenamingIsNew(false);
    if (wasNew && p && noggin) {
      const live = noggin.tryResolvePath(p);
      if (live && !live.title.trim()) {
        const hasKids = noggin.childrenOf(live.key).length > 0;
        await runVerb(() => noggin.delete({ path: p, recursive: hasKids }));
      }
    }
  }, [renamingPath, renamingIsNew, noggin, runVerb]);

  const onAddFirstItem = useCallback(async (title?: string) => {
    if (!noggin) return;
    const trimmed = (title ?? '').trim();
    if (trimmed) {
      const r = await runVerb(() => noggin.push({ title: trimmed }));
      if (r?.targetKey) setPendingFocusKey(r.targetKey);
    } else {
      const r = await runVerb(() => noggin.add({ title: '' }));
      if (r?.targetKey) setPendingRenameKey(r.targetKey);
    }
  }, [noggin, runVerb]);

  // Details target: selected path if any, otherwise active.
  const detailsItem: NogginDetailsItem | null = useMemo(() => {
    if (!noggin) return null;
    const target = selectedPath ?? activePath;
    if (!target) return null;
    const node = findByPath(nodes, target);
    if (!node) return null;
    const parent = findParent(nodes, target);
    const siblings = parent?.children ?? nodes;
    const idx = siblings.findIndex((s) => s.path === target);
    const live = noggin.findByKey(node.key);
    const notes = live?.notes ? [...live.notes] : [];
    return {
      key: node.key,
      path: node.path,
      title: node.title,
      done: node.done,
      notes,
      isActive: node.key === activeKey,
      hasPrevSibling: idx > 0,
      hasNextSibling: idx >= 0 && idx < siblings.length - 1,
    };
  }, [noggin, selectedPath, activePath, activeKey, nodes]);

  // ── Render ────────────────────────────────────────────────────
  if (location === null) {
    return (
      <Welcome
        onNew={() => post({ kind: 'session-request', action: 'newFile' })}
        onOpen={() => post({ kind: 'session-request', action: 'openFile' })}
        onWorkspace={() => post({ kind: 'session-request', action: 'openWorkspaceNoggin' })}
      />
    );
  }

  return (
    <div className="noggin-webview">
      {error && (
        <div className="noggin-banner" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      <div className="noggin-tree-pane">
        {nodes.length === 0 ? (
          <EmptyTree onAdd={onAddFirstItem} />
        ) : (
          <NogginTree
            nodes={nodes}
            fileId={location}
            activeKey={activeKey}
            selectedPath={selectedPath}
            renamingPath={renamingPath}
            onSelect={setSelectedPath}
            onActivate={onActivate}
            onToggleDone={onToggleDone}
            onMove={onMove}
            onRequestRename={(p) => setRenamingPath(p)}
            onRenameSubmit={onRenameSubmit}
            onRenameCancel={onRenameCancel}
            onGesture={onGesture}
          />
        )}
      </div>

      <div className="noggin-details-pane">
        <NogginDetails
          item={detailsItem}
          onToggleDone={onToggleDone}
          onGoto={onActivate}
          onAppendNote={onAppendNote}
          onRetitle={onRetitle}
          onGesture={onGesture}
        />
      </div>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────

function Welcome({ onNew, onOpen, onWorkspace }: {
  onNew: () => void;
  onOpen: () => void;
  onWorkspace: () => void;
}): ReactElement {
  return (
    <div className="noggin-empty">
      <p>No noggin is open.</p>
      <button onClick={onNew}>New…</button>
      <button onClick={onOpen}>Open File…</button>
      <button onClick={onWorkspace}>Open Workspace Noggin</button>
    </div>
  );
}

function EmptyTree({ onAdd }: { onAdd: (title?: string) => void }): ReactElement {
  const [value, setValue] = useState('');
  return (
    <div className="noggin-empty">
      <p>Your noggin is empty.</p>
      <form onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (!v) return;
        onAdd(v);
        setValue('');
      }}>
        <input
          type="text"
          autoFocus
          placeholder="What's on your mind?"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" disabled={!value.trim()}>Add</button>
      </form>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function findByPath(nodes: NogginNode[], path: string): NogginNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    const f = findByPath(n.children, path);
    if (f) return f;
  }
  return null;
}

function findParent(nodes: NogginNode[], childPath: string, parent: NogginNode | null = null): NogginNode | null {
  for (const n of nodes) {
    if (n.path === childPath) return parent;
    const f = findParent(n.children, childPath, n);
    if (f !== null) return f;
  }
  return null;
}

function findPath(nodes: NogginNode[], key: string): string | null {
  for (const n of nodes) {
    if (n.key === key) return n.path;
    const f = findPath(n.children, key);
    if (f) return f;
  }
  return null;
}
