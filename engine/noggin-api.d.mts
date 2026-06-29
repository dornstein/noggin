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

// ── Core identifiers ─────────────────────────────────────────────────────────

/** @public Opaque, stable item identifier. Treat as a string token. */
export type ItemKey = string;

/** @public Tree path string (e.g. `/1/2/3` or `./X`). Display coordinate only. */
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
 * The serialized form of a noggin: pure data. The JSON Schema validates
 * this shape; serializers convert it to/from YAML or JSON; providers
 * load and save it.
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

/** @public A node in a CurrentTreeView's recursive tree. */
export interface ViewNode extends ItemView {
  children?: ViewNode[];
}

/** @public Shape returned by every mutating verb and by `verbs.show`. */
export interface CurrentTreeView {
  activePath: ItemPath | null;
  activeKey: ItemKey | null;
  targetKey: ItemKey;
  items: ViewNode[];
}

/** @public Identifying tombstone for a deleted item. */
export interface DeletedItem {
  key: ItemKey;
  path: ItemPath | null;
  title: string;
}

/** @public */
export type PlacementKind = 'before' | 'after' | 'into';

/** @public Placement spec for `add` / `move`. */
export interface Placement {
  kind: PlacementKind;
  /** Path to the anchor item. */
  anchor: ItemPath;
}

/** @public Optional reposition-after-write. Mirrors the CLI `--goto` flag. */
export interface GotoOption {
  /** Path resolved relative to the operation's target. `true` means `.`. */
  goto?: ItemPath | true;
}

