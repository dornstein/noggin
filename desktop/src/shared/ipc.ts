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

// Re-export the verb option / result types so the renderer can use
// them without reaching into the synced cli/ tree itself.
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

/**
 * The full noggin API surface the main process exposes on
 * `window.noggin`. Each method round-trips through `ipcMain.handle`
 * to a handler that calls the engine directly — no spawning, no
 * sub-process, no JSON-RPC serialization.
 *
 * Verbs default to operating on the currently-open noggin. To target
 * a different file, pass it to `open()` first (or use the per-call
 * `noggin` parameter on the verbs that take options).
 */
export interface NogginIpc {
  /** Open a noggin file. Returns the canonical location string. */
  open(file: string): Promise<IpcResult<string>>;
  /** Canonical location of the currently-open noggin (or null). */
  where(): Promise<IpcResult<string | null>>;
  /** Render the current-position view. */
  show(opts?: ShowOptions): Promise<IpcResult<CurrentTreeView | null>>;
  /** Create a child of active and become it. */
  push(opts: { title: string }): Promise<IpcResult<CurrentTreeView>>;
  /** Create a child without becoming it (capture a deferred todo). */
  add(opts: AddOptions): Promise<IpcResult<CurrentTreeView>>;
  /** Make `path` the active item. */
  goto(path: string): Promise<IpcResult<CurrentTreeView>>;
  /** Mark done and surface to parent. */
  done(opts?: DoneOptions): Promise<IpcResult<CurrentTreeView>>;
  /** Shorthand for done on the active item. */
  pop(opts?: DoneOptions): Promise<IpcResult<CurrentTreeView>>;
  /** Idempotent edit of state + title. */
  edit(opts: EditOptions): Promise<IpcResult<CurrentTreeView>>;
  /** Append a timestamped note. */
  note(opts: NoteOptions): Promise<IpcResult<CurrentTreeView>>;
  /** Relocate an item. */
  move(opts: MoveOptions): Promise<IpcResult<CurrentTreeView>>;
  /** Remove an item (optionally recursive). */
  delete(opts: DeleteOptions): Promise<IpcResult<DeleteResult>>;

  /**
   * Subscribe to "something changed in the open noggin". Fires for
   * both renderer-initiated mutations and external edits picked up by
   * the file watcher. Returns an unsubscribe function.
   */
  onDidChange(handler: () => void): () => void;
}

/** IPC channel names. Kept in one place so both sides can't drift. */
export const IPC = {
  open: 'noggin:open',
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
  changed: 'noggin:changed', // main → renderer event
} as const;
