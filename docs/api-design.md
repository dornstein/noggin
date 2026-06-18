# Noggin API — design doc

Status: **proposal** (pre-implementation). Review and revise before refactor.

## Why

Today the extension shells out to `cli.mjs` for every write (push, done, note,
move…) via `child_process.spawn` against VS Code's bundled Node, then parses
the `--json` stdout. Reads go a *different* way: the extension's `NogginStore`
opens the YAML file itself with `js-yaml` and watches it with `fs.FSWatcher`.

Two paths, two parsers, one process-spawn per click. Replace both with one
in-process library that the CLI also consumes.

## Shape of the change

```
cli/
  noggin.mjs       # argv parsing + output formatting only (was cli.mjs)
  noggin-api.mjs   # the library — all noggin logic lives here
  noggin-api.d.ts  # TypeScript declarations for noggin-api.mjs
  package.json     # exports: { ".": "./noggin-api.mjs", "./cli": "./noggin.mjs" }
  test/            # node --test golden suite, written first
```

The skill-sync script copies the whole `cli/` directory into
`extension/skills/noggin/` and `plugin/skills/noggin/` as today; `noggin-api.mjs`
and `noggin-api.d.ts` ride along. The `bin` entry in `package.json` moves from
`cli.mjs` to `noggin.mjs`.

The extension's `extension/src/cli.ts`, `extension/src/store.ts`, and the YAML
reading code disappear. They are replaced by a single `extension/src/noggin.ts`
that imports `noggin-api.mjs` directly (no `spawn`, no JSON round-trip).

## Goals

1. **One source of truth** for noggin operations. Anyone (CLI, extension,
   future plugin host, tests) calls the same functions.
2. **1:1 with CLI verbs.** Every verb is a method with the same semantics —
   same placement rules, same `--goto` behaviour, same errors.
3. **Strongly typed** via `api.d.ts` so the TS extension gets full IntelliSense
   and compile-time checks. The `.mjs` itself is JS with `// @ts-check` and
   JSDoc references back to the `.d.ts`.
4. **No new behaviour.** This is a structural refactor. The on-disk format,
   path syntax, command semantics, and error messages stay byte-identical.
5. **Stable error contract.** Failures throw a typed `NogginError` with a
   stable `code`; the CLI maps codes to exit codes and stderr text.

## Non-goals

- No schema migration, no new verbs, no new flags.
- No async I/O. The CLI is synchronous today; the library stays synchronous so
  CLI behaviour is unchanged. (The extension is fine with sync — these are
  small local YAML files.)
- No persistence layer abstraction. YAML on local disk, period.

## Module layout

### `cli/noggin-api.mjs` — public surface

Two layers:

- **Stateless functions** — pure helpers that operate on a file path or an
  in-memory `Store`. Used by the CLI's command dispatcher and by tests.
- **`Noggin` class** — long-lived handle wrapping one file. Caches the parsed
  store in memory, watches the file for external changes, fires events. Used
  by the extension to back the tree view, status bar, and details view.

Both layers share the same verb implementations underneath.

### `cli/noggin-api.d.ts` — types

Hand-written declarations. The `.mjs` file uses
`/// <reference path="./noggin-api.d.ts" />` and JSDoc `@type` / `@returns`
annotations so editors and `tsc --noEmit` can type-check the implementation
against this contract.

---

## Types