/** @public Result of `verbs.delete`. */
export interface DeleteResult {
  deleted: DeletedItem;
  descendantCount: number;
  view: CurrentTreeView | null;
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** @public Closed-ish union of error codes. New codes are non-breaking. */
export type NogginErrorCode =
  | 'noggin-error'
  | 'no-active-item'
  | 'no-file'
  | 'no-location'
  | 'no-provider'
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
  | 'invalid-op'
  | 'invalid-document'
  | 'unsupported-schema'
  | 'lock-timeout'
  | 'io'
  | 'source-required'
  | 'dest-required';

/**
 * @public
 * Structured payload attached to `NogginError.data`. Each error
 * `code` carries a known set of fields (best-effort — additional
 * fields are non-breaking). Hosts that render user-facing strings
 * key off `code` and read fields from here.
 *
 * Engine `message` is a short host-neutral fact for logs and
 * fallback. Hosts SHOULD prefer their own catalog (see e.g.
 * `cli/error-messages.mjs`, `@noggin/ui/errors`) over showing
 * `message` directly.
 *
 * Common fields:
 *   - `verb`     — the verb name where the error originated (e.g. `'move'`).
 *   - `path`     — absolute path of the item involved.
 *   - `title`    — the item's title at the time of the error.
 *   - `detail`   — free-form supplementary text (e.g. underlying I/O message).
 *
 * Code-specific fields (illustrative; treat as additive):
 *   - `open-descendants`: `{ verb, path, title, openCount }`
 *   - `has-descendants`:  `{ verb, path, title, descendantCount }`
 *   - `cycle`:            `{ verb, path, title, placementKind }`
 *   - `path-not-found`:   `{ path, detail }`
 *   - `no-provider`:      `{ scheme?, location }`
 *   - `placement-invalid`: `{ verb, kind }`
 *   - `invalid-document`: `{ key?, parentKey?, active? }`
 */
export interface NogginErrorData {
  readonly verb?: string;
  readonly path?: string;
  readonly title?: string;
  readonly detail?: string;
  readonly openCount?: number;
  readonly descendantCount?: number;
  readonly placementKind?: 'before' | 'after' | 'into';
  readonly kind?: string;
  readonly scheme?: string;
  readonly location?: string;
  readonly key?: string;
  readonly parentKey?: string;
  readonly active?: string;
  readonly position?: unknown;
  readonly opType?: string;
  readonly [extra: string]: unknown;
}

/** @public Thrown by every engine function on usage/state errors. */
export class NogginError extends Error {
  readonly code: NogginErrorCode | string;
  /** Mirrors the CLI exit code (1 = runtime/state, 2 = usage/parse/invalid). */
  readonly exitCode: number;
  /** Frozen, structured payload. See {@link NogginErrorData}. */
  readonly data: Readonly<NogginErrorData>;
  constructor(message: string, opts?: { code?: string; exitCode?: number; data?: NogginErrorData });
}

// ── Constants ────────────────────────────────────────────────────────────────

/** @public Current `schemaVersion` written into a `NogginDocument`. */
export const SCHEMA_VERSION: number;

/** @public Current `envelopeVersion` stamped onto every response envelope. */
export const RESPONSE_ENVELOPE_VERSION: number;

/** @public @deprecated Renamed to `RESPONSE_ENVELOPE_VERSION`. */
export const JSON_SCHEMA_VERSION: number;

/** @public The system-generated note text appended on close. */
export const CLOSE_NOTE_TEXT: string;

// ── Eventing primitives ─────────────────────────────────────────────────────

/** @public Disposable returned by event subscriptions. */
export interface Disposable { dispose(): void }

/** @public vscode-style event subscribe function. */
export type Event<T> = (handler: (e: T) => void) => Disposable;

// ── Change events ───────────────────────────────────────────────────────────

/**
 * @public
 * One observable change to a Noggin. The vocabulary is deliberately
 * small and decoupled from `AtomicOp`: listeners observe *what
 * changed*, not *which op caused it*.
 *
 * `position` is the 0-based index among siblings of `parentKey`. For
 * `moved`, `from` describes the position in the document before the
 * change and `to` after.
 */
export type ItemChange =
  | { kind: 'added'; key: ItemKey; parentKey: ItemKey | null; position: number }
  | { kind: 'removed'; key: ItemKey }
  | {
      kind: 'moved';
      key: ItemKey;
      from: { parentKey: ItemKey | null; position: number };
      to: { parentKey: ItemKey | null; position: number };
    }
  | { kind: 'updated'; key: ItemKey; fields: Array<'title' | 'done' | 'notes'> }
  | { kind: 'activeChanged'; from: ItemKey | null; to: ItemKey | null };

/**
 * @public
 * Payload of `Noggin.onDidChange`. A flat list of every shift between
 * the previous document state and the current one.
 *
 * The shape is provider-agnostic: every provider fires `ChangeEvent`
 * (an `ItemChange[]`) for both in-process mutations and externally-
 * observed reloads. Listeners receive the same value regardless of
 * which side caused the change.
 */
export type ChangeEvent = readonly ItemChange[];

// ── Noggin (interface) ──────────────────────────────────────────────────────

/**
 * @public
 * A live noggin. The handle every consumer uses to drive verbs and
 * read state — independent of whether the noggin lives in this
 * process or behind an RPC transport.
 *
 * Two implementations satisfy this shape today:
 *
 *   - In-process providers (`MemoryNoggin`, `FileNoggin` etc.). They
 *     also satisfy the wider {@link NogginStore} contract, which adds
 *     the atomic `apply()` primitive that verbs use internally.
 *   - `RemoteNoggin` from `@noggin/rpc`, which dispatches verbs over
 *     a JSON-RPC transport. Local accessors stay synchronous because
 *     `RemoteNoggin` mirrors the server's state into a memory noggin
 *     and reconciles on each `noggin.changed` notification.
 *
 * Storage-tracking contract:
 *   - Accessors always reflect the latest known state.
 *   - `onDidChange` fires after every mutation (in-process, externally
 *     observed, or remote). After it fires, accessors are up to date.
 *
 * Verb method semantics mirror the free `verbs.*(noggin, opts)`
 * namespace: same option shapes, same return types, same error codes.
 * They're convenience bindings — `noggin.push(opts)` is identical to
 * `verbs.push(noggin, opts)` for in-process callers. Hosts and UI
 * components should prefer the methods so the same code works against
 * any noggin.
 */
export interface Noggin {
  // ── Read accessors (sync) ──────────────────────────────────────────
  readonly items: readonly Item[];
  readonly active: Item | null;
  readonly roots: readonly Item[];

  findByKey(k: ItemKey | null | undefined): Item | null;
  childrenOf(k: ItemKey | null | undefined): readonly Item[];
  pathOf(item: Item | null | undefined): ItemPath | null;
  tryResolvePath(p: ItemPath): Item | null;

