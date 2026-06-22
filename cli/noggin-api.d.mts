// Type declarations for noggin-api.mjs.
//
// Hand-written to match the JS implementation; no build step. The .mjs uses
// /// <reference path="./noggin-api.d.mts" /> so editors and tsc --noEmit can
// check usages against this contract.
//
// API stability tiers (TSDoc release tags):
//   @public      — Stable contract. Breaking changes require a major bump.
//   @experimental — Public but the shape may still change.
//   @internal    — Implementation detail; do not depend on this.
//
// New release tags get added in code; their meanings live here.

// ── Core identifiers ─────────────────────────────────────────────────────────

/** @public Absolute or relative path to a noggin file on disk. */
export type NogginFilePath = string;

/** @public Opaque, stable item identifier. Treat as a string token. */
export type ItemKey = string;

/** @public Tree path string (e.g. `/1/2/3` or `./X`). Display coordinate only — don't store long-term. */
export type ItemPath = string;

/** @public ISO-8601 / RFC 3339 date-time string. */
export type IsoTimestamp = string;

// ── Data model ───────────────────────────────────────────────────────────────

/** @public A single entry in an item's append-only note log. */
export interface Note {
  timestamp: IsoTimestamp;
  text: string;
}

/** @public A single work item in the noggin tree. */
export interface Item {
  key: ItemKey;
  parentKey: ItemKey | null;
  title: string;
  done: boolean;
  createdAt?: IsoTimestamp;
  notes: Note[];
}

/**
 * @public
 * The serialized form of a noggin: pure data, what the JSON Schema
 * validates, what serializers convert to/from. A live `Noggin`
 * holds one of these internally but does not expose `schemaVersion`
 * to callers.
 */
export interface NogginDocument {
  schemaVersion: number;
  active: ItemKey | null;
  items: Item[];
}

/** @public An Item enriched with computed path and 1-based sibling position. */
export interface ItemView extends Item {
  path: ItemPath | null;
  position: number | null;
}

/**
 * @public
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

/** @public Shape returned by every mutating verb and by `show`/`view`. */
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

/** @public Identifying tombstone for a deleted item — survives the delete itself. */
export interface DeletedItem {
  key: ItemKey;
  path: ItemPath | null;
  title: string;
}

/** @public Placement kind for `add` / `move`. */
export type PlacementKind = 'before' | 'after' | 'into';

/** @public Placement spec for `add` / `move`. */
export interface Placement {
  kind: PlacementKind;
  /** Path to the anchor item. Resolved against the live store. */
  anchor: ItemPath;
}

/** @public Optional reposition-after-write. Mirrors the CLI `--goto` flag. */
export interface GotoOption {
  /**
   * Path resolved relative to the operation's target.
   * `true` (or omitted with bare `--goto`) means `.` (the target itself).
   */
  goto?: ItemPath | true;
}

