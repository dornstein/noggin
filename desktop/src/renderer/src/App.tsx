// Top-level desktop app shell. Holds the noggin engine in-process,
// composes @noggin/ui components, talks to shell.* for native dialogs.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Icon,
  NogginTree,
  NogginDetails,
  createNogginActions,
  uiErrorMessage,
  type NogginDetailsItem,
  type NogginActions,
} from '@noggin/ui';
import type { NogginError } from '@noggin/engine';
import { useNogginState, projectTree } from './noggin';
import { useRecents } from './recents';
import { shell } from './shell';
import { Sidebar } from './Sidebar';
import { Splitter } from './Splitter';
import { ModalHost } from './ModalHost';
import type { MenuAction, MenuState } from '@shared/ipc';

type DetailsLocation = 'right' | 'below';

const UI_PREFS_KEY = 'noggin:ui:prefs:v2';

interface UiPrefs {
  sidebarOpen: boolean;
  sidebarWidth: number;
  detailsLocation: DetailsLocation;
  detailsRightWidth: number;
  detailsBelowHeight: number;
  detailsCollapsed: boolean;
}

const DEFAULT_PREFS: UiPrefs = {
  sidebarOpen: true,
  sidebarWidth: 220,
  detailsLocation: 'right',
  detailsRightWidth: 340,
  detailsBelowHeight: 260,
  detailsCollapsed: false,
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
  /** Where to open on first mount. File path or memory:// URL.
   *  When null the welcome state is shown until the user picks one. */
  initialLocation: string | null;
}

