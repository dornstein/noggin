// Type declarations for noggin-api.mjs.
//
// Hand-written to match the JS implementation; no build step. The .mjs uses
// /// <reference path="./noggin-api.d.ts" /> so editors and tsc --noEmit can
// check usages against this contract.

export type NogginFilePath = string;
export type ItemKey = string;
export type ItemPath = string;
export type IsoTimestamp = string;

export interface Note {
  timestamp: IsoTimestamp;
  text: string;
}

export interface Item {
  key: ItemKey;
  parentKey: ItemKey | null;
  title: string;
  done: boolean;
  pushedAt?: IsoTimestamp;
  notes: Note[];
}

export interface Store {
  schemaVersion: number;
  active: ItemKey | null;
  items: Item[];
}

/** An Item enriched with computed path and 1-based sibling position. */
export interface ItemView extends Item {
  path: ItemPath | null;
  position: number | null;
}

/** Shape returned by every mutating verb and by `show`/`view`. */
export interface CurrentTreeView extends ItemView {
  active: ItemPath | null;
  ancestors: ItemView[];
  siblings: ItemView[];
  /** Omitted when `nokids`/`includeChildren: false`. */
  children?: ItemView[];
}

export type PlacementKind = 'before' | 'after' | 'into';

export interface Placement {
  kind: PlacementKind;
  /** Path to the anchor item. Resolved against the live store. */
  anchor: ItemPath;
}

/** Optional reposition-after-write. Mirrors the CLI `--goto` flag. */
export interface GotoOption {
  /**
   * Path resolved relative to the operation's target.
   * `true` (or omitted with bare `--goto`) means `.` (the target itself).
   */
  goto?: ItemPath | true;
}

export interface FileResolution {
  file: NogginFilePath;
  source: 'flag' | 'env' | 'default';
  exists: boolean;
  defaultFile: NogginFilePath;
  /** Value of $NOGGIN_FILE at the time of resolution, or null. */
  env: string | null;
}

export interface DeleteResult {
  deleted: ItemPath | null;
  descendantCount: number;
  active: ItemPath | null;
  /** Present when the store still has an active item after the delete. */
  view?: CurrentTreeView;
}

export type NogginErrorCode =
  | 'noggin-error'
  | 'no-active-item'
  | 'no-file'
  | 'path-not-found'
  | 'path-required'
  | 'cycle'
  | 'placement-missing'
  | 'placement-invalid'
  | 'title-required'
  | 'text-required'
  | 'state-missing'
  | 'goto-unsupported'
  | 'goto-base-missing'
  | 'goto-path-required'
  | 'goto-unresolved'
  | 'has-descendants'
  | 'open-descendants'
  | 'already-done'
  | 'pop-no-path'
  | 'invalid-note'
  | 'invalid-store'
  | 'unsupported-schema'
  | 'io';

export class NogginError extends Error {
  readonly code: NogginErrorCode | string;
  /** Mirrors the CLI exit code (1 = runtime/state, 2 = usage/parse/invalid). */
  readonly exitCode: number;
  constructor(message: string, opts?: { code?: string; exitCode?: number });
}

// ── Constants ────────────────────────────────────────────────────────────────

export const SCHEMA_VERSION: number;
export const DEFAULT_FILE: NogginFilePath;

// ── Stateless functions ──────────────────────────────────────────────────────

export function resolveFile(opts?: { file?: NogginFilePath; env?: Record<string, string | undefined> }): FileResolution;

export function loadStore(file: NogginFilePath): Store;
export function saveStore(file: NogginFilePath, store: Store): void;

export function resolvePath(store: Store, path: ItemPath): Item;
export function tryResolvePath(store: Store, path: ItemPath): Item | null;

export function pathOf(store: Store, item: Item | null | undefined): ItemPath | null;
export function childrenOf(store: Store, parentKey: ItemKey | null | undefined): Item[];

export function buildView(
  store: Store,
  target: Item,
  opts?: { includeChildren?: boolean }
): CurrentTreeView;

// ── Verb functions (stateless) ───────────────────────────────────────────────

export interface PushOptions { title: string }
export interface AddOptions extends GotoOption { title: string; placement?: Placement }
export interface MoveOptions extends GotoOption { path?: ItemPath; placement: Placement }
export interface GotoOptions { path?: ItemPath }
export interface DoneOptions { path?: ItemPath }
export interface SetStateOptions extends GotoOption { path?: ItemPath; done: boolean }
export interface ShowOptions extends GotoOption { path?: ItemPath; nokids?: boolean; notes?: boolean }
export interface NoteOptions extends GotoOption { path?: ItemPath; text: string }
export interface RetitleOptions extends GotoOption { path?: ItemPath; title: string }
export interface DeleteOptions { path: ItemPath; recursive?: boolean }

export function apiPush(file: NogginFilePath, opts: PushOptions): CurrentTreeView;
export function apiAdd(file: NogginFilePath, opts: AddOptions): CurrentTreeView;
export function apiMove(file: NogginFilePath, opts: MoveOptions): CurrentTreeView;
export function apiGoto(file: NogginFilePath, opts: GotoOptions): CurrentTreeView;
export function apiDone(file: NogginFilePath, opts?: DoneOptions): CurrentTreeView;
export function apiPop(file: NogginFilePath, opts?: {}): CurrentTreeView;
export function apiSetState(file: NogginFilePath, opts: SetStateOptions): CurrentTreeView;
export function apiShow(file: NogginFilePath, opts?: ShowOptions): CurrentTreeView | null;
export function apiNote(file: NogginFilePath, opts: NoteOptions): CurrentTreeView;
export function apiRetitle(file: NogginFilePath, opts: RetitleOptions): CurrentTreeView;
export function apiDelete(file: NogginFilePath, opts: DeleteOptions): DeleteResult;
export function apiWhere(opts?: { file?: NogginFilePath; env?: Record<string, string | undefined> }): FileResolution;

// ── Noggin class ─────────────────────────────────────────────────────────────

export interface Disposable { dispose(): void }
export type Event<T> = (handler: (e: T) => void) => Disposable;

export class Noggin {
  constructor(file: NogginFilePath, opts?: { watch?: boolean });

  readonly file: NogginFilePath;

  readonly store: Readonly<Store>;
  readonly active: Item | null;
  readonly roots: Item[];

  findByKey(key: ItemKey | null | undefined): Item | null;
  childrenOf(parentKey: ItemKey | null | undefined): Item[];
  pathOf(item: Item | null | undefined): ItemPath | null;
  resolvePath(path: ItemPath): Item;
  tryResolvePath(path: ItemPath): Item | null;

  view(
    target?: Item | ItemPath | null,
    opts?: { includeChildren?: boolean }
  ): CurrentTreeView | null;

  reload(): boolean;
  dispose(): void;

  readonly onDidChange: Event<void>;
  readonly onDidError: Event<NogginError>;

  push(opts: PushOptions): CurrentTreeView;
  add(opts: AddOptions): CurrentTreeView;
  move(opts: MoveOptions): CurrentTreeView;
  goto(path: ItemPath): CurrentTreeView;
  done(opts?: DoneOptions): CurrentTreeView;
  pop(): CurrentTreeView;
  setState(opts: SetStateOptions): CurrentTreeView;
  show(opts?: ShowOptions): CurrentTreeView | null;
  note(opts: NoteOptions): CurrentTreeView;
  retitle(opts: RetitleOptions): CurrentTreeView;
  delete(opts: DeleteOptions): DeleteResult;
  where(): FileResolution;
}

export function openNoggin(file: NogginFilePath): Noggin;
