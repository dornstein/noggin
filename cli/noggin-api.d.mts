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
  createdAt?: IsoTimestamp;
  notes: Note[];
}

export interface NogginDocument {
  schemaVersion: number;
  active: ItemKey | null;
  items: Item[];
}

/** An Item enriched with computed path and 1-based sibling position. */
export interface ItemView extends Item {
  path: ItemPath | null;
  position: number | null;
}

/**
 * A node in a CurrentTreeView's recursive tree. Carries the usual
 * ItemView fields plus an *optional* `children` slot:
 *
 *   children present  this view renders this node's child level (the
 *                     array may be empty — e.g. target with no kids)
 *   children absent   leaf of this view; the store may have a subtree
 *                     here, but this view doesn't render it
 *
 * The recursion walks the direct ancestor chain from root to target.
 * Each ancestor has a single-element `children`. The target's parent
 * has the full peer row. The target has `children` populated with its
 * first-level kids (or no `children` field at all with `--nokids`).
 * Peers and grandkids are leaves and have no `children` field.
 */
export interface ViewNode extends ItemView {
  children?: ViewNode[];
}

/** Shape returned by every mutating verb and by `show`/`view`. */
export interface CurrentTreeView {
  /** Path of the active item, or null. May differ from the target —
   *  active is the user's persistent cursor (📍) and is not necessarily
   *  on the spine of this view. */
  activePath: ItemPath | null;
  /** Stable key of the active item, or null. */
  activeKey: ItemKey | null;
  /** Stable key of the item the verb acted on. To grab the full row,
   *  walk `items` and find the node whose `key === targetKey`. */
  targetKey: ItemKey;
  /**
   * Top of the rendered tree. Contains either:
   *   - a single root ancestor (when the target is below depth 0); or
   *   - the target's full peer row (when the target itself is a root).
   * Either way, every node along the path from `items` down to the
   * target has a non-null `children`; leaves of the view have `null`.
   */
  items: ViewNode[];
}

