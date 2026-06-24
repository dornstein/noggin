// Top-level desktop app shell. Holds the noggin engine in-process,
// composes @noggin/ui components, talks to shell.* for native dialogs.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Icon,
  NogginTree,
  NogginDetails,
  type NogginDetailsItem,
  type NogginMoveIntent,
  type TreeGesture,
} from '@noggin/ui';
import { useNogginState, verbs, projectTree } from './noggin';
import { useRecents } from './recents';
import { shell } from './shell';
import { Sidebar } from './Sidebar';
import { Splitter } from './Splitter';
import { MainMenu, type DetailsLocation } from './MainMenu';
import { executeGesture } from '@noggin/ui';
import type { MenuAction, MenuState } from '@shared/ipc';

const UI_PREFS_KEY = 'noggin:ui:prefs:v2';

interface UiPrefs {
  sidebarOpen: boolean;
  sidebarWidth: number;
  detailsLocation: DetailsLocation;
  detailsRightWidth: number;
  detailsBelowHeight: number;
}

const DEFAULT_PREFS: UiPrefs = {
  sidebarOpen: true,
  sidebarWidth: 220,
  detailsLocation: 'right',
  detailsRightWidth: 340,
  detailsBelowHeight: 260,
};

function loadPrefs(): UiPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(UI_PREFS_KEY) || '{}');
    return { ...DEFAULT_PREFS, ...raw };
  } catch { return DEFAULT_PREFS; }
}
function savePrefs(p: UiPrefs) {
  try { localStorage.setItem(UI_PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export interface AppProps {
  /** Where to open on first mount. File path or memory:// URL. */
  initialLocation: string;
}

export function App({ initialLocation }: AppProps) {
  const initial = useMemo(loadPrefs, []);
  const [sidebarOpen, setSidebarOpen] = useState(initial.sidebarOpen);
  const [sidebarWidth, setSidebarWidth] = useState(initial.sidebarWidth);
  const [detailsLocation, setDetailsLocation] = useState<DetailsLocation>(initial.detailsLocation);
  const [detailsRightWidth, setDetailsRightWidth] = useState(initial.detailsRightWidth);
  const [detailsBelowHeight, setDetailsBelowHeight] = useState(initial.detailsBelowHeight);

  useEffect(() => {
    savePrefs({ sidebarOpen, sidebarWidth, detailsLocation, detailsRightWidth, detailsBelowHeight });
  }, [sidebarOpen, sidebarWidth, detailsLocation, detailsRightWidth, detailsBelowHeight]);

  const state = useNogginState(initialLocation);
  const { noggin, nodes, activeKey, activePath, openState, error, setError, open: openNoggin, close: closeNoggin } = state;

  const recents = useRecents(openState.location);

  // Cache the open noggin's active path + title in the recents store
  // so the sidebar can render it even after the noggin is closed.
  useEffect(() => {
    if (!openState.location) return;
    const title = activeKey && noggin ? (noggin.findByKey(activeKey)?.title ?? null) : null;
    recents.setActive(openState.location, activePath, title);
  }, [openState.location, activeKey, activePath, noggin, nodes, recents]);

  // Selection is anchored by KEY, not path. Paths are positional so
  // any structural change elsewhere in the tree (an add, a move) can
  // silently re-interpret a stored path string \u2014 e.g. selectedPath
  // '/1/5' was "juice"; after Ctrl+Home elsewhere it's now "jackls".
  // We store the key, derive the path from it on every render. If
  // the key disappears (delete), selectedPath naturally goes null.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedPath = useMemo(
    () => (selectedKey ? findPath(nodes, selectedKey) : null),
    [selectedKey, nodes],
  );
  // Wrapper to preserve the old "set by path" API surface used by
  // arborist click/focus callbacks. Converts path \u2192 key at call time.
  const setSelectedPath = useCallback((path: string | null) => {
    if (!path) { setSelectedKey(null); return; }
    const node = findByPath(nodes, path);
    setSelectedKey(node?.key ?? null);
  }, [nodes]);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  // `renamingIsNew` is true only when the row was just created by an
  // add gesture. Cancelling (Esc, or blur with empty input) on such a
  // row deletes it — the user changed their mind. Cancelling a manual
  // F2 rename, by contrast, just abandons the edit and keeps the title.
  const [renamingIsNew, setRenamingIsNew] = useState(false);
  const [pendingRenameKey, setPendingRenameKey] = useState<string | null>(null);
  // Set after a move gesture so we can re-focus the moved item once
  // its new path settles in the projected tree.
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const mainRef = useRef<HTMLElement | null>(null);
  const [mainSize, setMainSize] = useState({ w: 1000, h: 700 });
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const update = () => setMainSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setDetailsRightWidth((w) => clamp(w, 220, Math.max(240, mainSize.w - 220)));
    setDetailsBelowHeight((h) => clamp(h, 140, Math.max(160, mainSize.h - 180)));
  }, [mainSize.w, mainSize.h]);

  // Promote pendingRenameKey → renamingPath once the new node appears
  // in the projected tree. Mark renamingIsNew so cancel→delete works.
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

  // After a move gesture, the path of the focused item changes. Update
  // selection by key so the next keystroke targets the same logical
  // item rather than whatever's now sitting at the old path.
  useEffect(() => {
    if (!pendingFocusKey) return;
    // The projected nodes may not yet reflect the move; only commit
    // once the key resolves to a path.
    if (!findPath(nodes, pendingFocusKey)) return;
    setSelectedKey(pendingFocusKey);
    setPendingFocusKey(null);
  }, [pendingFocusKey, nodes]);

  // ── Verb wrappers (call into the live noggin) ──────────────────────
  // We pass the noggin to verbs.X directly; the engine mutates it,
  // emits onDidChange, and our hook re-projects.

  const runVerb = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    if (!noggin) return null;
    try { return await fn(); }
    catch (err) {
      const e = err as Error;
      setError(e?.message ?? String(err));
      return null;
    }
  }, [noggin, setError]);

  const onGoto = useCallback((path: string) => runVerb(() => verbs.goto(noggin!, { path })), [noggin, runVerb]);

  // Activating an item (the pin click, or the Details pane's Goto
  // button) should also pull selection/focus to that row \u2014 the user
  // has clearly expressed intent that this item is "where I am".
  const onActivate = useCallback((path: string) => {
    setSelectedPath(path);
    return onGoto(path);
  }, [onGoto]);

  const onToggleDone = useCallback(async (path: string, currentlyDone: boolean) => {
    if (currentlyDone) await runVerb(() => verbs.edit(noggin!, { path, done: false }));
    else await runVerb(() => verbs.done(noggin!, { path }));
  }, [noggin, runVerb]);

  const onMove = useCallback((intent: NogginMoveIntent) =>
    runVerb(() => verbs.move(noggin!, {
      path: intent.fromPath,
      placement: { kind: intent.kind, anchor: intent.anchorPath },
    })), [noggin, runVerb]);

  // Single dispatch point for every tree-row keyboard gesture. Mouse
  // hover actions (+ / trash icons) still call their dedicated
  // callbacks below for clarity, but those reduce to the same set of
  // engine verbs.
  const onGesture = useCallback(async (path: string, gesture: TreeGesture) => {
    if (!noggin) return;
    if (gesture === 'rename') { setRenamingPath(path); setRenamingIsNew(false); return; }

    // Pre-compute the focus target for `delete`: the row that should
    // receive focus once the current one is gone. Try next sibling,
    // then previous sibling, then parent. Falls back to no-focus when
    // the tree becomes empty.
    let postDeleteFocusKey: string | null = null;
    if (gesture === 'delete') {
      const node = findByPath(nodes, path);
      if (node) {
        const parent = findParent(nodes, path);
        const siblings = parent?.children ?? nodes;
        const idx = siblings.findIndex((s) => s.path === path);
        const fallback = siblings[idx + 1] ?? siblings[idx - 1] ?? parent ?? null;
        postDeleteFocusKey = fallback?.key ?? null;
      }
    }

    const result = await runVerb(() => executeGesture(noggin, nodes, path, gesture));
    if (!result) return;
    if (result.newKey) {
      // New items go straight into inline-rename mode. The effect
      // watching `pendingRenameKey` flips it to `renamingPath` once
      // the new item appears in the projected tree.
      setPendingRenameKey(result.newKey);
    }
    if (result.movedKey) {
      // After move the path changes; remember the key so the effect
      // can refocus the row at its new location.
      setPendingFocusKey(result.movedKey);
    }
    if (gesture === 'delete') {
      // Selection landed on a row that no longer exists; clear it
      // immediately, then move focus to the fallback once the tree
      // re-renders.
      setSelectedPath(null);
      if (postDeleteFocusKey) setPendingFocusKey(postDeleteFocusKey);
    }
    if (gesture === 'toggleDone') {
      // The path didn't change; re-assert selection so the focus
      // effect re-runs after the projected nodes update (the path
      // string is identical so a naive setState wouldn't trigger,
      // but routing through pendingFocusKey forces a fresh assert).
      const node = findByPath(nodes, path);
      if (node) setPendingFocusKey(node.key);
    }
  }, [noggin, nodes, runVerb]);

  const onAddChild = useCallback(async (anchorPath: string) => {
    await onGesture(anchorPath, 'addChild');
  }, [onGesture]);

  // Empty-tree CTA: create the first root item. If the user submitted
  // a title from the empty-state input, save it directly; otherwise
  // create with an empty title and drop into rename mode.
  const onAddFirstItem = useCallback(async (title?: string) => {
    if (!noggin) return;
    const trimmed = (title ?? '').trim();
    const result = await runVerb(() => verbs.add(noggin, { title: trimmed }));
    if (result?.targetKey && !trimmed) setPendingRenameKey(result.targetKey);
  }, [noggin, runVerb]);

  const onDelete = useCallback(async (path: string, hasChildren: boolean) => {
    const msg = hasChildren ? `Delete ${path} and its entire subtree?` : `Delete ${path}?`;
    if (!window.confirm(msg)) return;
    await onGesture(path, 'delete');
  }, [onGesture]);

  const onAppendNote = useCallback((path: string, text: string) =>
    runVerb(() => verbs.note(noggin!, { path, text })), [noggin, runVerb]);

  const onRetitle = useCallback((path: string, title: string) =>
    runVerb(() => verbs.edit(noggin!, { path, title })), [noggin, runVerb]);

  const onReorder = useCallback(async (path: string, direction: 'before' | 'after') => {
    if (!noggin) return;
    const node = findByPath(nodes, path);
    if (!node) return;
    const parent = findParent(nodes, path);
    const siblings = parent?.children ?? nodes;
    const idx = siblings.findIndex((s) => s.path === path);
    const anchor = direction === 'before' ? siblings[idx - 1] : siblings[idx + 1];
    if (!anchor) return;
    await runVerb(() => verbs.move(noggin, { path, placement: { kind: direction, anchor: anchor.path } }));
  }, [noggin, nodes, runVerb]);

  const onRenameSubmit = useCallback(async (path: string, title: string) => {
    setRenamingPath(null);
    setRenamingIsNew(false);
    await runVerb(() => verbs.edit(noggin!, { path, title }));
  }, [noggin, runVerb]);

  const onRenameCancel = useCallback(async () => {
    const path = renamingPath;
    const wasNew = renamingIsNew;
    setRenamingPath(null);
    setRenamingIsNew(false);
    // If the user cancelled while the freshly-added item still has
    // no title, drop the row — they meant "never mind".
    if (wasNew && path && noggin) {
      const live = noggin.tryResolvePath(path);
      if (live && !live.title.trim()) {
        const hasKids = noggin.childrenOf(live.key).length > 0;
        await runVerb(() => verbs.delete(noggin, { path, recursive: hasKids }));
      }
    }
  }, [renamingPath, renamingIsNew, noggin, runVerb]);

  // ── Shell wrappers ────────────────────────────────────────────────
  const doOpen = useCallback(async () => {
    const picked = await shell.pickFile();
    if (!picked.ok) { setError(picked.error.message); return; }
    if (!picked.data) return;
    await openNoggin(picked.data);
    recents.bump(picked.data);
  }, [setError, openNoggin, recents]);

  const doNew = useCallback(async () => {
    const picked = await shell.pickNewFile('.noggin.yaml');
    if (!picked.ok) { setError(picked.error.message); return; }
    if (!picked.data) return;
    try {
      // Use Node fs when running in Electron; outside Electron we just
      // open the (possibly nonexistent) location and let the engine
      // surface the error.
      const req = (window as unknown as { require?: (id: string) => unknown }).require;
      if (typeof req === 'function') {
        const fs = req('node:fs') as typeof import('node:fs');
        if (!fs.existsSync(picked.data)) {
          fs.writeFileSync(picked.data, 'schemaVersion: 1\nactive: null\nitems: []\n', 'utf8');
        }
      }
      await openNoggin(picked.data);
      recents.bump(picked.data);
    } catch (err) {
      setError((err as Error).message ?? String(err));
    }
  }, [setError, openNoggin, recents]);

  const doClose = useCallback(async () => {
    await closeNoggin();
  }, [closeNoggin]);

  const onSwitchRecent = useCallback(async (location: string) => {
    if (location === openState.location) return;
    await openNoggin(location);
  }, [openState.location, openNoggin]);

  // ── File-drop on window ──────────────────────────────────────────
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setDragging(true); }
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    };
    const onDragLeave = (e: DragEvent) => { if (e.relatedTarget === null) setDragging(false); };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const path = (file as { path?: string }).path ?? '';
      if (!path) { setError("Could not determine the dropped file's path"); return; }
      await openNoggin(path);
      recents.bump(path);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [setError, openNoggin, recents]);

  // ── Global keyboard shortcuts ────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput = target && /^(INPUT|TEXTAREA)$/.test(target.tagName);
      if (e.key === 'b' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setSidebarOpen((v) => !v); return; }
      if (e.key === 'o' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doOpen(); return; }
      if (e.key === 'n' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doNew(); return; }
      if (e.key === 'w' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doClose(); return; }
      if (inInput) return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doOpen, doNew, doClose]);

  // ── Menu state + actions ─────────────────────────────────────────
  useEffect(() => {
    const state: MenuState = {
      hasNoggin: !!openState.location,
      sidebarOpen,
      detailsLocation,
    };
    shell.setMenuState(state);
  }, [openState.location, sidebarOpen, detailsLocation]);

  useEffect(() => {
    return shell.onMenuAction((action: MenuAction) => {
      switch (action) {
        case 'new': doNew(); break;
        case 'open': doOpen(); break;
        case 'close': doClose(); break;
        case 'toggleSidebar': setSidebarOpen((v) => !v); break;
        case 'detailsRight': setDetailsLocation('right'); break;
        case 'detailsBelow': setDetailsLocation('below'); break;
        case 'shortcuts': showShortcuts(); break;
        case 'about': showAbout(); break;
      }
    });
  }, [doNew, doOpen, doClose]);

  // ── Details target ────────────────────────────────────────────────
  const detailsItem: NogginDetailsItem | null = useMemo(() => {
    if (!noggin) return null;
    const path = selectedPath ?? activePath;
    if (!path) return null;
    const node = findByPath(nodes, path);
    if (!node) return null;
    const parent = findParent(nodes, path);
    const siblings = parent?.children ?? nodes;
    const idx = siblings.findIndex((s) => s.path === path);
    const liveItem = noggin.findByKey(node.key);
    const notes = liveItem?.notes ? [...liveItem.notes] : [];
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


  const detailsPane = (
    <aside className="details">
      <div className="details-pane-header">
        <span>Details</span>
        {detailsItem && (
          <span className="details-pane-subtitle" title={detailsItem.path}>
            {detailsItem.path}
          </span>
        )}
      </div>
      <div className="details-pane-body">
        <NogginDetails
          item={detailsItem}
          onToggleDone={onToggleDone}
          onGoto={onActivate}
          onAppendNote={onAppendNote}
          onRetitle={onRetitle}
          onReorderUp={(path) => onReorder(path, 'before')}
          onReorderDown={(path) => onReorder(path, 'after')}
        />
      </div>
    </aside>
  );

  return (
    <div className="app">
      <div className="topbar">
        <MainMenu
          isOpen={!!openState.location}
          sidebarOpen={sidebarOpen}
          detailsLocation={detailsLocation}
          onNew={doNew}
          onOpen={doOpen}
          onClose={doClose}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onSetDetailsLocation={setDetailsLocation}
          onShortcuts={showShortcuts}
          onAbout={showAbout}
          hasNoggin={!!openState.location}
        />
        <div className="topbar-location" title={openState.location || 'No noggin open'}>
          {openState.location ? (
            <>
              <Icon name="file" />
              <span className="topbar-location-path">{prettyLocation(openState.location)}</span>
            </>
          ) : (
            <>
              <Icon name="circle-slash" />
              <span className="topbar-location-empty">No noggin open — drop a file here, or press Ctrl+O</span>
            </>
          )}
        </div>
        {openState.location && (
          <button className="iconbtn" onClick={doClose} title="Close this noggin  (Ctrl+W)">
            <Icon name="close" />
          </button>
        )}
      </div>

      <div className="workspace">
        {sidebarOpen && (
          <>
            <div className="sidebar-host" style={{ width: sidebarWidth, flex: `0 0 ${sidebarWidth}px` }}>
              <Sidebar
                openLocation={openState.location}
                recents={recents.recents}
                onSwitch={onSwitchRecent}
                onRemove={recents.remove}
                onNew={doNew}
                onOpen={doOpen}
              />
            </div>
            <Splitter
              orientation="vertical"
              onResize={(d) => setSidebarWidth((w) => clamp(w + d, 160, 480))}
              onReset={() => setSidebarWidth(DEFAULT_PREFS.sidebarWidth)}
            />
          </>
        )}

        <main className="main" ref={mainRef}>
          {error && (
            <div className="banner banner-error" onClick={() => setError(null)}>
              <Icon name="error" />
              <span>{error}</span>
              <Icon name="close" />
            </div>
          )}

          {detailsLocation === 'right' ? (
            <div className="main-row">
              <div className="main-col tree-col">
                <div className="treepane">
                  <TreeOrEmpty
                    openLocation={openState.location}
                    nodes={nodes}
                    activeKey={activeKey}
                    selectedPath={selectedPath}
                    renamingPath={renamingPath}
                    onSelect={setSelectedPath}
                    onActivate={onActivate}
                    onToggleDone={onToggleDone}
                    onMove={onMove}
                    onAddChild={onAddChild}
                    onDelete={onDelete}
                    onRequestRename={(p) => setRenamingPath(p)}
                    onRenameSubmit={onRenameSubmit}
                    onRenameCancel={onRenameCancel}
                    onGesture={onGesture}
                    onOpen={doOpen}
                    onAddFirstItem={onAddFirstItem}
                  />
                </div>
              </div>
              <Splitter
                orientation="vertical"
                onResize={(d) => setDetailsRightWidth((w) => clamp(w - d, 220, Math.max(240, mainSize.w - 220)))}
                onReset={() => setDetailsRightWidth(DEFAULT_PREFS.detailsRightWidth)}
              />
              <div className="details-host" style={{ width: detailsRightWidth, flex: `0 0 ${detailsRightWidth}px` }}>
                {detailsPane}
              </div>
            </div>
          ) : (
            <div className="main-col-stack">
              <div className="tree-section">
                <div className="treepane">
                  <TreeOrEmpty
                    openLocation={openState.location}
                    nodes={nodes}
                    activeKey={activeKey}
                    selectedPath={selectedPath}
                    renamingPath={renamingPath}
                    onSelect={setSelectedPath}
                    onActivate={onActivate}
                    onToggleDone={onToggleDone}
                    onMove={onMove}
                    onAddChild={onAddChild}
                    onDelete={onDelete}
                    onRequestRename={(p) => setRenamingPath(p)}
                    onRenameSubmit={onRenameSubmit}
                    onRenameCancel={onRenameCancel}
                    onGesture={onGesture}
                    onOpen={doOpen}
                    onAddFirstItem={onAddFirstItem}
                  />
                </div>
              </div>
              <Splitter
                orientation="horizontal"
                onResize={(d) => setDetailsBelowHeight((h) => clamp(h - d, 140, Math.max(160, mainSize.h - 180)))}
                onReset={() => setDetailsBelowHeight(DEFAULT_PREFS.detailsBelowHeight)}
              />
              <div className="details-host-below" style={{ height: detailsBelowHeight, flex: `0 0 ${detailsBelowHeight}px` }}>
                {detailsPane}
              </div>
            </div>
          )}
        </main>
      </div>

      {dragging && (
        <div className="drop-overlay">
          <Icon name="cloud-upload" className="drop-overlay-icon" />
          <div className="drop-overlay-text">Open as noggin</div>
          <div className="drop-overlay-hint">Drop a .yaml file</div>
        </div>
      )}
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────

function TreeOrEmpty(props: {
  openLocation: string | null;
  nodes: ReturnType<typeof projectTree>;
  activeKey: string | null;
  selectedPath: string | null;
  renamingPath: string | null;
  onSelect: (path: string) => void;
  onActivate: (path: string) => void;
  onToggleDone: (path: string, done: boolean) => void;
  onMove: (intent: NogginMoveIntent) => void;
  onAddChild: (path: string) => void;
  onDelete: (path: string, hasChildren: boolean) => void;
  onRequestRename: (path: string) => void;
  onRenameSubmit: (path: string, title: string) => void;
  onRenameCancel: () => void;
  onGesture: (path: string, gesture: TreeGesture) => void;
  onOpen: () => void;
  onAddFirstItem: (title?: string) => void;
}) {
  if (!props.openLocation) return <WelcomeState onOpen={props.onOpen} />;
  if (props.nodes.length === 0) return <EmptyTreeState onAdd={props.onAddFirstItem} />;
  return (
    <NogginTree
      nodes={props.nodes}
      fileId={props.openLocation}
      activeKey={props.activeKey}
      selectedPath={props.selectedPath}
      renamingPath={props.renamingPath}
      onSelect={props.onSelect}
      onActivate={props.onActivate}
      onToggleDone={props.onToggleDone}
      onMove={props.onMove}
      onAddChild={props.onAddChild}
      onDelete={props.onDelete}
      onRequestRename={props.onRequestRename}
      onRenameSubmit={props.onRenameSubmit}
      onRenameCancel={props.onRenameCancel}
      onGesture={props.onGesture}
    />
  );
}

function WelcomeState({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="empty">
      <Icon name="symbol-misc" className="empty-icon" />
      <div className="empty-title">Welcome to noggin</div>
      <div className="empty-hint">
        A working-memory tree for in-flight work. Open a noggin from the sidebar,
        drop a YAML file on this window, or create a new one.
      </div>
      <button className="empty-cta" onClick={onOpen}>
        <Icon name="folder-opened" /> Open noggin…
      </button>
      <div className="empty-shortcuts">
        <kbd>Ctrl+N</kbd><span>New noggin…</span>
        <kbd>Ctrl+O</kbd><span>Open noggin…</span>
        <kbd>Ctrl+B</kbd><span>Toggle sidebar</span>
      </div>
    </div>
  );
}

function EmptyTreeState({ onAdd }: { onAdd: (title?: string) => void }) {
  const [value, setValue] = useState('');
  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onAdd(v);
    setValue('');
  };
  return (
    <div className="empty">
      <Icon name="list-tree" className="empty-icon" />
      <div className="empty-title">No items yet</div>
      <form
        className="empty-add"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <input
          className="empty-add-input"
          type="text"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="What's on your mind? Type and press Enter…"
          aria-label="First item title"
        />
        <button
          type="submit"
          className="empty-add-btn"
          disabled={!value.trim()}
          aria-label="Add item"
        >
          <Icon name="add" /> Add
        </button>
      </form>
      <div className="empty-hint">
        After your first item, use keyboard gestures:{' '}
        <kbd className="inline-kbd">Enter</kbd> sibling after ·{' '}
        <kbd className="inline-kbd">Ctrl+Enter</kbd> child ·{' '}
        <kbd className="inline-kbd">Tab</kbd> demote ·{' '}
        <kbd className="inline-kbd">Alt+\u2191\u2193</kbd> reorder.
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function prettyLocation(loc: string): string {
  if (loc.startsWith('memory://')) return loc;
  const normalized = loc.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 3) return normalized;
  return '…/' + parts.slice(-3).join('/');
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

type TreeNode = ReturnType<typeof projectTree>[number];

function findByPath(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    const f = findByPath(n.children, path);
    if (f) return f;
  }
  return null;
}

function findParent(nodes: TreeNode[], childPath: string, parent: TreeNode | null = null): TreeNode | null {
  for (const n of nodes) {
    if (n.path === childPath) return parent;
    const f = findParent(n.children, childPath, n);
    if (f !== null) return f;
  }
  return null;
}

function findPath(nodes: TreeNode[], key: string): string | null {
  for (const n of nodes) {
    if (n.key === key) return n.path;
    const f = findPath(n.children, key);
    if (f) return f;
  }
  return null;
}

function showShortcuts() {
  alert([
    'Keyboard shortcuts',
    '',
    'Application',
    '  Ctrl+N           New noggin',
    '  Ctrl+O           Open noggin',
    '  Ctrl+W           Close noggin',
    '  Ctrl+B           Toggle sidebar',
    '',
    'Tree \u2014 add',
    '  Enter            Add sibling after',
    '  Shift+Enter      Add sibling before',
    '  Ctrl+Enter       Add child',
    '  Ctrl+Home        Add as first sibling',
    '  Ctrl+End         Add as last sibling',
    '',
    'Tree \u2014 move',
    '  Tab              Demote (make child of previous sibling)',
    '  Shift+Tab        Promote (move out to parent\u2019s level)',
    '  Alt+\u2191 / Alt+\u2193    Move up / down among siblings',
    '  Alt+Home         Move to first sibling',
    '  Alt+End          Move to last sibling',
    '',
    'Tree \u2014 misc',
    '  F2               Rename',
    '  Space            Toggle done',
    '  Delete           Delete item',
    '  \u2191 / \u2193            Navigate',
    '',
    'Editors',
    '  Enter            (title edit) Save',
    '  Escape           (title edit) Cancel',
    '  Ctrl+Enter       (note editor) Submit note',
    '  Escape           (note editor) Cancel note',
  ].join('\n'));
}
function showAbout() {
  alert('noggin\n\nA working-memory tree for in-flight work.\n\nSee the Help menu for documentation and project links.');
}