export function App({ initialLocation }: AppProps) {
  const initial = useMemo(loadPrefs, []);
  const [sidebarOpen, setSidebarOpen] = useState(initial.sidebarOpen);
  const [sidebarWidth, setSidebarWidth] = useState(initial.sidebarWidth);
  const [detailsLocation, setDetailsLocation] = useState<DetailsLocation>(initial.detailsLocation);
  const [detailsRightWidth, setDetailsRightWidth] = useState(initial.detailsRightWidth);
  const [detailsBelowHeight, setDetailsBelowHeight] = useState(initial.detailsBelowHeight);
  const [detailsCollapsed, setDetailsCollapsed] = useState(initial.detailsCollapsed);

  useEffect(() => {
    savePrefs({ sidebarOpen, sidebarWidth, detailsLocation, detailsRightWidth, detailsBelowHeight, detailsCollapsed });
  }, [sidebarOpen, sidebarWidth, detailsLocation, detailsRightWidth, detailsBelowHeight, detailsCollapsed]);

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

  // ── Verb wrappers (call into the RemoteNoggin) ─────────────────────
  // RemoteNoggin optimistically applies each verb to its local memory
  // noggin, fires onDidChange immediately, then ships the verb over
  // noggin-rpc to main. The actions surface bundles every verb call;
  // we use its `middleware` knob to thread our `runVerb` wrapper so
  // every dispatch gets the same busy/error handling treatment.

  const runVerb = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    if (!noggin) return null;
    try { return await fn(); }
    catch (err) {
      setError(uiErrorMessage(err as NogginError));
      return null;
    }
  }, [noggin, setError]);

  const actions = useMemo(() => {
    if (!noggin) return null;
    return createNogginActions(noggin, {
      middleware: async (fn) => {
        try { return await fn(); }
        catch (err) { setError(uiErrorMessage(err as NogginError)); throw err; }
      },
    });
  }, [noggin, setError]);

  // Empty-tree CTA: create the first root item.
  // - With a typed title: use `push` so the new item becomes the
  //   engine's active item (and the host selects/focuses it via the
  //   pendingFocusKey machinery). This matches the user's intent of
  //   "I'm starting here" — they typed a title and want to
  //   immediately begin working under it.
  // - Without a title: use `add` with an empty title and drop into
  //   inline-rename mode; the row stays selected but engine active
  //   doesn't move until the user commits a title (or activates it
  //   via the pin).
  const onAddFirstItem = useCallback(async (title?: string) => {
    if (!noggin) return;
    const trimmed = (title ?? '').trim();
    if (trimmed) {
      const result = await runVerb(() => noggin.push({ title: trimmed }));
      if (result?.targetKey) setPendingFocusKey(result.targetKey);
    } else {
      const result = await runVerb(() => noggin.add({ title: '' }));
      if (result?.targetKey) setPendingRenameKey(result.targetKey);
    }
  }, [noggin, runVerb]);

  // The tree handles default post-action UI orchestration internally
  // — newly-added rows enter rename mode via onRequestRename, moved
  // rows pull selection forward via onSelect, deletes fall back to a
  // sensible focus target. The host doesn't subscribe to anything
  // extra; if you need different behaviour, wrap `actions` before
  // handing it to the tree.

  // Host-owned UI state callback: the tree asks for rename mode and
  // we toggle the controlled `renamingPath`. The tree passes
  // `{ isNew: true }` when this is its own follow-up after an add
  // action; user-driven requests (F2, double-click, menu pick) omit
  // it. We use the hint to arm the cancel-then-delete fallback for
  // empty-title fresh rows.
  const onRequestRename = useCallback((path: string, opts?: { isNew?: boolean }) => {
    setRenamingPath(path);
    setRenamingIsNew(opts?.isNew === true);
  }, []);

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
        await runVerb(() => noggin.delete({ path, recursive: hasKids }));
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
    // Main creates the empty YAML file when the path doesn't exist;
    // the renderer just opens it.
    await openNoggin(picked.data);
    recents.bump(picked.data);
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

  // ── Application menu wiring ─────────────────────────────────────
  // The renderer pushes state to main whenever a menu-relevant value
  // changes; main rebuilds the menu against it. Actions come back
  // as `menuAction` events.
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


  const collapseIcon = detailsLocation === 'right' ? 'chevron-right' : 'chevron-down';
  const expandIcon = detailsLocation === 'right' ? 'chevron-left' : 'chevron-up';

  const detailsPane = detailsCollapsed ? (
    // Collapsed pane: the entire 28px strip is a single button so the
    // whole sliver is a hit target (not just the chevron). Width /
    // height set by parent layout to 28px; the splitter is hidden.
    <button
      type="button"
      className={`details details-collapsed details-collapsed-${detailsLocation}`}
      onClick={() => setDetailsCollapsed(false)}
      title="Expand details pane"
      aria-label="Expand details pane"
    >
      <Icon name={expandIcon} />
    </button>
  ) : (
    <aside className="details">
      <div className="details-pane-body">
        {actions && (
          <NogginDetails
            item={detailsItem}
            actions={actions}
            onCollapse={() => setDetailsCollapsed(true)}
            collapseIcon={collapseIcon}
          />
        )}
      </div>
    </aside>
  );

  return (
    <div className="app">
      <div className="topbar">
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
                    actions={actions}
                    onSelect={setSelectedPath}
                    onRequestRename={onRequestRename}
                    onRenameCancel={onRenameCancel}
                    onOpen={doOpen}
                    onAddFirstItem={onAddFirstItem}
                  />
                </div>
              </div>
              {!detailsCollapsed && (
                <Splitter
                  orientation="vertical"
                  onResize={(d) => setDetailsRightWidth((w) => clamp(w - d, 220, Math.max(240, mainSize.w - 220)))}
                  onReset={() => setDetailsRightWidth(DEFAULT_PREFS.detailsRightWidth)}
                />
              )}
              <div
                className="details-host"
                style={detailsCollapsed
                  ? { width: 28, flex: '0 0 28px' }
                  : { width: detailsRightWidth, flex: `0 0 ${detailsRightWidth}px` }}
              >
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
                    actions={actions}
                    onSelect={setSelectedPath}
                    onRequestRename={onRequestRename}
                    onRenameCancel={onRenameCancel}
                    onOpen={doOpen}
                    onAddFirstItem={onAddFirstItem}
                  />
                </div>
              </div>
              {!detailsCollapsed && (
                <Splitter
                  orientation="horizontal"
                  onResize={(d) => setDetailsBelowHeight((h) => clamp(h - d, 140, Math.max(160, mainSize.h - 180)))}
                  onReset={() => setDetailsBelowHeight(DEFAULT_PREFS.detailsBelowHeight)}
                />
              )}
              <div
                className="details-host-below"
                style={detailsCollapsed
                  ? { height: 28, flex: '0 0 28px' }
                  : { height: detailsBelowHeight, flex: `0 0 ${detailsBelowHeight}px` }}
              >
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

      <ModalHost />
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
  actions: NogginActions | null;
  onSelect: (path: string) => void;
  onRequestRename: (path: string) => void;
  onRenameCancel: () => void;
  onOpen: () => void;
  onAddFirstItem: (title?: string) => void;
}) {
  if (!props.openLocation) return <WelcomeState onOpen={props.onOpen} />;
  if (props.nodes.length === 0) return <EmptyTreeState onAdd={props.onAddFirstItem} />;
  // actions is non-null once a noggin is open; the early-returns
  // above cover the no-noggin case.
  if (!props.actions) return null;
  return (
    <NogginTree
      nodes={props.nodes}
      fileId={props.openLocation}
      activeKey={props.activeKey}
      selectedPath={props.selectedPath}
      renamingPath={props.renamingPath}
      actions={props.actions}
      onSelect={props.onSelect}
      onRequestRename={props.onRequestRename}
      onRenameCancel={props.onRenameCancel}
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
        <kbd className="inline-kbd">Alt+↑↓</kbd> reorder.
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