  // ── Bound verb methods ─────────────────────────────────────────────
  /** Create a child of active and immediately become it. */
  push(opts: PushOptions): Promise<CurrentTreeView>;
  /** Create a child without making it active. */
  add(opts: AddOptions): Promise<CurrentTreeView>;
  /** Relocate an item under a new parent / among siblings. */
  move(opts: MoveOptions): Promise<CurrentTreeView>;
  /** Make the item at the given path active. */
  goto(opts: GotoOptions): Promise<CurrentTreeView>;
  /** Mark target done and surface to its parent. Idempotent. */
  done(opts?: DoneOptions): Promise<CurrentTreeView>;
  /** Shorthand for done on the active item. */
  pop(opts?: PopOptions): Promise<CurrentTreeView>;
  /** Idempotent mutation of an item's done state and/or title. */
  edit(opts: EditOptions): Promise<CurrentTreeView>;
  /** Render the current-position view (spine + peers + first-level children). */
  show(opts?: ShowOptions): Promise<CurrentTreeView | null>;
  /** Append a timestamped note to an item. */
  note(opts: NoteOptions): Promise<CurrentTreeView>;
  /** Remove an item (and optionally its subtree). */
  delete(opts: DeleteOptions): Promise<DeleteResult>;

  // ── Lifecycle + events ─────────────────────────────────────────────
  /** Release provider resources. After dispose the noggin is unusable. */
  dispose(): Promise<void>;

  /** Human-readable description of where this noggin lives. Not machine-parseable. */
  describe(): string;

