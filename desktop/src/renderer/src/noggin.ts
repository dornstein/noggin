// Renderer-side noggin state.
//
// Holds a single live `Noggin` instance (file:// in production, memory://
// when ?mock is set) and exposes a small React hook that keeps a
// derived tree snapshot in sync via `onDidChange`. Verbs are invoked
// against the live noggin directly — no IPC layer.
//
// The tree is maintained INCREMENTALLY: each `ChangeEvent` is applied
// to the existing node array via `applyChanges`. We never re-project
// the full tree from `noggin.items` after the initial open. A dev-only
// parity check verifies that the incremental result still matches a
// from-scratch projection — this catches bugs in either the patcher or
// the diff producer.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  openNoggin,
  verbs,
  NogginError,
  type Noggin,
  type ChangeEvent,
  type Item,
} from '../../../skills/noggin/noggin-api.mjs';
import '../../../skills/noggin/providers/file.mjs';     // registers file://
import '../../../skills/noggin/providers/memory.mjs';   // registers memory://

import type { NogginNode } from '@noggin/ui';
import { applyChanges, type PatchContext } from './applyChanges';

// ── Tree projection ─────────────────────────────────────────────────────

/**
 * Build a NogginNode forest from a noggin's live `items` accessor.
 * Used only for the initial open and the dev-mode parity assertion;
 * post-open updates flow through `applyChanges`.
 */
export function projectTree(noggin: Noggin): NogginNode[] {
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

// ── Hook ────────────────────────────────────────────────────────────────

export interface OpenState {
  location: string | null;
  exists: boolean;
}

export interface NogginState {
  noggin: Noggin | null;
  nodes: NogginNode[];
  activeKey: string | null;
  activePath: string | null;
  openState: OpenState;
  error: string | null;
  setError(msg: string | null): void;
  open(location: string): Promise<void>;
  close(): Promise<void>;
}

export function useNogginState(initialLocation: string | null): NogginState {
  const [noggin, setNoggin] = useState<Noggin | null>(null);
  const [nodes, setNodes] = useState<NogginNode[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [openState, setOpenState] = useState<OpenState>({ location: null, exists: false });
  const [error, setError] = useState<string | null>(null);

  // Ref to the current nodes so the change handler doesn't close over
  // stale state.
  const nodesRef = useRef<NogginNode[]>([]);
  const subRef = useRef<{ dispose(): void } | null>(null);

  const adopt = useCallback((n: Noggin | null, location: string | null) => {
    if (subRef.current) { subRef.current.dispose(); subRef.current = null; }
    setNoggin(n);
    if (!n) {
      nodesRef.current = [];
      setNodes([]);
      setActiveKey(null);
      setActivePath(null);
      setOpenState({ location: null, exists: false });
      return;
    }
    // Initial full projection — the only one we ever do for this noggin.
    const initial = projectTree(n);
    nodesRef.current = initial;
    setNodes(initial);
    const a = n.active;
    setActiveKey(a ? a.key : null);
    setActivePath(a ? n.pathOf(a) : null);
    setOpenState({ location, exists: true });

    // Subscribe to incremental changes.
    subRef.current = n.onDidChange((changes: ChangeEvent) => {
      const ctx: PatchContext = {
        lookup: (key) => {
          const item = n.findByKey(key);
          if (!item) return null;
          return {
            title: item.title,
            done: item.done,
            noteCount: Array.isArray(item.notes) ? item.notes.length : 0,
          };
        },
      };
      const next = applyChanges(nodesRef.current, changes, ctx);
      nodesRef.current = next;
      setNodes(next);

      // The active pointer is tracked separately from the forest shape.
      const activeChange = changes.find((c) => c.kind === 'activeChanged');
      if (activeChange && activeChange.kind === 'activeChanged') {
        setActiveKey(activeChange.to);
        if (activeChange.to) {
          const item = n.findByKey(activeChange.to);
          setActivePath(item ? n.pathOf(item) : null);
        } else {
          setActivePath(null);
        }
      }

      // Dev parity assertion: verify the incremental projection still
      // matches a from-scratch one. If this trips, either the patcher
      // or `diffDocuments` has a bug; the message points to which
      // subtree disagrees.
      if (import.meta.env.DEV) {
        assertParity(next, n);
      }
    });

    n.onDidError((err) => { setError(err.message); });
  }, []);

  const open = useCallback(async (location: string) => {
    if (noggin) { try { await noggin.dispose(); } catch { /* ignore */ } }
    try {
      const n = await openNoggin(location, { watch: !location.startsWith('memory://') });
      adopt(n, n.describe());
      setError(null);
    } catch (err) {
      adopt(null, null);
      const e = err as NogginError;
      setError(e.message || String(err));
    }
  }, [noggin, adopt]);

  const close = useCallback(async () => {
    if (noggin) { try { await noggin.dispose(); } catch { /* ignore */ } }
    adopt(null, null);
  }, [noggin, adopt]);

  useEffect(() => {
    if (initialLocation) void open(initialLocation);
    return () => {
      if (subRef.current) { subRef.current.dispose(); subRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLocation]);

  return {
    noggin,
    nodes,
    activeKey,
    activePath,
    openState,
    error,
    setError,
    open,
    close,
  };
}

// Re-export verbs so consumers have a single import.
export { verbs };

// ── Dev parity check ────────────────────────────────────────────────────
//
// After each incremental update, project a fresh tree from the live
// noggin and compare. Any mismatch means our patcher and the engine's
// diff have drifted apart, which would produce silent bugs over time.
// Disabled in production via import.meta.env.DEV.

function assertParity(incremental: NogginNode[], noggin: Noggin): void {
  const fresh = projectTree(noggin);
  if (!treesEqual(incremental, fresh)) {
     
    console.error(
      '[noggin] incremental tree diverged from fresh projection.\n' +
      'incremental: ' + JSON.stringify(strip(incremental), null, 2) + '\n' +
      'fresh:       ' + JSON.stringify(strip(fresh), null, 2),
    );
    throw new Error('Incremental tree projection diverged from engine state. See console for details.');
  }
}

function strip(nodes: readonly NogginNode[]): unknown {
  return nodes.map((n) => ({
    key: n.key, path: n.path, title: n.title, done: n.done, noteCount: n.noteCount,
    children: strip(n.children),
  }));
}

function treesEqual(a: readonly NogginNode[], b: readonly NogginNode[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.key !== y.key) return false;
    if (x.path !== y.path) return false;
    if (x.title !== y.title) return false;
    if (x.done !== y.done) return false;
    if (x.noteCount !== y.noteCount) return false;
    if (!treesEqual(x.children, y.children)) return false;
  }
  return true;
}
