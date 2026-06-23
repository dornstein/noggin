// Shared IPC types between main and renderer.
//
// The renderer never imports from `electron` directly; it talks to the
// main process through a small typed surface exposed on `window.noggin`
// via the preload script's `contextBridge`. The shapes below define
// that surface, so both sides see the same types.

import type {
  CurrentTreeView,
  DeleteResult,
  AddOptions,
  DoneOptions,
  EditOptions,
  NoteOptions,
  MoveOptions,
  ShowOptions,
  DeleteOptions,
} from '../../skills/noggin/noggin-api.d.mts';

export type {
  CurrentTreeView,
  DeleteResult,
  AddOptions,
  DoneOptions,
  EditOptions,
  NoteOptions,
  MoveOptions,
  ShowOptions,
  DeleteOptions,
};

/** Result envelope every IPC verb returns to the renderer. */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/** A noggin that's been opened recently. Sorted newest-first by main. */
export interface RecentEntry {
  /** Canonical location string (e.g. `~/.noggin.yaml`). */
  location: string;
  /** Display label — basename, or the location itself if no path separator. */
  label: string;
  /** When this entry was last opened (ISO). */
  lastOpenedAt: string;
  /** Does the file exist on disk right now? */
  exists: boolean;
}

/** Snapshot of the open-noggin state the renderer cares about. */
export interface OpenState {
  location: string | null;
  exists: boolean;
}

/** API the main process exposes on `window.noggin`. */
export interface NogginIpc {
  // ── Open / close / state ──
  open(file: string): Promise<IpcResult<string>>;
  close(): Promise<IpcResult<void>>;
  where(): Promise<IpcResult<OpenState>>;

  // ── Verbs ──
  show(opts?: ShowOptions): Promise<IpcResult<CurrentTreeView | null>>;
  push(opts: { title: string }): Promise<IpcResult<CurrentTreeView>>;
  add(opts: AddOptions): Promise<IpcResult<CurrentTreeView>>;
  goto(path: string): Promise<IpcResult<CurrentTreeView>>;
  done(opts?: DoneOptions): Promise<IpcResult<CurrentTreeView>>;
  pop(opts?: DoneOptions): Promise<IpcResult<CurrentTreeView>>;
  edit(opts: EditOptions): Promise<IpcResult<CurrentTreeView>>;
  note(opts: NoteOptions): Promise<IpcResult<CurrentTreeView>>;
  move(opts: MoveOptions): Promise<IpcResult<CurrentTreeView>>;
  delete(opts: DeleteOptions): Promise<IpcResult<DeleteResult>>;

  // ── Recents management ──
  recents: {
    list(): Promise<IpcResult<RecentEntry[]>>;
    pickFile(): Promise<IpcResult<string | null>>;
    remove(location: string): Promise<IpcResult<void>>;
  };

  /** Fires for both renderer-initiated mutations and file-watcher events. */
  onDidChange(handler: () => void): () => void;
  /** Fires whenever the open noggin switches (or closes). */
  onDidOpenChange(handler: (state: OpenState) => void): () => void;
}

/** IPC channel names. Single source of truth so both sides can't drift. */
export const IPC = {
  open: 'noggin:open',
  close: 'noggin:close',
  where: 'noggin:where',
  show: 'noggin:show',
  push: 'noggin:push',
  add: 'noggin:add',
  goto: 'noggin:goto',
  done: 'noggin:done',
  pop: 'noggin:pop',
  edit: 'noggin:edit',
  note: 'noggin:note',
  move: 'noggin:move',
  delete: 'noggin:delete',
  recentsList: 'noggin:recents:list',
  recentsPickFile: 'noggin:recents:pickFile',
  recentsRemove: 'noggin:recents:remove',
  changed: 'noggin:changed',
  openChanged: 'noggin:openChanged',
} as const;
