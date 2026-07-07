// Webview-side App.
//
// Mounts @noggin/ui components against a `RemoteNoggin` driven over
// the tagged-envelope transport. The location comes from the host
// via `{ kind: 'session', location }` frames; whenever it changes we
// open the new noggin and dispose the old one.
//
// The "Noggins" browser (`NogginList` + a `createNogginListStore` +
// `createMRUManager`) is the same multi-noggin UI the desktop app
// ships, wired the same way: bridge the currently-open noggin into
// the store via `store.observe`, persist entries/prefs/MRU on every
// `onStateChange`. The one difference from desktop is WHERE that
// persistence lands — VS Code webviews don't guarantee `localStorage`
// survives a reload, so the host (globalState) owns durability and
// the webview mirrors it via `list-init` / `list-state` frames.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import {
  Icon,
  NogginTree,
  NogginDetails,
  NogginList,
  Splitter,
  DropdownActionsMenu,
  createNogginActions,
  createNogginListStore,
  createNogginProviderRegistry,
  createMRUManager,
  defaultNogginListPrefs,
  defaultNogginProviders,
  uiErrorMessage,
  type NogginNode,
  type NogginDetailsItem,
  type NogginListEntry,
  type NogginListPrefs,
  type NogginProviderPicker,
  type NogginProviderType,
  type TreeContextMenuEntry,
} from '@noggin/ui';
import { openRemoteNoggin, createProviderFlowsClient, RpcClient } from '@noggin/rpc';
import type { ProviderFlowsClient, Transport } from '@noggin/rpc';
import type {
  ChangeEvent,
  Item,
  Noggin,
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

// ── Layout constants ─────────────────────────────────────────────────

/** Height (px) of a collapsed section's header strip. Matches
 *  `@noggin/ui`'s `.noggin-list-header` height so the three stacked
 *  sections (Noggins / Noggin / Details) line up when collapsed. */
const COLLAPSED_HEIGHT = 32;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Uniform collapsible-section header for the Noggin (tree) and
 *  Details sections, which — unlike NogginList — don't ship a header
 *  of their own. Clicking the label toggles collapse; `right` is an
 *  optional slot for extra controls (e.g. the Noggin section's view
 *  options kebab) that must stay independently clickable, so it
 *  lives outside the toggle button rather than inside it. */
function SectionHeader({ title, collapsed, onToggle, right }: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  right?: ReactNode;
}): ReactElement {
  return (
    <div className="noggin-section-header">
      <button
        type="button"
        className="noggin-section-header-toggle"
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} />
        <span>{title}</span>
      </button>
      {right && <div className="noggin-section-header-actions">{right}</div>}
    </div>
  );
}

// ── Tree projection (mirrors desktop) ───────────────────────────────