/** @public Result of `delete`. */
export interface DeleteResult {
  deleted: DeletedItem;
  descendantCount: number;
  /** Null only when the resulting tree has no active item (e.g. a root was deleted). */
  view: CurrentTreeView | null;
}

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * @public
 * Closed union of error codes the engine itself emits. Backends and
 * consumers may introduce additional codes; treat unknown values as
 * non-breaking additions (don't exhaustively switch on this type).
 */
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

/** @public Thrown by every engine function on usage/state errors. */
export class NogginError extends Error {
  readonly code: NogginErrorCode | string;
  /** Mirrors the CLI exit code (1 = runtime/state, 2 = usage/parse/invalid). */
  readonly exitCode: number;
  constructor(message: string, opts?: { code?: string; exitCode?: number });
}

// ── Constants ────────────────────────────────────────────────────────────────

/** @public Current `schemaVersion` written into a `NogginDocument`. */
export const SCHEMA_VERSION: number;

/**
 * @public
 * Current `envelopeVersion` stamped onto every response envelope
 * (CLI `--json`, MCP tool responses, extension LM tool responses).
 * Distinct from `SCHEMA_VERSION`; bumps independently when the
 * envelope shape or any per-verb payload changes in a breaking way.
 */
export const RESPONSE_ENVELOPE_VERSION: number;

/**
 * @public
 * @deprecated Renamed to `RESPONSE_ENVELOPE_VERSION`. Will be removed
 *             in a future major.
 */
export const JSON_SCHEMA_VERSION: number;

// ── Document I/O (used by backends and serializers) ─────────────────────────

/**
 * @internal
 * File-based load/save. Used by the file backend; prefer
 * `fileNoggin()` from `./backends/file.mjs` over these. For raw
 * `NogginDocument` I/O without a live `Noggin`, use the serializers
 * in `./serializers/{yaml,json}.mjs` instead.
 */
export function loadStore(file: NogginFilePath): NogginDocument;
/** @internal See `loadStore`. */
export function saveStore(file: NogginFilePath, doc: NogginDocument): void;

// ── Document utilities ──────────────────────────────────────────────────────

/** @public Resolve a path against a document; throw `NogginError` if not found. */
export function resolvePath(doc: NogginDocument, path: ItemPath): Item;
/** @public Like `resolvePath` but returns `null` instead of throwing. */
export function tryResolvePath(doc: NogginDocument, path: ItemPath): Item | null;
/** @public Compute the absolute path string for an item. */
export function pathOf(doc: NogginDocument, item: Item | null | undefined): ItemPath | null;
/** @public Direct children of `parentKey` (null = roots), in tree order. */
export function childrenOf(doc: NogginDocument, parentKey: ItemKey | null | undefined): Item[];

/**
 * @public
 * Build a `CurrentTreeView` for `target`. Pure; does not mutate the
 * document. Prefer `Noggin.show()` / `Noggin.view()` for live use;
 * this is the building block.
 */
export function buildView(
  doc: NogginDocument,
  target: Item,
  opts?: { includeChildren?: boolean; withSiblings?: boolean; withDescendants?: boolean }
): CurrentTreeView;

// ── Response envelope ───────────────────────────────────────────────────────

/**
 * @public
 * Canonical response envelope shared by the CLI `--json` output and
 * the VS Code extension's language-model tools. Both surfaces emit
 * this exact shape so a single consumer (or test) can target both.
 */
export interface SuccessEnvelope<T = unknown> {
  status: 'ok';
  envelopeVersion: number;
  verb: string | null;
  data: T;
}

/** @public Error counterpart of `SuccessEnvelope`. */
export interface ErrorEnvelope {
  status: 'error';
  envelopeVersion: number;
  verb: string | null;
  error: {
    code: NogginErrorCode | string;
    message: string;
    exitCode: number;
  };
}

/** @public Union of `SuccessEnvelope` and `ErrorEnvelope`. */
export type JsonEnvelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;

/** @public Wrap a successful verb result in the canonical envelope. */
export function formatSuccess<T>(opts: {
  verb?: string;
  data?: T;
}): SuccessEnvelope<T>;

/** @public Wrap an error in the canonical envelope. */
export function formatError(opts: {
  verb?: string;
  error: unknown;
}): ErrorEnvelope;

// ── Verb option types ───────────────────────────────────────────────────────

/** @public */
export interface PushOptions { title: string }
/** @public */
export interface AddOptions extends GotoOption { title: string; placement?: Placement }
/** @public */
export interface MoveOptions extends GotoOption { path?: ItemPath; placement: Placement }
/** @public */
export interface GotoOptions { path?: ItemPath }

/** @public Shared shape for closing verbs (`done`, `pop`, `edit --done`). */
export interface CloseOptions {
  /** Skip the open-descendant safety check; close the target even with open kids. */
  force?: boolean;
  /** Close every open descendant first (each gets its own system close note). */
  closeAll?: boolean;
}

/** @public */
export interface DoneOptions extends CloseOptions { path?: ItemPath }
/** @public */
export interface PopOptions extends CloseOptions {}

/**
 * @public
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

/** @public */
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
/** @public */
export interface NoteOptions extends GotoOption { path?: ItemPath; text: string }
/** @public */
export interface DeleteOptions { path: ItemPath; recursive?: boolean }

// ── Pure verb functions ─────────────────────────────────────────────────────

/**
 * @public
 * Context object accepted by every `applyX` function. Today only
 * carries an optional clock; future fields will be additive.
 */
export interface ApplyContext {
  /** Fixed clock for deterministic timestamps in tests. */
  now?: Date;
}

/**
 * @public
 * Pure verb function over a `NogginDocument`. Mutates `doc` in place
 * and returns the resulting view. Pass `ctx.now` for deterministic
 * timestamps in tests. Used internally by the `Noggin` class; exposed
 * for callers operating on documents directly (e.g. composing
 * snapshots in memory).
 */
export function applyPush(doc: NogginDocument, opts: PushOptions, ctx?: ApplyContext): { doc: NogginDocument; view: CurrentTreeView };
/** @public See {@link applyPush}. */
export function applyAdd(doc: NogginDocument, opts: AddOptions, ctx?: ApplyContext): { doc: NogginDocument; view: CurrentTreeView };
/** @public See {@link applyPush}. */
export function applyMove(doc: NogginDocument, opts: MoveOptions): { doc: NogginDocument; view: CurrentTreeView };
/** @public See {@link applyPush}. */
export function applyGoto(doc: NogginDocument, opts: GotoOptions): { doc: NogginDocument; view: CurrentTreeView };
/** @public See {@link applyPush}. */
export function applyDone(doc: NogginDocument, opts?: DoneOptions, ctx?: ApplyContext): { doc: NogginDocument; view: CurrentTreeView };
/** @public See {@link applyPush}. */
export function applyPop(doc: NogginDocument, opts?: PopOptions, ctx?: ApplyContext): { doc: NogginDocument; view: CurrentTreeView };
/** @public See {@link applyPush}. */
export function applyEdit(doc: NogginDocument, opts: EditOptions, ctx?: ApplyContext): { doc: NogginDocument; view: CurrentTreeView };
/** @public See {@link applyPush}. Read-only unless `opts.goto` is set. */
export function applyShow(doc: NogginDocument, opts?: ShowOptions): { doc: NogginDocument; view: CurrentTreeView | null };
/** @public See {@link applyPush}. */
export function applyNote(doc: NogginDocument, opts: NoteOptions, ctx?: ApplyContext): { doc: NogginDocument; view: CurrentTreeView };
/** @public See {@link applyPush}. Returns a `DeleteResult` instead of a view. */
export function applyDelete(doc: NogginDocument, opts: DeleteOptions): { doc: NogginDocument; result: DeleteResult };

// ── Eventing primitives ─────────────────────────────────────────────────────

/** @public Disposable returned by event subscriptions. */
export interface Disposable { dispose(): void }
/** @public vscode-style event subscribe function. */
export type Event<T> = (handler: (e: T) => void) => Disposable;

// ── Noggin class ────────────────────────────────────────────────────────────

/**
 * @public
 * Live noggin handle. Owns a cached `NogginDocument`, an optional
 * file watcher, and event streams. Verb methods are asynchronous;
 * per-instance calls are serialized through an internal Promise
 * chain.
 *
 * @remarks
 * Prefer the backend factories (`fileNoggin()` from
 * `./backends/file.mjs`) over `new Noggin(...)` directly. The class
 * constructor is `@internal`-ish — exposed so backends can subclass
 * or hand-construct instances, not for end-user code.
 */
export class Noggin {
  /** @internal Prefer `fileNoggin()` over calling this directly. */
  constructor(file: NogginFilePath, opts?: { watch?: boolean });

  /** @public Path to the underlying file (file backend only). */
  readonly file: NogginFilePath;

  /**
   * @public
   * Deep-frozen snapshot of the current document. Safe to read; do
   * not mutate. Calls to verb methods will replace this reference.
   */
  readonly store: Readonly<NogginDocument>;

  /** @public The currently active item, or null. */
  readonly active: Item | null;
  /** @public Root items, in tree order. */
  readonly roots: Item[];

  /** @public */
  findByKey(key: ItemKey | null | undefined): Item | null;
  /** @public */
  childrenOf(parentKey: ItemKey | null | undefined): Item[];
  /** @public */
  pathOf(item: Item | null | undefined): ItemPath | null;
  /** @public */
  resolvePath(path: ItemPath): Item;
  /** @public */
  tryResolvePath(path: ItemPath): Item | null;

  /**
   * @public
   * Build a CurrentTreeView. `target` may be an item, a path string,
   * or null (defaults to the active item). Returns null if no target
   * is found.
   */
  view(
    target?: Item | ItemPath | null,
    opts?: { includeChildren?: boolean }
  ): CurrentTreeView | null;

  /**
   * @public
   * Force a re-read from disk. Returns true if the cached document
   * actually changed. Usually unnecessary — the watcher and verb
   * methods keep the cache fresh on their own.
   */
  reload(): Promise<boolean>;

  /**
   * @public
   * Release backend resources (watchers, lock handles, network
   * connections). After dispose the noggin is unusable.
   */
  dispose(): Promise<void>;

  /** @public Fires after every change to the cached document. */
  readonly onDidChange: Event<void>;
  /** @public Fires for backend-level errors (verb errors are thrown). */
  readonly onDidError: Event<NogginError>;

  /** @public */
  push(opts: PushOptions): Promise<CurrentTreeView>;
  /** @public */
  add(opts: AddOptions): Promise<CurrentTreeView>;
  /** @public */
  move(opts: MoveOptions): Promise<CurrentTreeView>;
  /** @public */
  goto(path: ItemPath): Promise<CurrentTreeView>;
  /** @public */
  done(opts?: DoneOptions): Promise<CurrentTreeView>;
  /** @public */
  pop(opts?: PopOptions): Promise<CurrentTreeView>;
  /** @public */
  edit(opts: EditOptions): Promise<CurrentTreeView>;
  /** @public */
  show(opts?: ShowOptions): Promise<CurrentTreeView | null>;
  /** @public */
  note(opts: NoteOptions): Promise<CurrentTreeView>;
  /** @public */
  delete(opts: DeleteOptions): Promise<DeleteResult>;

  /**
   * @public
   * Backend introspection. Returns a human-readable string
   * describing where this noggin lives and any relevant backend
   * state. Format is backend-defined and *not* machine-parseable.
   */
  describe(): string;
}

/**
 * @public
 * Convenience wrapper for `fileNoggin(file, { watch: true })`.
 * Prefer `fileNoggin` from `./backends/file.mjs` for explicit
 * backend selection.
 */
export function openNoggin(file: NogginFilePath): Promise<Noggin>;