/** Identifying tombstone for a deleted item — survives the delete itself. */
export interface DeletedItem {
  key: ItemKey;
  path: ItemPath | null;
  title: string;
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
  deleted: DeletedItem;
  descendantCount: number;
  /** Null only when the resulting tree has no active item (e.g. a root was deleted). */
  view: CurrentTreeView | null;
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
  | 'nothing-to-edit'
  | 'option-misused'
  | 'goto-unsupported'
  | 'goto-base-missing'
  | 'goto-path-required'
  | 'goto-unresolved'
  | 'has-descendants'
  | 'open-descendants'
  | 'pop-no-path'
  | 'invalid-note'
  | 'invalid-document'
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
export const JSON_SCHEMA_VERSION: number;
export const DEFAULT_FILE: NogginFilePath;

// ── Stateless functions ──────────────────────────────────────────────────────

export function resolveFile(opts?: { file?: NogginFilePath; env?: Record<string, string | undefined> }): FileResolution;

export function loadStore(file: NogginFilePath): NogginDocument;
export function saveStore(file: NogginFilePath, doc: NogginDocument): void;

export function resolvePath(doc: NogginDocument, path: ItemPath): Item;
export function tryResolvePath(doc: NogginDocument, path: ItemPath): Item | null;

export function pathOf(doc: NogginDocument, item: Item | null | undefined): ItemPath | null;
export function childrenOf(doc: NogginDocument, parentKey: ItemKey | null | undefined): Item[];

export function buildView(
  doc: NogginDocument,
  target: Item,
  opts?: { includeChildren?: boolean; withSiblings?: boolean; withDescendants?: boolean }
): CurrentTreeView;

// ── JSON envelope ────────────────────────────────────────────────────────────

/**
 * Canonical JSON envelope shared by the CLI `--json` output and the VS
 * Code extension's language-model tools. Both surfaces emit this exact
 * shape so a single consumer (or test) can target both.
 */
export interface SuccessEnvelope<T = unknown> {
  status: 'ok';
  schemaVersion: number;
  verb: string | null;
  file: NogginFilePath | null;
  data: T;
}

export interface ErrorEnvelope {
  status: 'error';
  schemaVersion: number;
  verb: string | null;
  file: NogginFilePath | null;
  error: {
    code: NogginErrorCode | string;
    message: string;
    exitCode: number;
  };
}

export type JsonEnvelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;

export function formatSuccess<T>(opts: {
  verb?: string;
  file?: NogginFilePath | null;
  data?: T;
}): SuccessEnvelope<T>;

export function formatError(opts: {
  verb?: string;
  file?: NogginFilePath | null;
  error: unknown;
}): ErrorEnvelope;

// ── Verb functions (stateless) ───────────────────────────────────────────────

export interface PushOptions { title: string }
export interface AddOptions extends GotoOption { title: string; placement?: Placement }
export interface MoveOptions extends GotoOption { path?: ItemPath; placement: Placement }
export interface GotoOptions { path?: ItemPath }

/** Shared shape for closing verbs (`done`, `pop`, `set --done`). */
export interface CloseOptions {
  /** Skip the open-descendant safety check; close the target even with open kids. */
  force?: boolean;
  /** Close every open descendant first (each gets its own system close note). */
  closeAll?: boolean;
}

export interface DoneOptions extends CloseOptions { path?: ItemPath }
export interface PopOptions extends CloseOptions {}

/**
 * `edit` combines the old `set-state` and `retitle` verbs into one
 * idempotent mutation verb. Specify at least one of `done`/`title`;
 * each operation is a no-op when the value already matches.
 */
export interface EditOptions extends GotoOption, CloseOptions {
  path?: ItemPath;
  /** true → close, false → reopen, undefined → don't touch state. */
  done?: boolean;
  /** New title (trimmed). Empty/whitespace is ignored, not an error. */
  title?: string;
}

export interface ShowOptions extends GotoOption {
  path?: ItemPath;
  /** Whether to expand the target's `children` field. Default true; set false for --no-children. */
  includeChildren?: boolean;
  /** Show note bodies in human output (no effect on JSON — notes are always present). */
  withNotes?: boolean;
  /** Include the full sibling row at every ancestor depth. */
  withSiblings?: boolean;
  /** Expand the target's subtree recursively. */
  withDescendants?: boolean;
}
export interface NoteOptions extends GotoOption { path?: ItemPath; text: string }
export interface DeleteOptions { path: ItemPath; recursive?: boolean }

export function apiPush(file: NogginFilePath, opts: PushOptions): CurrentTreeView;
export function apiAdd(file: NogginFilePath, opts: AddOptions): CurrentTreeView;
export function apiMove(file: NogginFilePath, opts: MoveOptions): CurrentTreeView;
export function apiGoto(file: NogginFilePath, opts: GotoOptions): CurrentTreeView;
export function apiDone(file: NogginFilePath, opts?: DoneOptions): CurrentTreeView;
export function apiPop(file: NogginFilePath, opts?: PopOptions): CurrentTreeView;
export function apiEdit(file: NogginFilePath, opts: EditOptions): CurrentTreeView;
export function apiShow(file: NogginFilePath, opts?: ShowOptions): CurrentTreeView | null;
export function apiNote(file: NogginFilePath, opts: NoteOptions): CurrentTreeView;
export function apiDelete(file: NogginFilePath, opts: DeleteOptions): DeleteResult;
export function apiWhere(opts?: { file?: NogginFilePath; env?: Record<string, string | undefined> }): FileResolution;

// ── Noggin class ─────────────────────────────────────────────────────────────

export interface Disposable { dispose(): void }
export type Event<T> = (handler: (e: T) => void) => Disposable;

export class Noggin {
  constructor(file: NogginFilePath, opts?: { watch?: boolean });

  readonly file: NogginFilePath;

  readonly store: Readonly<NogginDocument>;
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
  pop(opts?: PopOptions): CurrentTreeView;
  edit(opts: EditOptions): CurrentTreeView;
  show(opts?: ShowOptions): CurrentTreeView | null;
  note(opts: NoteOptions): CurrentTreeView;
  delete(opts: DeleteOptions): DeleteResult;
  where(): FileResolution;
}

export function openNoggin(file: NogginFilePath): Noggin;