```ts
// Branded string aliases for documentation. No runtime effect.
export type NogginFilePath = string;
export type ItemKey = string;   // opaque, e.g. "i-20260616-180053-b669ca"
export type ItemPath = string;  // "1/2/3" absolute, or ".", "..", "-/2", "../1/3", etc.
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
  closedAt?: IsoTimestamp | null;
  notes: Note[];
}

export interface Store {
  schemaVersion: number;
  active: ItemKey | null;
  items: Item[];
}

/** An Item enriched with its computed path and 1-based sibling position. */
export interface ItemView extends Item {
  path: ItemPath | null;   // null only for orphaned items (shouldn't happen in a valid store)
  position: number;        // 1-based among siblings
}

/** What `emitCurrentTree` returns today — the shape the extension already consumes. */
export interface CurrentTreeView extends ItemView {
  active: ItemPath | null;
  ancestors: ItemView[];
  siblings: ItemView[];
  /** Omitted when `nokids` is true. */
  children?: ItemView[];
}

export type PlacementKind = 'before' | 'after' | 'into';

export interface Placement {
  kind: PlacementKind;
  anchor: ItemPath;
}

/** Optional reposition-after-write. Mirrors the CLI `--goto` flag. */
export interface GotoOption {
  /** Path resolved relative to the operation's target. `true` means `.` (the target itself). */
  goto?: ItemPath | true;
}

export interface FileResolution {
  file: NogginFilePath;
  source: 'flag' | 'env' | 'default';
  exists: boolean;
  defaultFile: NogginFilePath;
  /** Value of $NOGGIN_FILE at the time of resolution. */
  env: string | null;
}

export interface DeleteResult {
  deleted: ItemPath;
  descendantCount: number;
  /** Path of the new active item, or null if the store now has none. */
  active: ItemPath | null;
  /** Same view shape as other verbs when an active item remains; omitted otherwise. */
  view?: CurrentTreeView;
}

/** Stable, machine-readable failure code. */
export type NogginErrorCode =
  | 'no-active-item'
  | 'path-not-found'
  | 'path-syntax'
  | 'cycle'
  | 'placement-conflict'
  | 'placement-missing'
  | 'placement-anchor-missing'
  | 'title-required'
  | 'text-required'
  | 'goto-unsupported'
  | 'has-descendants'
  | 'invalid-store'
  | 'unsupported-schema'
  | 'io';

export class NogginError extends Error {
  readonly code: NogginErrorCode;
  /** True if the error came from the on-disk file (parse, read, write, schema). */
  readonly fatal: boolean;
}
```

---

## Stateless API

File-level helpers. Everything throws `NogginError` on failure; nothing
process-exits or writes to stderr.

```ts
/** Resolve the noggin file path. Mirrors the CLI's `--file` / $NOGGIN_FILE / ~/.noggin.yaml chain. */
export function resolveFile(opts?: { file?: string; env?: Record<string, string | undefined> }): FileResolution;

/** Read and validate a YAML store. Returns an empty store if the file does not exist. */
export function loadStore(file: NogginFilePath): Store;

/** Write a YAML store. Atomic where the platform allows. */
export function saveStore(file: NogginFilePath, store: Store): void;

/** Resolve an ItemPath against a store. Throws NogginError('path-not-found' | 'path-syntax' | 'no-active-item'). */
export function resolvePath(store: Store, path: ItemPath): Item;

/** Like resolvePath but returns null instead of throwing. */
export function tryResolvePath(store: Store, path: ItemPath): Item | null;

/** Compute the absolute 1-based path for an item in the store. */
export function pathOf(store: Store, item: Item): ItemPath | null;

/** Children of a parent (null = roots), in stable on-disk order. */
export function childrenOf(store: Store, parentKey: ItemKey | null): Item[];

/** The CurrentTreeView shape, for any target. Pure — does not mutate. */
export function buildView(
  store: Store,
  target: Item,
  opts?: { includeChildren?: boolean }
): CurrentTreeView;
```

---

## `Noggin` class

Long-lived handle. The extension creates one per open file; the CLI may
construct one per invocation.