function projectTree(noggin: Noggin): NogginNode[] {
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
  const [ready, setReady] = useState(false);
  useEffect(() => {
    function onMessage(ev: MessageEvent<HostFrame>) {
      const f = ev.data;
      if (f?.kind === 'session') setLocation(f.location);
    }
    window.addEventListener('message', onMessage);
    setReady(true);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  // Once the listener is attached, tell the host we're ready and
  // expect it to (re-)push the current session location. The host
  // can't post earlier without racing this useEffect.
  useEffect(() => {
    if (!ready) return;
    post({ kind: 'ready' });
  }, [ready]);
  return location;
}

/** Persisted NogginList entries/prefs/MRU pushed once by the host in
 *  response to `{ kind: 'ready' }`. Everything downstream (the store,
 *  the MRU manager, prefs state) is gated on this being non-null so
 *  we never construct a `NogginListStore` with the wrong initial
 *  entries. */
interface ListInit {
  entries: readonly NogginListEntry[];
  prefs: Partial<NogginListPrefs>;
  mru: Readonly<Record<string, string>>;
}

function useListInit(): ListInit | null {
  const [init, setInit] = useState<ListInit | null>(null);
  useEffect(() => {
    function onMessage(ev: MessageEvent<HostFrame>) {
      const f = ev.data;
      // The host moves these as opaque JSON blobs (see
      // shared-webview-protocol.ts) since its tsc project can't parse
      // @noggin/ui's JSX-bearing barrel. We trust the shape here
      // because the host only ever persists exactly what we sent it.
      if (f?.kind === 'list-init') {
        setInit({
          entries: f.entries as unknown as readonly NogginListEntry[],
          prefs: f.prefs as Partial<NogginListPrefs>,
          mru: f.mru,
        });
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return init;
}

/** Persisted Noggin-tree word-wrap preference, pushed once by the
 *  host on `ready` (same handshake as `useListInit`). */
function useTreePrefsInit(): { wordWrap: boolean } | null {
  const [init, setInit] = useState<{ wordWrap: boolean } | null>(null);
  useEffect(() => {
    function onMessage(ev: MessageEvent<HostFrame>) {
      if (ev.data?.kind === 'tree-prefs-init') setInit({ wordWrap: ev.data.wordWrap });
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return init;
}

/** File-only provider registry for the `+` add menu. VS Code drives
 *  the actual open/create dialogs on the host side (native file
 *  pickers); the webview only needs a canonical `file://` location
 *  back, which it hands to the host as the new session via
 *  `session-request: openLocation`. */
function buildFilePickers(flows: ProviderFlowsClient): NogginProviderPicker[] {
  return [
    {
      id: 'file:open',
      label: 'Open existing YAML…',
      icon: 'folder-opened',
      async onSelect() {
        const location = await flows.open('file://');
        if (location) post({ kind: 'session-request', action: 'openLocation', location });
      },
    },
    {
      id: 'file:new',
      label: 'New blank YAML…',
      icon: 'new-file',
      async onSelect() {
        const location = await flows.create('file://');
        if (location) post({ kind: 'session-request', action: 'openLocation', location });
      },
    },
    {
      id: 'file:workspace',
      label: 'Open workspace noggin',
      icon: 'root-folder-opened',
      hint: 'Uses .noggin.yaml at the workspace root',
      onSelect() {
        post({ kind: 'session-request', action: 'openWorkspaceNoggin' });
      },
    },
  ];
}


interface NogginState {
  noggin: Noggin | null;
  nodes: NogginNode[];
  activeKey: string | null;
  activePath: string | null;
  error: string | null;
  setError(msg: string | null): void;
}

function useNogginState(location: string | null): NogginState {
  const [noggin, setNoggin] = useState<Noggin | null>(null);
  const [nodes, setNodes] = useState<NogginNode[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const subRef = useRef<{ dispose(): void } | null>(null);
  const errorSubRef = useRef<{ dispose(): void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let opened: Noggin | null = null;

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
        errorSubRef.current = n.onDidError((err: NogginError) => setError(uiErrorMessage(err)));
      } catch (err) {
        if (cancelled) return;
        setNoggin(null); setNodes([]); setActiveKey(null); setActivePath(null);
        setError(uiErrorMessage(err as NogginError));
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

  // The tree handles default post-action UI orchestration internally:
  // newly-added rows enter rename mode via onRequestRename({isNew:true}),
  // moved rows pull selection forward via onSelect, deletes fall back
  // to a sensible focus target. The empty-state CTA still uses
  // pendingRenameKey/pendingFocusKey directly because it doesn't go
  // through the tree.

  const onRequestRename = useCallback((path: string, opts?: { isNew?: boolean }) => {
    setRenamingPath(path);
    setRenamingIsNew(opts?.isNew === true);
  }, []);

  const onRenameEnd = useCallback(async ({ committed }: { committed: boolean }) => {
    const p = renamingPath;
    const wasNew = renamingIsNew;
    setRenamingPath(null);
    setRenamingIsNew(false);
    if (!committed && wasNew && p && noggin) {
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

  // ── Noggins browser (NogginList + MRU + provider registry) ──────────
  //
  // Same shared components + wiring pattern as the desktop renderer
  // (see desktop/src/renderer/src/App.tsx): bridge the currently-open
  // noggin into the store via `store.observe`, route MRU touches
  // through `onUriActivity`, persist on every `onStateChange`. The
  // only VS Code-specific piece is WHERE persistence lands (host
  // globalState, via `list-init` / `list-state` frames) and that the
  // `file://` picker drives a native dialog on the host over RPC
  // instead of an Electron IPC bridge.
  const listInit = useListInit();

  const providerFlows = useMemo(() => createProviderFlowsClient(getRpcClient()), []);

  const providers = useMemo(() => createNogginProviderRegistry(
    defaultNogginProviders.map((p): NogginProviderType =>
      (p.scheme === 'file' ? { ...p, pickers: buildFilePickers(providerFlows) } : p)),
  ), [providerFlows]);

  const listBundle = useMemo(() => {
    if (!listInit) return null;
    const mru = createMRUManager({
      initial: listInit.mru,
      onStateChange: ({ entries }) => post({ kind: 'list-state', mru: entries }),
    });
    const store = createNogginListStore({
      initialEntries: listInit.entries,
      onStateChange: ({ entries }) => post({ kind: 'list-state', entries: entries as unknown as readonly Record<string, unknown>[] }),
      onUriActivity: (uri) => mru.touch(uri),
    });
    return { store, mru };
  }, [listInit]);

  const [listPrefs, setListPrefs] = useState<NogginListPrefs>(defaultNogginListPrefs);
  useEffect(() => {
    if (listInit) setListPrefs({ ...defaultNogginListPrefs, ...listInit.prefs });
  }, [listInit]);
  const onListPrefsChange = useCallback((next: NogginListPrefs) => {
    setListPrefs(next);
    post({ kind: 'list-state', prefs: next as unknown as Record<string, unknown> });
  }, []);

  // Bridge the open noggin into the store so it shows up (with a
  // live completion gauge + active-item cache) among the recents.
  useEffect(() => {
    if (!listBundle || !noggin || !location) return;
    const { store } = listBundle;
    store.add(location);
    store.setSelectedIds([location]);
    const sub = store.observe(location, noggin);
    return () => { sub.dispose(); };
  }, [listBundle, noggin, location]);

  // The Noggins list is one of three always-stacked, independently
  // collapsible sections (list / tree / details) — not a full-panel
  // takeover. Each one's whole header row (chevron + title) toggles
  // its own collapse state.
  const [listCollapsed, setListCollapsed] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);

  // Expanded-height state for the list/details sections (px); the
  // tree section has no explicit height — it's the flexible filler
  // that absorbs whatever's left. Mirrors the pixel-based splitter
  // model in desktop/src/renderer/src/App.tsx.
  const [listHeight, setListHeight] = useState(220);
  const [detailsHeight, setDetailsHeight] = useState(220);

  // Noggin (tree) view prefs — currently just word-wrap. Persisted by
  // the extension host (globalState), not local-only React state, so
  // it survives a webview reload. See useTreePrefsInit / the
  // `tree-prefs-*` frames in shared-webview-protocol.ts.
  const treePrefsInit = useTreePrefsInit();
  const [wordWrap, setWordWrap] = useState(false);
  useEffect(() => {
    if (treePrefsInit) setWordWrap(treePrefsInit.wordWrap);
  }, [treePrefsInit]);
  const onToggleWordWrap = useCallback((next: boolean) => {
    setWordWrap(next);
    post({ kind: 'tree-prefs-state', wordWrap: next });
  }, []);
  const treeMenuEntries = useCallback((): TreeContextMenuEntry[] => [
    {
      kind: 'checkbox',
      key: 'word-wrap',
      label: 'Wrap long titles',
      checked: wordWrap,
      onCheckedChange: onToggleWordWrap,
    },
  ], [wordWrap, onToggleWordWrap]);

  const onActivateEntry = useCallback((uri: string) => {
    post({ kind: 'session-request', action: 'openLocation', location: uri });
  }, []);
  const onCloseActiveEntry = useCallback(() => {
    post({ kind: 'session-request', action: 'close' });
  }, []);

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
  if (!listBundle) {
    // Waiting on the host's `list-init` handshake (near-instant; the
    // host responds to `ready` synchronously). Nothing meaningful to
    // paint yet — the tree/details need `location` either way, and
    // the Noggins browser needs the store.
    return <div className="noggin-webview" />;
  }
  const { store, mru } = listBundle;

  const listStyle = listCollapsed
    ? { flex: `0 0 ${COLLAPSED_HEIGHT}px`, overflow: 'hidden' as const }
    : { flex: `0 0 ${listHeight}px`, overflow: 'hidden' as const };
  const treeStyle = treeCollapsed
    ? { flex: `0 0 ${COLLAPSED_HEIGHT}px`, overflow: 'hidden' as const }
    : { flex: '1 1 auto', minHeight: 0 };
  const detailsStyle = detailsCollapsed
    ? { flex: `0 0 ${COLLAPSED_HEIGHT}px`, overflow: 'hidden' as const }
    : { flex: `0 0 ${detailsHeight}px`, overflow: 'hidden' as const };

  return (
    <div className="noggin-webview">
      {error && (
        <div className="noggin-banner" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      <div className="noggin-list-pane" style={listStyle}>
        <NogginList
          store={store}
          providers={providers}
          prefs={listPrefs}
          onPrefsChange={onListPrefsChange}
          onActivate={onActivateEntry}
          onCloseActiveEntry={location ? onCloseActiveEntry : undefined}
          recent={mru}
          headerTitle={(
            <button
              type="button"
              className="noggin-list-header-collapse"
              aria-expanded={!listCollapsed}
              onClick={() => setListCollapsed((c) => !c)}
            >
              <Icon name={listCollapsed ? 'chevron-right' : 'chevron-down'} />
              <span>Noggins</span>
            </button>
          )}
          emptyState={(
            <div className="noggin-empty">
              <p>No noggins yet.</p>
              <p>Use the + button to open or create one.</p>
            </div>
          )}
        />
      </div>

      {!listCollapsed && (
        <Splitter
          orientation="horizontal"
          onResize={(d) => setListHeight((h) => clamp(h + d, COLLAPSED_HEIGHT, 600))}
          onReset={() => setListHeight(220)}
        />
      )}

      <div className="noggin-section noggin-tree-section" style={treeStyle}>
        <SectionHeader
          title="Noggin"
          collapsed={treeCollapsed}
          onToggle={() => setTreeCollapsed((c) => !c)}
          right={(
            <DropdownActionsMenu
              buildEntries={treeMenuEntries}
              trigger={(
                <button
                  type="button"
                  className="iconbtn noggin-section-header-iconbtn"
                  title="Noggin view options"
                  aria-label="Noggin view options"
                  aria-haspopup="menu"
                >
                  <Icon name="kebab-vertical" />
                </button>
              )}
            />
          )}
        />
        {!treeCollapsed && (
          <div className="noggin-section-body">
            {location === null ? (
              <div className="noggin-empty">
                <p>Open a noggin from the list above to get started.</p>
              </div>
            ) : nodes.length === 0 ? (
              <EmptyTree onAdd={onAddFirstItem} />
            ) : actions ? (
              <NogginTree
                nodes={nodes}
                fileId={location}
                activeKey={activeKey}
                selectedPath={selectedPath}
                renamingPath={renamingPath}
                actions={actions}
                onSelect={setSelectedPath}
                onRequestRename={onRequestRename}
                onRenameEnd={onRenameEnd}
                wrap={wordWrap}
              />
            ) : null}
          </div>
        )}
      </div>

      {!detailsCollapsed && (
        <Splitter
          orientation="horizontal"
          onResize={(d) => setDetailsHeight((h) => clamp(h - d, COLLAPSED_HEIGHT, 600))}
          onReset={() => setDetailsHeight(220)}
        />
      )}

      <div className="noggin-section noggin-details-section" style={detailsStyle}>
        <SectionHeader
          title="Details"
          collapsed={detailsCollapsed}
          onToggle={() => setDetailsCollapsed((c) => !c)}
        />
        {!detailsCollapsed && (
          <div className="noggin-section-body">
            {actions ? (
              <NogginDetails
                item={detailsItem}
                actions={actions}
              />
            ) : (
              <div className="noggin-empty">
                <p>No noggin open.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────

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
