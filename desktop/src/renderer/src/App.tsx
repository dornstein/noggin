// Top-level app shell: orchestrates state, wires IPC, lays out
// sidebar / tree / details / footer / top-bar.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { noggin } from './api';
import type { CurrentTreeView, IpcResult, OpenState } from '@shared/ipc';
import { Sidebar } from './Sidebar';
import { Tree, type TreeNode, type DropZone } from './Tree';
import { Details } from './Details';
import { QuickAdd } from './QuickAdd';
import { Icon } from './Icon';

// Persistent UI prefs (sidebar / details visibility) survive reloads.
const UI_PREFS_KEY = 'noggin:ui:prefs:v1';
type UiPrefs = { sidebarOpen: boolean; detailsOpen: boolean };
function loadPrefs(): UiPrefs {
  try { return { sidebarOpen: true, detailsOpen: true, ...JSON.parse(localStorage.getItem(UI_PREFS_KEY) || '{}') }; }
  catch { return { sidebarOpen: true, detailsOpen: true }; }
}
function savePrefs(p: UiPrefs) {
  try { localStorage.setItem(UI_PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export function App() {
  const initialPrefs = useMemo(loadPrefs, []);
  const [sidebarOpen, setSidebarOpen] = useState(initialPrefs.sidebarOpen);
  const [detailsOpen, setDetailsOpen] = useState(initialPrefs.detailsOpen);
  useEffect(() => { savePrefs({ sidebarOpen, detailsOpen }); }, [sidebarOpen, detailsOpen]);

  const [openState, setOpenState] = useState<OpenState>({ location: null, exists: false });
  const [view, setView] = useState<CurrentTreeView | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const handleResult = useCallback(<T,>(r: IpcResult<T>): T | null => {
    if (r.ok) { setError(null); return r.data; }
    setError(`${r.error.code}: ${r.error.message}`);
    return null;
  }, []);

  const refresh = useCallback(async () => {
    const v = await noggin.show();
    if (v.ok) { setView(v.data); setError(null); }
    else { setView(null); setError(`${v.error.code}: ${v.error.message}`); }
  }, []);

  // Subscribe to open-state + change events from main.
  useEffect(() => {
    noggin.where().then((r) => { if (r.ok) setOpenState(r.data); });
    const unsubOpen = noggin.onDidOpenChange((state) => { setOpenState(state); });
    const unsubChange = noggin.onDidChange(() => { refresh(); });
    return () => { unsubOpen(); unsubChange(); };
  }, [refresh]);

  // Refresh tree whenever the open noggin changes.
  useEffect(() => {
    if (openState.location) refresh();
    else setView(null);
  }, [openState.location, refresh]);

  // Auto-expand the spine of the active item by default; collapse the
  // rest if the user hasn't touched them. Tracked separately from
  // user-toggled state so it doesn't fight the user.
  useEffect(() => {
    if (!view) return;
    const next: Record<string, boolean> = { ...expanded };
    let dirty = false;
    walk(view.items as TreeNode[], (n, ancestors) => {
      // Expand all ancestors of the active item by default.
      if (view.activeKey && n.key === view.activeKey) {
        for (const a of ancestors) {
          if (next[a.key] === undefined) { next[a.key] = true; dirty = true; }
        }
      }
    }, []);
    if (dirty) setExpanded(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.activeKey]);

  // ── Verb handlers ──
  const onPush = useCallback(async (title: string) => {
    handleResult(await noggin.push({ title }));
  }, [handleResult]);

  const onAdd = useCallback(async (title: string) => {
    handleResult(await noggin.add({ title }));
  }, [handleResult]);

  const onPushUnder = useCallback(async (anchorPath: string) => {
    // Equivalent to: goto anchor, then push. The engine doesn't expose
    // a single-call form yet, so we sequence them.
    const g = await noggin.goto(anchorPath);
    if (!g.ok) { handleResult(g); return; }
    const title = window.prompt(`Push a side-quest under ${anchorPath}:`);
    if (!title || !title.trim()) return;
    handleResult(await noggin.push({ title: title.trim() }));
  }, [handleResult]);

  const onAddChild = useCallback(async (anchorPath: string) => {
    const title = window.prompt(`Add a child under ${anchorPath}:`);
    if (!title || !title.trim()) return;
    handleResult(await noggin.add({ title: title.trim(), placement: { kind: 'into', anchor: anchorPath } }));
  }, [handleResult]);

  const onAddSiblingBefore = useCallback(async (anchorPath: string) => {
    const title = window.prompt(`Add a sibling above ${anchorPath}:`);
    if (!title || !title.trim()) return;
    handleResult(await noggin.add({ title: title.trim(), placement: { kind: 'before', anchor: anchorPath } }));
  }, [handleResult]);

  const onAddSiblingAfter = useCallback(async (anchorPath: string) => {
    const title = window.prompt(`Add a sibling below ${anchorPath}:`);
    if (!title || !title.trim()) return;
    handleResult(await noggin.add({ title: title.trim(), placement: { kind: 'after', anchor: anchorPath } }));
  }, [handleResult]);

  const onGoto = useCallback(async (path: string) => {
    handleResult(await noggin.goto(path));
  }, [handleResult]);

  const onToggleDone = useCallback(async (path: string, currentlyDone: boolean) => {
    if (currentlyDone) handleResult(await noggin.edit({ path, done: false }));
    else handleResult(await noggin.done({ path }));
  }, [handleResult]);

  const onPop = useCallback(async () => {
    handleResult(await noggin.pop());
  }, [handleResult]);

  const onRename = useCallback(async (path: string, title: string) => {
    handleResult(await noggin.edit({ path, title }));
  }, [handleResult]);

  const onDelete = useCallback(async (path: string, hasChildren: boolean) => {
    if (hasChildren) {
      const ok = window.confirm(`Delete ${path} and its entire subtree?`);
      if (!ok) return;
      handleResult(await noggin.delete({ path, recursive: true }));
    } else {
      const ok = window.confirm(`Delete ${path}?`);
      if (!ok) return;
      handleResult(await noggin.delete({ path }));
    }
  }, [handleResult]);

  const onMove = useCallback(async (fromPath: string, zone: DropZone, anchorPath: string) => {
    handleResult(await noggin.move({ path: fromPath, placement: { kind: zone, anchor: anchorPath } }));
  }, [handleResult]);

  const onAppendNote = useCallback(async (path: string, text: string) => {
    handleResult(await noggin.note({ path, text }));
  }, [handleResult]);

  const onAddNote = useCallback((path: string) => {
    setSelectedPath(path);
    setDetailsOpen(true);
  }, []);

  const onCloseNoggin = useCallback(async () => {
    handleResult(await noggin.close());
  }, [handleResult]);

  const onToggleExpand = useCallback((key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
  }, []);

  // ── Global keyboard shortcuts ──
  // F2 = rename selected, Delete = delete selected, Ctrl+Enter = toggle done on selected,
  // Ctrl+B = toggle sidebar, Ctrl+J = toggle details, Ctrl+O = open file dialog.
  const tree = view?.items as TreeNode[] | undefined;
  const selectedNode = useMemo(() => {
    if (!tree || !selectedPath) return null;
    return findByPath(tree, selectedPath);
  }, [tree, selectedPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput = target && /^(INPUT|TEXTAREA)$/.test(target.tagName);

      if (e.key === 'b' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); setSidebarOpen((v) => !v); return;
      }
      if (e.key === 'j' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); setDetailsOpen((v) => !v); return;
      }
      if (e.key === 'o' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        noggin.recents.pickFile().then((r) => {
          if (r.ok && r.data) noggin.open(r.data);
        });
        return;
      }

      if (inInput || !selectedNode) return;

      if (e.key === 'Delete') {
        e.preventDefault();
        onDelete(selectedNode.path, !!selectedNode.children?.length);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onToggleDone(selectedNode.path, selectedNode.done);
      } else if (e.key === 'g' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onGoto(selectedNode.path);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNode, onDelete, onToggleDone, onGoto]);

  // ── Render ──
  const hasActive = !!view?.activeKey;
  const displayLocation = openState.location ?? '(no noggin open)';

  return (
    <div className={`app${sidebarOpen ? '' : ' sidebar-closed'}${detailsOpen ? '' : ' details-closed'}`}>
      <div className="topbar">
        <button
          className="iconbtn topbar-toggle"
          onClick={() => setSidebarOpen((v) => !v)}
          title={`${sidebarOpen ? 'Hide' : 'Show'} sidebar (Ctrl+B)`}
        >
          <Icon name="layout-sidebar-left" />
        </button>
        <div className="topbar-location" title={openState.location || ''}>
          <Icon name="file" className="topbar-file-icon" />
          <span>{displayLocation}</span>
          {!openState.exists && openState.location && (
            <span className="topbar-warn" title="File doesn't exist">
              <Icon name="warning" />
            </span>
          )}
        </div>
        <div className="topbar-actions">
          {openState.location && (
            <button
              className="iconbtn"
              onClick={onCloseNoggin}
              title="Close this noggin"
            >
              <Icon name="close" />
            </button>
          )}
          <button
            className="iconbtn topbar-toggle"
            onClick={() => setDetailsOpen((v) => !v)}
            title={`${detailsOpen ? 'Hide' : 'Show'} details (Ctrl+J)`}
          >
            <Icon name="layout-sidebar-right" />
          </button>
        </div>
      </div>

      <div className="workspace">
        {sidebarOpen && (
          <Sidebar openLocation={openState.location} onError={setError} />
        )}

        <main className="main">
          {error && (
            <div className="banner banner-error" onClick={() => setError(null)}>
              <Icon name="error" />
              <span>{error}</span>
              <Icon name="close" />
            </div>
          )}

          <div className="treepane">
            {!openState.location ? (
              <EmptyState />
            ) : !view || view.items.length === 0 ? (
              <div className="empty">
                <Icon name="lightbulb" className="empty-icon" />
                <div className="empty-title">No items yet</div>
                <div className="empty-hint">Push a side-quest below to begin.</div>
              </div>
            ) : (
              <Tree
                nodes={view.items as TreeNode[]}
                activeKey={view.activeKey ?? null}
                selectedPath={selectedPath}
                expanded={expanded}
                onToggleExpand={onToggleExpand}
                onSelect={setSelectedPath}
                onGoto={onGoto}
                onToggleDone={onToggleDone}
                onAddChild={onAddChild}
                onRename={onRename}
                onDelete={onDelete}
                onMove={onMove}
                onAddSiblingBefore={onAddSiblingBefore}
                onAddSiblingAfter={onAddSiblingAfter}
                onPushUnder={onPushUnder}
                onAddNote={onAddNote}
              />
            )}
          </div>

          <QuickAdd
            hasActive={hasActive}
            onPush={onPush}
            onAdd={onAdd}
            onPop={onPop}
          />
        </main>

        <Details
          node={selectedNode ?? (hasActive ? findByKey(tree ?? [], view!.activeKey!) : null)}
          visible={detailsOpen}
          onAppendNote={onAppendNote}
          onToggleDone={onToggleDone}
          onGoto={onGoto}
          onClose={() => setDetailsOpen(false)}
        />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <Icon name="folder-opened" className="empty-icon" />
      <div className="empty-title">No noggin open</div>
      <div className="empty-hint">Open a noggin from the sidebar, or press Ctrl+O.</div>
    </div>
  );
}

function findByPath(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children) {
      const found = findByPath(n.children, path);
      if (found) return found;
    }
  }
  return null;
}

function findByKey(nodes: TreeNode[], key: string): TreeNode | null {
  for (const n of nodes) {
    if (n.key === key) return n;
    if (n.children) {
      const found = findByKey(n.children, key);
      if (found) return found;
    }
  }
  return null;
}

function walk(
  nodes: TreeNode[],
  visit: (n: TreeNode, ancestors: TreeNode[]) => void,
  ancestors: TreeNode[],
): void {
  for (const n of nodes) {
    visit(n, ancestors);
    if (n.children) walk(n.children, visit, [...ancestors, n]);
  }
}