```ts
export interface NogginEvents {
  /** Fired when in-memory state changes — either via a verb method or a detected file edit. */
  change: () => void;
  /** Fired when an external edit fails to parse; the previous good store is retained. */
  error: (err: NogginError) => void;
}

export class Noggin {
  constructor(file: NogginFilePath, opts?: { watch?: boolean });

  // ── Identity ──────────────────────────────────────────────────────────
  readonly file: NogginFilePath;

  // ── Read accessors (cheap, no I/O) ────────────────────────────────────
  /** Immutable snapshot of the current store. */
  get store(): Readonly<Store>;
  get active(): Item | null;
  get roots(): Item[];
  findByKey(key: ItemKey | null | undefined): Item | null;
  childrenOf(parentKey: ItemKey | null): Item[];
  pathOf(item: Item | null): ItemPath | null;
  resolvePath(path: ItemPath): Item;
  tryResolvePath(path: ItemPath): Item | null;
  view(target?: Item | ItemPath | null, opts?: { includeChildren?: boolean }): CurrentTreeView;

  // ── Lifecycle ─────────────────────────────────────────────────────────
  /** Force a re-read from disk. Returns true if the in-memory store actually changed. */
  reload(): boolean;
  /** Stop the file watcher and release resources. */
  dispose(): void;

  // ── Events ────────────────────────────────────────────────────────────
  on<K extends keyof NogginEvents>(event: K, handler: NogginEvents[K]): () => void;

  // ── Verbs (1:1 with CLI) ──────────────────────────────────────────────
  // Each verb writes the store to disk on success and fires 'change'.

  push(opts: { title: string }): CurrentTreeView;

  add(opts: { title: string; placement?: Placement } & GotoOption): CurrentTreeView;

  move(opts: { path?: ItemPath; placement: Placement } & GotoOption): CurrentTreeView;

  goto(path: ItemPath): CurrentTreeView;

  done(opts?: { path?: ItemPath }): CurrentTreeView;

  /** Equivalent to `done({})`. Provided for parity with the CLI verb. */
  pop(): CurrentTreeView;

  setState(opts: { path?: ItemPath; done: boolean } & GotoOption): CurrentTreeView;

  show(opts?: { path?: ItemPath; nokids?: boolean; notes?: boolean } & GotoOption): CurrentTreeView | null;

  note(opts: { path?: ItemPath; text: string } & GotoOption): CurrentTreeView;

  retitle(opts: { path?: ItemPath; title: string } & GotoOption): CurrentTreeView;

  delete(opts: { path: ItemPath; recursive?: boolean }): DeleteResult;

  /** Read-only — returns the resolved file metadata for this instance. */
  where(): FileResolution;
}

/** Convenience constructor (returns a Noggin with watch=true). */
export function openNoggin(file: NogginFilePath): Noggin;
```

### Semantics notes — must match the CLI exactly

- **Default target.** `done`, `note`, `retitle`, `show`, `setState`, `move`
  default to the active item when `path` is omitted, and throw
  `no-active-item` if there is none.
