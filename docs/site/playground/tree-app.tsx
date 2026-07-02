// React mount for the playground's "Tree" tab. Uses the real
// `@noggin/ui` components against a LocalStorage-backed noggin so the
// playground demonstrates the same widget set the extension and
// desktop app ship.

import React, { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  NogginTree,
  NogginDetails,
  NogginList,
  createNogginActions,
  type NogginDetailsItem,
  type NogginListPrefs,
  type NogginListStore,
  type NogginNode,
  type NogginProviderTypeReader,
  type MRUReader,
} from '@noggin/ui';
import type { Noggin } from '@noggin/engine';

import '@noggin/ui/styles.css';
import '@noggin/ui/themes/auto.css';

// LocalStorageNoggin satisfies the engine's `Noggin` interface via
// `bindNogginVerbs` — same shape the desktop / extension consume.
type PlaygroundNoggin = Noggin;

function projectTreeFromNoggin(noggin: PlaygroundNoggin): NogginNode[] {
  const items = noggin.items;
  const byParent = new Map<string | null, typeof items[number][]>();
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

function findNodeByKey(nodes: NogginNode[], key: string): NogginNode | null {
  for (const n of nodes) {
    if (n.key === key) return n;
    const inChild = findNodeByKey(n.children, key);
    if (inChild) return inChild;
  }
  return null;
}

function findPathByKey(nodes: NogginNode[], key: string): string | null {
  const n = findNodeByKey(nodes, key);
  return n ? n.path : null;
}

function findNodeByPath(nodes: NogginNode[], path: string): NogginNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    const inChild = findNodeByPath(n.children, path);
    if (inChild) return inChild;
  }
  return null;
}

function siblingsAround(nodes: NogginNode[], key: string): { hasPrev: boolean; hasNext: boolean } {
  function walk(list: NogginNode[]): { hasPrev: boolean; hasNext: boolean } | null {
    const idx = list.findIndex((n) => n.key === key);
    if (idx >= 0) return { hasPrev: idx > 0, hasNext: idx < list.length - 1 };
    for (const n of list) {
      const found = walk(n.children);
      if (found) return found;
    }
    return null;
  }
  return walk(nodes) || { hasPrev: false, hasNext: false };
}

function PlaygroundTreeApp({ noggin }: { noggin: PlaygroundNoggin }) {
  const [tick, setTick] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  useEffect(() => {
    const sub = noggin.onDidChange(() => setTick((t) => t + 1));
    return () => sub.dispose();
  }, [noggin]);

  const nodes = useMemo(() => projectTreeFromNoggin(noggin), [noggin, tick]);
  const activeKey = noggin.active?.key ?? null;
  const selectedPath = selectedKey ? findPathByKey(nodes, selectedKey) : null;

  useEffect(() => {
    if (selectedKey && findNodeByKey(nodes, selectedKey)) return;
    if (activeKey) setSelectedKey(activeKey);
    else if (nodes.length) setSelectedKey(nodes[0].key);
    else setSelectedKey(null);
  }, [nodes, activeKey, selectedKey]);

  const detailsItem = useMemo<NogginDetailsItem | null>(() => {
    const key = selectedKey || activeKey;
    if (!key) return null;
    const node = findNodeByKey(nodes, key);
    if (!node) return null;
    const item = noggin.items.find((it) => it.key === key);
    if (!item) return null;
    const { hasPrev, hasNext } = siblingsAround(nodes, key);
    return {
      key,
      path: node.path,
      title: item.title,
      done: item.done,
      notes: (item.notes || []).map((n) => ({ timestamp: n.timestamp, text: n.text })),
      isActive: key === activeKey,
      hasPrevSibling: hasPrev,
      hasNextSibling: hasNext,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, noggin, selectedKey, activeKey, tick]);

  const actions = useMemo(() => createNogginActions(noggin, {
    middleware: async (fn) => {
      try { return await fn(); }
      catch (err) {
        // eslint-disable-next-line no-console
        console.error('[playground] action failed', err);
        throw err;
      }
    },
  }), [noggin]);

  // The tree handles default post-action UI orchestration internally
  // (newly-added rows enter rename mode; moved rows pull selection
  // forward). Our `onRequestRename` only needs to flip `renamingPath`
  // — fresh adds still arrive here (with `opts.isNew === true`) but
  // the playground doesn't distinguish that case from a user-driven
  // F2 rename.

  const onSelect = useCallback((path: string) => {
    const node = findNodeByPath(nodes, path);
    if (node) setSelectedKey(node.key);
  }, [nodes]);

  return (
    <div className="pg-tree-app">
      <div className="pg-tree-pane">
        <NogginTree
          nodes={nodes}
          activeKey={activeKey}
          selectedPath={selectedPath}
          renamingPath={renamingPath}
          actions={actions}
          onSelect={onSelect}
          onRequestRename={(p) => setRenamingPath(p)}
          onRenameEnd={() => setRenamingPath(null)}
        />
      </div>
      <div className="pg-details-pane">
        <NogginDetails
          item={detailsItem}
          actions={actions}
        />
      </div>
    </div>
  );
}

let activeRoot: Root | null = null;

export function mountTreeApp({ root, noggin }: { root: HTMLElement; noggin: PlaygroundNoggin }): { unmount(): void } {
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  const r = createRoot(root);
  activeRoot = r;
  r.render(React.createElement(PlaygroundTreeApp, { noggin }));
  return {
    unmount() {
      r.unmount();
      if (activeRoot === r) activeRoot = null;
    },
  };
}

// ── List rail ─────────────────────────────────────────────────────

/**
 * The playground-state shape `mountListRail` consumes. Kept
 * structurally typed (not imported from playground-state.mjs)
 * because that module is plain JS — TypeScript here just sees the
 * surface it cares about.
 */
interface PlaygroundStateLike {
  store: NogginListStore;
  providers: NogginProviderTypeReader;
  mru?: MRUReader;
  prefs: NogginListPrefs;
  setPrefs(next: NogginListPrefs): void;
  onPrefsChange(cb: (next: NogginListPrefs) => void): { dispose(): void };
  setCurrentUri(uri: string): void;
}

function PlaygroundListRail({ state }: { state: PlaygroundStateLike }) {
  const [, bumpPrefs] = useReducer((x: number) => x + 1, 0);

  // Mirror the host-side prefs into a state-change tick so React
  // re-renders when something other than the component itself
  // (e.g. a future host control) updates them.
  useEffect(() => {
    const sub = state.onPrefsChange(() => bumpPrefs());
    return () => sub.dispose();
  }, [state]);

  return (
    <NogginList
      store={state.store}
      providers={state.providers}
      prefs={state.prefs}
      onPrefsChange={(next) => { state.setPrefs(next); bumpPrefs(); }}
      onActivate={(uri) => state.setCurrentUri(uri)}
      headerTitle="Noggins"
      recent={state.mru}
    />
  );
}

let listRoot: Root | null = null;

export function mountListRail({ root, state }: { root: HTMLElement; state: PlaygroundStateLike }): { unmount(): void } {
  if (listRoot) {
    listRoot.unmount();
    listRoot = null;
  }
  const r = createRoot(root);
  listRoot = r;
  r.render(React.createElement(PlaygroundListRail, { state }));
  return {
    unmount() {
      r.unmount();
      if (listRoot === r) listRoot = null;
    },
  };
}