  readonly onDidChange: Event<ChangeEvent>;
  readonly onDidError: Event<NogginError>;
}

/**
 * @public
 * The provider-side contract: a {@link Noggin} plus the atomic
 * `apply(ops)` primitive that verbs use to compose state changes,
 * and the throwing-on-miss `resolvePath` companion to
 * {@link Noggin.tryResolvePath}.
 *
 * In-process providers (memory, file) implement this. `RemoteNoggin`
 * does not — `apply` requires locally-constructed ops against current
 * state, which the wire protocol doesn't model.
 *
 * The `verbs.*(noggin, opts)` namespace consumes `NogginStore`. UI
 * code and gestures take a plain {@link Noggin} and call the bound
 * verb methods on it instead.
 */
export interface NogginStore extends Noggin {
  /** Atomically apply a list of `AtomicOp`s. The only write primitive. */
  apply(ops: readonly AtomicOp[]): Promise<void>;
  /** Resolve a path, throwing `NogginError('path-not-found')` on miss. */
  resolvePath(p: ItemPath): Item;
}

// ── Atomic ops ──────────────────────────────────────────────────────────────

/**
 * @public
 * Atomic state mutations. Every change to a noggin's state goes through
 * one of these. Verbs compose op lists; providers execute them
 * atomically via `Noggin.apply(ops)`.
 *
 * `position` is the 0-based index among siblings of `parentKey`, or
 * the literal string `'end'` to append.
 */
export type AtomicOp =
  | { type: 'add'; item: Item; parentKey: ItemKey | null; position: number | 'end' }
  | { type: 'remove'; keys: readonly ItemKey[] }
  | { type: 'set'; key: ItemKey; patch: { title?: string; done?: boolean } }
  | { type: 'note'; key: ItemKey; note: Note }
  | { type: 'move'; key: ItemKey; parentKey: ItemKey | null; position: number | 'end' }
  | { type: 'setActive'; key: ItemKey | null };

/**
 * @public
 * Apply a list of `AtomicOp`s to a `NogginDocument` in-place, then
 * validate. Used by providers inside their `apply()`; also useful for
 * offline document manipulation. Throws `NogginError` if any op
 * references missing data or the resulting document is malformed.
 */
export function applyOps(doc: NogginDocument, ops: readonly AtomicOp[]): NogginDocument;

/**
 * @public
 * Validate a document's structural invariants. Throws `NogginError`
 * with code `'invalid-document'` on failure.
 */
export function validateDocument(doc: NogginDocument): void;

/**
 * @public
 * Normalize a parsed document in-place: stamp schemaVersion, normalize
 * notes, strip legacy fields.
 */
export function normalizeDocument(doc: NogginDocument): NogginDocument;

/** @internal Used by serializers and `applyOps`. */
export function normalizeNote(note: { timestamp?: string | null; text: string }): Note;

/**
 * @public
 * Structural equality between two documents. Used by providers to
 * decide whether an external change actually changed anything.
 */
export function documentsEqual(a: NogginDocument, b: NogginDocument): boolean;

/**
 * @public
 * Deep-freeze a document so accessors can return references without
 * worrying about consumer mutation.
 */
export function freezeDocument(doc: NogginDocument): NogginDocument;

/**
 * @public
 * Compute the list of `ItemChange`s describing the differences between
 * two document snapshots. Pure; doesn't mutate either input. Used by
 * providers to fire `onDidChange` with a concrete payload.
 */
export function diffDocuments(prev: NogginDocument, next: NogginDocument): ItemChange[];

// ── Verbs ───────────────────────────────────────────────────────────────────

/** @public Optional context for verbs that stamp timestamps. */
export interface VerbContext {
  /** Fixed clock for deterministic timestamps in tests. */
  now?: Date;
}

/** @public */
export interface PushOptions { title: string }
/** @public */
export interface AddOptions extends GotoOption { title: string; placement?: Placement }
/** @public */
export interface MoveOptions extends GotoOption { path?: ItemPath; placement: Placement }
/** @public */
export interface GotoOptions { path: ItemPath }

/** @public Shared shape for closing verbs (`done`, `pop`, `edit --done`). */
export interface CloseOptions {
  force?: boolean;
  closeAll?: boolean;
}

/** @public */
export interface DoneOptions extends CloseOptions { path?: ItemPath }
/** @public */
export interface PopOptions extends CloseOptions {}

/** @public */
export interface EditOptions extends GotoOption, CloseOptions {
  path?: ItemPath;
  done?: boolean;
  title?: string;
}

/** @public */
export interface ShowOptions extends GotoOption {
  path?: ItemPath;
  includeChildren?: boolean;
  withNotes?: boolean;
  withSiblings?: boolean;
  withDescendants?: boolean;
}
/** @public */
export interface NoteOptions extends GotoOption { path?: ItemPath; text: string }
/** @public */
export interface DeleteOptions { path: ItemPath; recursive?: boolean }

/**
 * @public
 * The single verb implementation, shared by every provider. Each verb
 * reads state via the noggin's accessors, composes an `AtomicOp[]`,
 * calls `noggin.apply(ops)` once, and returns the resulting view (or
 * a `DeleteResult` for delete).
 *
 * Verb behavior contracts (push moves active, add doesn't, done
 * appends a close note and surfaces to parent, etc.) live here.
 * Providers do not implement verbs.
 *
 * The `noggin` parameter is typed as {@link NogginStore} because
 * verbs need the atomic `apply()` primitive only providers expose.
 * UI/host code typically calls the bound verb methods on
 * {@link Noggin} instead (which delegate here for in-process nogins,
 * and dispatch over RPC for `RemoteNoggin`).
 */
export interface Verbs {
  /** Create a child of active and immediately become it. */
  push(noggin: NogginStore, opts: PushOptions, ctx?: VerbContext): Promise<CurrentTreeView>;
  /** Create a child without making it active (capture a deferred todo). */
  add(noggin: NogginStore, opts: AddOptions, ctx?: VerbContext): Promise<CurrentTreeView>;
  /** Relocate an item under a new parent / among siblings. */
  move(noggin: NogginStore, opts: MoveOptions): Promise<CurrentTreeView>;
  /** Make the item at the given path active. */
  goto(noggin: NogginStore, opts: GotoOptions): Promise<CurrentTreeView>;
  /** Mark target done and surface to its parent. Idempotent. */
  done(noggin: NogginStore, opts?: DoneOptions, ctx?: VerbContext): Promise<CurrentTreeView>;
  /** Shorthand for done on the active item. */
  pop(noggin: NogginStore, opts?: PopOptions, ctx?: VerbContext): Promise<CurrentTreeView>;
  /** Idempotent mutation of an item's done state and/or title. */
  edit(noggin: NogginStore, opts: EditOptions, ctx?: VerbContext): Promise<CurrentTreeView>;
  /** Render the current-position view (spine + peers + first-level children). */
  show(noggin: NogginStore, opts?: ShowOptions): Promise<CurrentTreeView | null>;
  /** Append a timestamped note to an item. */
  note(noggin: NogginStore, opts: NoteOptions, ctx?: VerbContext): Promise<CurrentTreeView>;
  /** Remove an item (and optionally its subtree). */
  delete(noggin: NogginStore, opts: DeleteOptions): Promise<DeleteResult>;
  /**
   * Append every item from `source` into `dest` (whole-noggin,
   * append-only). New keys are generated; notes (including system
   * "closed" notes), `done` state, and `createdAt` are preserved
   * verbatim. Source is read-only; dest's active pointer is unchanged.
   * Same-noggin copy is supported.
   */
  copy(source: NogginStore, dest: NogginStore, opts?: CopyOptions): Promise<CopyResult>;
}

/** @public Options for {@link Verbs.copy}. Reserved for forward-compat — v1 has no options. */
export interface CopyOptions {}

/** @public Result of {@link Verbs.copy}. */
export interface CopyResult {
  /** Number of items appended to dest. */
  copied: number;
  /** Map from source item key → new key in dest. */
  mapping: Record<string, string>;
}

/** @public The singleton verbs object. See {@link Verbs}. */
export const verbs: Verbs;

/**
 * @public
 * Attach bound verb methods (`push`, `add`, `move`, ...) onto a
 * noggin instance, returning it with the wider {@link Noggin}
 * surface added. Each method forwards to the matching
 * `verbs.*(noggin, opts)` free function with the noggin pre-bound.
 *
 * The input only needs to satisfy the parts the verbs use at runtime
 * — accessors + `apply(ops)` (i.e. the non-verb parts of
 * {@link NogginStore}). Providers call this in their constructors so
 * consumers can use the convenient `noggin.push(opts)` form without
 * an explicit adapter. Idempotent — methods are own-properties, so
 * re-attaching is safe.
 */
export function bindNogginVerbs<T>(noggin: T): T & Noggin;

// ── Provider registry ──────────────────────────────────────────────────────

/** @public A noggin provider: claims a scheme prefix, opens a {@link NogginStore}. */
export interface NogginProvider {
  readonly scheme: string;
  open(location: string, opts?: object): Promise<NogginStore>;
}

/** @public Registry interface. The exported `providers` is the singleton. */
export interface NogginProviderRegistry {
  register(provider: NogginProvider, opts?: { default?: boolean }): void;
  unregister(scheme: string): boolean;
  get(scheme: string): NogginProvider | null;
  getDefault(): NogginProvider | null;
  list(): readonly { scheme: string; default: boolean }[];
}

/** @public The process-wide noggin provider registry. */
export const providers: NogginProviderRegistry;

/**
 * @public
 * Open a noggin by location. The scheme prefix (e.g. `file://`,
 * `localstorage://`) selects the provider; a bare location goes to
 * whichever provider was registered with `{default: true}`.
 *
 * Repeated calls with the same location return distinct handles that
 * share the same underlying provider instance: a mutation through one
 * handle is observed by the other (including its `onDidChange`), and
 * the underlying provider is torn down only after every handle has
 * been disposed. Pass `opts.shared = false` to bypass this dedupe and
 * get an independent provider instance.
 */
export function openNoggin(
  location: string,
  opts?: { readonly shared?: boolean } & Record<string, unknown>,
): Promise<NogginStore>;

// ── Public utilities ────────────────────────────────────────────────────────

/**
 * @public
 * Resolve a path string against a doc-shaped `{items, active}` snapshot.
 * Throws `NogginError('path-not-found')` if the path doesn't resolve.
 */
export function resolvePath(snapshot: { items: Item[]; active: ItemKey | null }, p: ItemPath): Item;

/** @public Like `resolvePath` but returns `null` instead of throwing. */
export function tryResolvePath(snapshot: { items: Item[]; active: ItemKey | null }, p: ItemPath): Item | null;

/** @public Compute the absolute path string for an item. */
export function pathOf(snapshot: { items: Item[] }, item: Item | null | undefined): ItemPath | null;

/** @public Direct children of `parentKey` (null = roots), in tree order. */
export function childrenOf(snapshot: { items: Item[] }, parentKey: ItemKey | null | undefined): Item[];

/**
 * @public
 * Build a CurrentTreeView for `target`. Pure; does not mutate.
 * Accepts a noggin or a `{items, active}` doc-shape.
 */
export function buildView(
  snapshot: { items: readonly Item[]; active: ItemKey | null },
  target: Item,
  opts?: { includeChildren?: boolean; withSiblings?: boolean; withDescendants?: boolean }
): CurrentTreeView;

// ── Response envelope ───────────────────────────────────────────────────────

/** @public */
export interface SuccessEnvelope<T = unknown> {
  status: 'ok';
  envelopeVersion: number;
  verb: string | null;
  data: T;
}

/** @public */
export interface ErrorEnvelope {
  status: 'error';
  envelopeVersion: number;
  verb: string | null;
  error: {
    code: NogginErrorCode | string;
    message: string;
    exitCode: number;
    /** Structured payload mirroring {@link NogginError.data}. Omitted
     *  when the underlying error carries no data fields. */
    data?: NogginErrorData;
  };
}

/** @public */
export type JsonEnvelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;

/** @public */
export function formatSuccess<T>(opts: { verb?: string; data?: T }): SuccessEnvelope<T>;

/** @public */
export function formatError(opts: { verb?: string; error: unknown }): ErrorEnvelope;