- **`goto`.** When supplied, the path is resolved *with the operation's
  target as the active item* (just like today's `applyGoto`). `goto: true`
  means `.` (the target itself). `done` and `delete` reject `goto`.
- **`add` placement.** No placement = child of active. `--into` adds as last
  child of the anchor. `--before`/`--after` insert as a sibling. Active is
  unchanged unless `goto` is given.
- **`move` placement.** Placement is required. Cycles
  (target into its own subtree, or as a sibling of a descendant) throw
  `cycle`. `before`/`after` of self is a silent no-op.
- **`delete`.** Refuses if the target has descendants unless `recursive: true`
  (throws `has-descendants`). If the deleted subtree contains the active
  item, the parent becomes active (or null at root).
- **`done`.** Sets `done: true` and stamps `closedAt`, then makes the
  target's parent active. `pop` is exactly `done()` with no path.
- **`setState`.** Explicit `done: true | false`. Clears or sets `closedAt`.
- **Path resolution.** The library reuses today's `tryResolveDetailed`
  algorithm: `.`, `..`, `-`, `+`, `./X`, `../X`, `-/X/Y`, `../../X`, and
  absolute `X/Y/Z`. Error text format preserved.
- **File resolution priority.** `opts.file` > `$NOGGIN_FILE` > `~/.noggin.yaml`.
- **Schema check.** `loadStore` throws `unsupported-schema` if
  `schemaVersion` does not match the constant baked into the library.

### Concurrency and watching

- The `Noggin` instance keeps an `fs.FSWatcher` when `watch: true`. Debounced
  reloads fire `change` only when the parsed store actually differs from the
  cached one (deep-equal check on `{ active, items }`).
- Verb methods read the file once before mutating to pick up any external
  edit, then write atomically. There is no multi-process lock; the CLI and
  extension can race on a shared file, but each write is whole-file and
  last-writer-wins, which matches today's behaviour.

---

## CLI wrapper (`cli/cli.mjs`)

After the refactor, `cli.mjs` does only:

1. Parse argv into `{ verb, positional, flags }` (existing parser stays).
2. Resolve the file via `resolveFile({ file: flags.file, env: process.env })`.
3. Dispatch on `verb`:
   - Construct a `Noggin(file, { watch: false })`.
   - Translate flags into the verb's typed options object.
   - Call the verb method inside a try/catch.
4. Format the return value: human text for default, JSON for `--json`, both
   for `--debug`. Existing `printItem` / `emitOutput` helpers move to a
   formatting module (`cli/format.mjs`) but otherwise unchanged.
5. On `NogginError`, write `noggin: <message>\n` to stderr and exit with the
   error code's exit-code mapping (1 for runtime, 2 for usage). Unknown errors
   exit 1 with the raw message.

The CLI gains no new behaviour and loses no output. A golden-file test suite
(see below) locks this down.

---

## Extension wiring

After the refactor:

- `extension/src/cli.ts` — **deleted**.
- `extension/src/store.ts` — **deleted** (its YAML reads/watching move into
  `Noggin`).
- New `extension/src/noggin.ts` — owns the `Noggin` instance for the current
  session, subscribes to its `change` event, re-exposes it to the tree view,
  status bar, and details view. Roughly:

  ```ts
  import { Noggin } from '../../cli/api.mjs';

  export class NogginHandle implements vscode.Disposable {
    private current: Noggin | null = null;
    readonly onDidChange: vscode.Event<void>;
    constructor(session: NogginSession) { /* swap Noggin instances when session.file changes */ }
    get instance(): Noggin | null { return this.current; }
    dispose() { this.current?.dispose(); }
  }
  ```

- `extension/src/commands.ts` — every command goes from
  `await cli.run('push', [...])` to `handle.instance?.push({ title })`.
  Same return type (`CurrentTreeView`), so downstream UI code is untouched.
- `extension/src/treeView.ts`, `statusBar.ts`, `detailsView.ts` — switch
  their data source from `NogginStore` to `NogginHandle`. The shapes match,
  so this is mostly a rename.

The `.mjs` import works in the extension because the extension is already
running on Node (the host); TypeScript needs `"moduleResolution": "node16"`
or `"bundler"` and the `cli/noggin-api.d.ts` file alongside `noggin-api.mjs`
for types.

---

## Testing — TDD-first

Build the golden CLI suite **before** writing a line of the API. The suite
is what proves the refactor is behaviour-preserving.

1. **CLI golden tests** (`cli/test/cli.test.mjs`) — for each verb, run
   `node noggin.mjs <args>` against a fixture noggin and assert
   stdout / stderr / exit code / file-after match recorded expectations.
   Built first, against the *current* CLI, until green. Becomes the
   harness that every later step must keep green.
2. **Library unit tests** (`cli/test/api.test.mjs`) — added alongside the
   API extraction. Exercise every verb against an in-memory `Noggin` over
   a temp file. Cover: every path syntax, every placement, every error
   code, `goto` semantics, the delete-active edge case, the schema-version
   guard.

Run via `node --test cli/test/`. No new dependencies.

---

## Migration plan (TDD-ordered)

0. **Write the golden CLI test suite** against the current `cli/cli.mjs`. Get
   it green and committed before touching production code.
1. Rename `cli/cli.mjs` → `cli/noggin.mjs` in a single mechanical commit
   (update `package.json` `bin`, sync script targets, any docs). Re-run the
   golden suite — must still be green.
2. Add `cli/noggin-api.mjs` and `cli/noggin-api.d.ts` with the surface
   above, factored out of the helpers now in `noggin.mjs`. Verb
   implementations move verbatim; `fail()` becomes
   `throw new NogginError(code, msg)`.
3. Add the `Noggin` class on top of the verb functions.
4. Rewrite `cli/noggin.mjs` as a thin dispatcher over the API. Goldens must
   stay green.
5. Run `scripts/sync-skill.mjs` so `extension/skills/noggin/` and
   `plugin/skills/noggin/` pick up the new files.
6. Replace the extension's `cli.ts` + `store.ts` with `noggin.ts`. Update
   the three views and the command handler.
7. Delete the dead code; run the extension end-to-end manually against a
   real noggin file.

Each step is independently committable.

## Decisions (resolved)

- **`.d.ts` location.** Co-located next to `noggin-api.mjs` in `cli/`. The
  skill-sync script must copy `*.d.ts`.
- **`Noggin.store` snapshots.** Deep-frozen for safety.
- **Sync verbs.** Stays sync; matches today's CLI semantics. Revisit only if
  a real need appears.
- **Event names.** Match VS Code style: `onDidChange`, `onDidError`.
