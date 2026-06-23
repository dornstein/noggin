import { useCallback, useEffect, useRef, useState } from 'react';
import { noggin } from './api';
import type { CurrentTreeView, IpcResult } from '@shared/ipc';

type ViewNode = {
  key: string;
  path: string;
  title: string;
  done: boolean;
  notes?: { timestamp: string; text: string }[];
  children?: ViewNode[];
};

/**
 * Tiny in-renderer error surface. The IPC layer always returns an
 * envelope; this hook gives us a single place to surface failures
 * without dropping them.
 */
function useIpcCall<T>() {
  const [error, setError] = useState<string | null>(null);
  const call = useCallback(async (p: Promise<IpcResult<T>>): Promise<T | null> => {
    const r = await p;
    if (r.ok) {
      setError(null);
      return r.data;
    }
    setError(`${r.error.code}: ${r.error.message}`);
    return null;
  }, []);
  return { call, error, clearError: () => setError(null) };
}

export function App() {
  const [location, setLocation] = useState<string | null>(null);
  const [view, setView] = useState<CurrentTreeView | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { call, error, clearError } = useIpcCall<any>();

  const refresh = useCallback(async () => {
    const [w, v] = await Promise.all([
      call(noggin.where()),
      call(noggin.show()),
    ]);
    if (w !== null) setLocation(w as string | null);
    if (v !== undefined) setView((v as CurrentTreeView | null) ?? null);
  }, [call]);

  useEffect(() => {
    refresh();
    const unsub = noggin.onDidChange(() => { refresh(); });
    return () => { unsub(); };
  }, [refresh]);

  const onPush = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    const r = await call(noggin.push({ title }));
    if (r) setDraft('');
    // refresh happens via onDidChange but call it once eagerly for snappier UX.
    refresh();
    inputRef.current?.focus();
  }, [draft, call, refresh]);

  const onDone = useCallback(async (path: string) => {
    await call(noggin.done({ path }));
    refresh();
  }, [call, refresh]);

  const onGoto = useCallback(async (path: string) => {
    await call(noggin.goto(path));
    refresh();
  }, [call, refresh]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="title">noggin</div>
        <div className="location" title={location ?? ''}>{location ?? '(no file)'}</div>
      </header>

      {error && (
        <div className="error" onClick={clearError} role="alert">
          {error}
          <span className="error-dismiss">×</span>
        </div>
      )}

      <form className="quick-add" onSubmit={onPush}>
        <input
          ref={inputRef}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Push a side-quest…"
          aria-label="Push a new item"
        />
        <button type="submit" disabled={!draft.trim()}>Push</button>
      </form>

      <main className="tree">
        {view && view.items.length > 0 ? (
          <Tree
            nodes={view.items as ViewNode[]}
            activeKey={view.activeKey ?? null}
            onDone={onDone}
            onGoto={onGoto}
          />
        ) : (
          <div className="empty">No items yet. Push a side-quest above to start.</div>
        )}
      </main>
    </div>
  );
}

function Tree(props: {
  nodes: ViewNode[];
  activeKey: string | null;
  onDone: (path: string) => void;
  onGoto: (path: string) => void;
}) {
  return (
    <ul className="tree-list">
      {props.nodes.map((n) => (
        <TreeRow key={n.key} node={n} {...props} />
      ))}
    </ul>
  );
}

function TreeRow({
  node,
  activeKey,
  onDone,
  onGoto,
}: {
  node: ViewNode;
  activeKey: string | null;
  onDone: (path: string) => void;
  onGoto: (path: string) => void;
}) {
  const isActive = node.key === activeKey;
  return (
    <li className={`row${isActive ? ' active' : ''}${node.done ? ' done' : ''}`}>
      <div className="row-inner">
        <span className="path" onClick={() => onGoto(node.path)}>{node.path}</span>
        {isActive && <span className="badge">📍</span>}
        {node.done && <span className="badge">✅</span>}
        <span className="title">{node.title}</span>
        {!node.done && (
          <button className="row-action" onClick={() => onDone(node.path)} title="Mark done">
            done
          </button>
        )}
      </div>
      {node.children && node.children.length > 0 && (
        <ul className="tree-list">
          {node.children.map((c) => (
            <TreeRow key={c.key} node={c} activeKey={activeKey} onDone={onDone} onGoto={onGoto} />
          ))}
        </ul>
      )}
    </li>
  );
}
