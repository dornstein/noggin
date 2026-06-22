---
title: Formalize the public API; decouple from files; go async
status: in-progress
date: 2026-06-22
implemented:
  - 17b3546 - Add JSON schema for noggin document; design plan
  - 7731f65 - Phase 1: NogginDocument type, serializers, pure applyX
  - e6d1d86 - Phase 2: file backend, fileNoggin factory, drop apiX/resolveFile
  - 1b48964 - Phase 3: async Noggin verbs with in-process serialization
  - c6ff0f4 - Phase 4: rename envelope schemaVersion → envelopeVersion, drop file
remaining:
  - Phase 3.7 — cross-process locking (proper-lockfile); internal-only, no contract change
  - Phase 5 — rewrite cli/README.md, cli/SKILL.md, copilot-instructions for the new shape
  - Phase 6 — TSDoc @public / @internal tagging pass + semver bump
---

# Public API, backends, and async — design doc

## Why now

Today's noggin API works, but it bakes three assumptions into shapes
we're about to call `@public`:

1. **A noggin lives in a YAML file.** `NogginFilePath` appears in
   every verb signature; `resolveFile` / `DEFAULT_FILE` /
   `FileResolution` are first-class API concepts; the response
   envelope carries a `file` field. There's no place to plug in
   another backend (a database, an in-memory document embedded in
   another file, an HTTP service).
2. **Persistence is synchronous.** Every verb is sync. The only
   reason that works is that file I/O is sync. Any backend that
   talks to a network or a real database can't honour the contract.
3. **The data shape (`Store`) and the live thing (`Noggin`) carry
   the same name** even though one is inert data and the other owns
   I/O and events.

We want to lock the API down with TSDoc `@public` markers so that
breaking changes require review. Before we do that we need to fix
the shape, or we'll lock in problems we already know about.

The goal of *this* plan is to land the right shape **before**
formalizing. The `@public` tagging pass happens after, as a
separate step.

## Scope

This plan covers only the engine package (`cli/`) and its consumers
(CLI, MCP server, VS Code extension). It does **not** change:

- the YAML on-disk format (`schemaVersion: 1` stays the same);
- the JSON Schema describing the document shape;
- user-facing CLI verbs, flags, output, or exit codes;
- extension UI / commands / webview behaviour.

It explicitly **does** change:

- every TypeScript/JS signature in `noggin-api.mjs` and `.d.mts`;
- import paths in the CLI, MCP server, and extension;
- the response envelope (`envelopeVersion` 3; renamed from
  `schemaVersion`; `file` field dropped);
- all 108+ golden tests in `cli/test/` (every `runCli` call still
  works; the in-process API tests get rewritten).

## Non-goals

- **Streaming/paged access.** We accept a ceiling of "thousands of
  items, fits in memory." `Noggin.items` stays a full array. If a
  million-item use case ever appears, that's a separate product
  (`noggin-stream`?), not a retrofit.
- **A `memoryNoggin` factory.** Anyone with a `NogginDocument` in
  memory composes the pure verb functions (see below); no need for
  a fake "live" wrapper.
- **DB / HTTP backends.** The API will *allow* them by being async
  and backend-shaped. We don't ship any.
- **Backwards compatibility.** This is a one-shot, semver-major
  rewrite of the in-process API. The on-disk format, CLI surface,
  and extension UX are all preserved.

## Decisions locked in

These were settled in conversation; this plan records them.

| Decision | Choice |
|---|---|
| Ceiling | Thousands of items; in-memory access OK. |
| Async | All verbs return `Promise`. No sync API alongside. |
| Data shape vs. live object | `NogginDocument` (data) vs. `Noggin` (live). |
| Snapshot on `Noggin` | None. Live accessors only (`items`, `active`). |
| `schemaVersion` on `Noggin` | Removed. Lives only on `NogginDocument`. |
| File concepts | Removed from engine. Live in the file backend module. |
| Backends provided | Only `fileNoggin`. No `memoryNoggin`. |
| Pure verb functions | Exported. Prefixed `apply*` to avoid collision with `Noggin` methods. |
| `applyX` clock | Optional `now?: Date` parameter; defaults to `new Date()`. |
| Backend introspection | `noggin.describe(): string` accessor replaces `apiWhere` / `resolveFile`. |
| Multi-process safety | Cross-process lock around read-modify-write (advisory file lock via `proper-lockfile`). In-process queue serializes concurrent calls. |
| `reload()` | Removed. Storage changes auto-propagate; `onDidChange` fires and accessors reflect new state. |
| `dispose()` | Kept. Releases backend resources (watchers, lock handles). Async for backend symmetry. |
| Path resolution | Removed from public API. Moves into CLI argv parsing. No `resolveFile`, `DEFAULT_FILE`, or `apiWhere` in the engine. |
| Serializers | Two modules: JSON and YAML. Pure `NogginDocument ↔ string`. |
| Module exports | Subpath exports (`./apply`, `./serializers/yaml`, `./backends/file`, …). |
| Response envelope | `file` field dropped. `RESPONSE_ENVELOPE_VERSION` (renamed from `JSON_SCHEMA_VERSION`) bumped to `3`. |
| `js-yaml` dependency | Stays in the engine package; the YAML serializer needs it. |

## Target API surface

### Data model

```ts
/** A noggin document. Pure data; what the JSON Schema validates. */
export interface NogginDocument {
  schemaVersion: 1;
  active: ItemKey | null;
  items: Item[];
}
```

The on-disk YAML is one encoding of this; JSON is another. The
document shape is what crosses every persistence boundary.

### Pure verb functions

The verb logic, exposed as pure functions over a `NogginDocument`.
Used by `Noggin` internally and available to anyone holding a
document in memory.

```ts
export function applyPush(doc: NogginDocument, opts: PushOptions):
  { doc: NogginDocument; view: CurrentTreeView };

export function applyAdd(doc: NogginDocument, opts: AddOptions):
  { doc: NogginDocument; view: CurrentTreeView };

export function applyMove(doc: NogginDocument, opts: MoveOptions):
  { doc: NogginDocument; view: CurrentTreeView };

export function applyGoto(doc: NogginDocument, opts: GotoOptions):
  { doc: NogginDocument; view: CurrentTreeView };

export function applyDone(doc: NogginDocument, opts?: DoneOptions):
  { doc: NogginDocument; view: CurrentTreeView };

export function applyPop(doc: NogginDocument, opts?: PopOptions):
  { doc: NogginDocument; view: CurrentTreeView };

export function applyEdit(doc: NogginDocument, opts: EditOptions):
  { doc: NogginDocument; view: CurrentTreeView };

export function applyNote(doc: NogginDocument, opts: NoteOptions):
  { doc: NogginDocument; view: CurrentTreeView };

export function applyDelete(doc: NogginDocument, opts: DeleteOptions):
  { doc: NogginDocument; result: DeleteResult };

// Read-only — no doc returned.
export function buildView(doc: NogginDocument, target: Item | ItemPath, opts?: ShowOptions):
  CurrentTreeView | null;
```

Properties:

- Pure: same inputs → same outputs, no I/O, no clocks (timestamps
  flow in via opts or are computed deterministically — see "Open
  question: timestamps" below).
- Take and return `NogginDocument`; never mutate the input
  in place.
- Throw `NogginError` synchronously for usage/state errors. They
  are sync because they don't do I/O — only `Noggin` methods are
  async.

### Serializers

Two pure modules, no `Noggin` knowledge:

```ts
// cli/serializers/json.mjs
export function toJson(doc: NogginDocument, opts?: { pretty?: boolean }): string;
export function fromJson(text: string): NogginDocument;

// cli/serializers/yaml.mjs
export function toYaml(doc: NogginDocument): string;
export function fromYaml(text: string): NogginDocument;
```

- All sync — string in, string out.
- `from*` validate against the schema and throw `NogginError` with
  codes `'invalid-document'` or `'unsupported-schema'`.
- Stable output (sorted keys, fixed line endings, trailing newline)
  so diffs and content hashes are deterministic.
- The schema-version check lives here, not on `Noggin`.

### Live noggin

```ts
/** A live noggin. Owns a document, a backend, and event streams. */
export interface Noggin {
  // ── Accessors (live; always reflect current state) ─────────
  readonly items: readonly Item[];
  readonly active: Item | null;
  readonly roots: readonly Item[];

  findByKey(k: ItemKey | null | undefined): Item | null;
  childrenOf(k: ItemKey | null | undefined): readonly Item[];
  pathOf(item: Item | null | undefined): ItemPath | null;
  resolvePath(p: ItemPath): Item;
  tryResolvePath(p: ItemPath): Item | null;

  /** Backend introspection. Returns a single human-readable string
   *  describing where this noggin lives and any relevant backend
   *  state. Replaces the old `where` verb / `resolveFile`. Format is
   *  backend-defined and *not* machine-parseable. */
  describe(): string;

  // ── Verbs (all async) ───────────────────────────────────────
  push(opts: PushOptions): Promise<CurrentTreeView>;
  add(opts: AddOptions): Promise<CurrentTreeView>;
  move(opts: MoveOptions): Promise<CurrentTreeView>;
  goto(path: ItemPath): Promise<CurrentTreeView>;
  done(opts?: DoneOptions): Promise<CurrentTreeView>;
  pop(opts?: PopOptions): Promise<CurrentTreeView>;
  edit(opts: EditOptions): Promise<CurrentTreeView>;
  show(opts?: ShowOptions): Promise<CurrentTreeView | null>;
  note(opts: NoteOptions): Promise<CurrentTreeView>;
  delete(opts: DeleteOptions): Promise<DeleteResult>;

  // ── Lifecycle ───────────────────────────────────────────────
  /** Release backend resources (watchers, lock handles, connections).
   *  After dispose the noggin is unusable. */
  dispose(): Promise<void>;

  // ── Events ──────────────────────────────────────────────────
  /** Fired whenever the noggin's state changes (from a verb call by
   *  this process, or because the backend observed an external
   *  mutation). After the event fires, the live accessors reflect the
   *  new state. */
  readonly onDidChange: Event<void>;
  /** Backend-level error (e.g. an external mutation produced an
   *  invalid document). Verb errors are thrown from the verb. */
  readonly onDidError: Event<NogginError>;
}
```

**Storage-tracking contract.** A `Noggin` is a live view of its
underlying storage. Two guarantees:

1. When a verb's `Promise` resolves, the live accessors reflect the
   resulting state. No `reload()` needed.
2. When the backend detects external mutation (file change by
   another process, db row update, …), the noggin's accessors
   update *before* `onDidChange` fires. Subscribers can read the
   new state synchronously inside their handler.

The accessors are sync because they read in-memory state the
backend has already loaded. The verbs are async because they
trigger persistence (load → lock → apply → save) which a backend
may do over network/database.

### Backends

```ts
// cli/backends/file.mjs
export function fileNoggin(path: NogginFilePath, opts?: {
  /** Watch the file for external changes. Default true. */
  watch?: boolean;
  /** Max ms to wait for the cross-process lock before failing. Default 5000. */
  lockTimeout?: number;
}): Promise<Noggin>;
```

`fileNoggin` is `async` so that the first load is awaited before
the noggin is returned. After that, accessors are sync.

No `resolveFile`, no `DEFAULT_FILE`, no `apiWhere`. Path
resolution (env var fallback, default location) is CLI-internal
logic in `cli/noggin.mjs`; it never reaches the engine. Callers
that have a path use it directly; the CLI is the one place that
has to fall back to defaults, and it does so in its own argv
parser.

Other backends (`dbNoggin`, `httpNoggin`, …) are out of scope but
would follow the same shape: an async factory that returns a
`Noggin`.

#### Concurrency safety for the file backend

Every verb call follows this sequence:

1. Acquire an exclusive advisory lock on the noggin file
   (`proper-lockfile`). Block with timeout/backoff.
2. Re-read the file from disk (its on-disk state may have changed
   since the in-memory copy was last refreshed).
3. Run the pure `applyX` against the freshly-loaded document.
4. Write the new document atomically (write to temp file, rename
   over the real path).
5. Update the in-memory document, fire `onDidChange`.
6. Release the lock.

This is safe across multiple processes on the same machine (CLI
+ extension, two CLI invocations, etc.). It assumes a local
filesystem with working `flock`; network mounts (NFS, SMB) are
not supported.

In-process concurrent calls are also serialized: each `Noggin`
instance has an internal queue so two `await noggin.push()` calls
from the same process execute in order rather than racing on the
lock.

The watcher (`fs.watch` via the backend) ignores changes whose
mtime matches the backend's own last write — a self-fired event
doesn't trigger a redundant `onDidChange`.

### Errors

`NogginError` and `NogginErrorCode` stay as they are, plus two new
codes from the serializers:

- `'invalid-document'` — replaces today's `'invalid-store'` for
  document-shape failures.
- `'unsupported-schema'` — unchanged in meaning.

`'invalid-store'` is removed; any external code matching on it
needs to switch to `'invalid-document'`.

### Response envelope

A wrapper used by every tool/CLI surface that returns a verb's
result (or error) as structured data. Used by:

- the CLI's `--json` output
- the MCP server's tool responses
- the VS Code extension's language-model tool responses

Distinct from the JSON Schema that describes a `NogginDocument` —
this envelope is about wrapping a single tool/verb response.

```ts
export interface SuccessEnvelope<T = unknown> {
  status: 'ok';
  envelopeVersion: 3;   // renamed from schemaVersion; bumped from 2
  verb: string | null;
  data: T;
}

export interface ErrorEnvelope {
  status: 'error';
  envelopeVersion: 3;
  verb: string | null;
  error: { code: string; message: string; exitCode: number };
}
```

Changes from today:

- The `file` field is gone. (A verb's response shouldn't carry
  backend-specific identifying info; if a caller needs it,
  `noggin.describe()` is the answer.)
- `schemaVersion` is renamed to `envelopeVersion` to disambiguate
  it from the document `schemaVersion` (which is on
  `NogginDocument`, not on the envelope). Bumped to `3`.
- The constant exported from the engine is
  `RESPONSE_ENVELOPE_VERSION` (renamed from `JSON_SCHEMA_VERSION`).

## Module layout after the refactor

```
cli/
  noggin-api.mjs         engine: types, Noggin interface, NogginError,
                         formatSuccess/formatError, RESPONSE_ENVELOPE_VERSION
  noggin-api.d.mts       hand-written types matching the above

  apply/                 pure verb functions over NogginDocument
    index.mjs            re-exports all applyX
    push.mjs, add.mjs, … one verb per file (or a small grouping)
    *.d.mts

  backends/
    file.mjs             fileNoggin (only public export)
    file.d.mts

  serializers/
    json.mjs             toJson / fromJson
    yaml.mjs             toYaml / fromYaml
    *.d.mts

  noggin.mjs             CLI: argv parsing, path resolution, output
  noggin-mcp.mjs         MCP server; uses fileNoggin
  noggin.schema.json     unchanged (validates NogginDocument)
  README.md              user-facing reference (re-written)
  SKILL.md               agent skill (re-written)
```

`package.json` declares subpath exports so consumers import from
the right place:

```jsonc
{
  "exports": {
    ".":               "./noggin-api.mjs",
    "./apply":         "./apply/index.mjs",
    "./serializers/json": "./serializers/json.mjs",
    "./serializers/yaml": "./serializers/yaml.mjs",
    "./backends/file":    "./backends/file.mjs"
  }
}
```

The `noggin-api.mjs` core no longer mentions files, YAML, or path
resolution at all.

## Migration plan

The work is structured so each step leaves `main` green and the
golden test suite passing. Conceptual ordering:

### Phase 1 — Foundations (no API break yet)

1. **Rename the type only.** `Store` (the interface) → `NogginDocument`
   throughout `cli/noggin-api.mjs` and `.d.mts`. No behavioural
   change. All tests still pass.
2. **Extract serializers.** Move YAML parse/dump out of `loadStore` /
   `saveStore` into `cli/serializers/yaml.mjs`. Add
   `cli/serializers/json.mjs`. Add round-trip tests for both:
   `fromYaml(toYaml(doc))` deep-equals `doc`. `loadStore` /
   `saveStore` keep their current signatures and now delegate to the
   serializers internally.
3. **Extract pure verb functions.** Pull the in-place mutation
   logic out of today's `apiPush` etc. into `applyPush(doc, opts)`
   functions that take and return `NogginDocument`. Today's `apiX`
   becomes a thin `load → apply → save` wrapper around them. Pure
   functions get their own test file
   (`cli/test/apply.test.mjs`); existing golden tests still run
   through the wrapper unchanged.

### Phase 2 — Backend extraction

4. **Define `Noggin` interface and `fileNoggin` factory.** New
   module `cli/backends/file.mjs` exports `fileNoggin(path)` —
   returns a live `Noggin` whose accessors mirror the loaded
   document and whose verbs are still sync at this point. Old
   `Noggin` class becomes a thin re-export wrapping `fileNoggin`.
   Add `noggin.describe(): string` returning a human-readable
   summary of the noggin's location and any relevant backend
   state (for the file backend: path, whether it exists, source
   of the path — flag vs env vs default). Tests for the class
   continue to run; new tests target the factory.
5. **Remove path-resolution from the public API.** Move the logic
   currently in `resolveFile` into a CLI-internal helper inside
   `cli/noggin.mjs`. Drop `resolveFile`, `DEFAULT_FILE`,
   `FileResolution`, and `apiWhere` from the engine exports. The
   CLI's `where` verb is reimplemented as a call to
   `noggin.describe()`.
6. **Update CLI & MCP server imports.** `cli/noggin.mjs` and
   `cli/noggin-mcp.mjs` switch to importing `fileNoggin` from
   `backends/file.mjs` and verbs from the new `Noggin` returned by
   it. Free `apiX(file, opts)` functions are removed in this step.

### Phase 3 — Async transition + locking

7. **Add cross-process locking to the file backend.** Take
   `proper-lockfile` as a runtime dependency. Wrap every
   read-modify-write in an exclusive lock acquired against the
   noggin file. Lock acquisition has a configurable timeout
   (default 5s) with exponential backoff. The lock is released on
   verb completion or error. Add tests that exercise
   concurrent CLI invocations against the same file.
8. **Add in-process queue.** Each `Noggin` instance serializes
   its own verb calls so concurrent `await noggin.push()` from
   the same process don't race on the lock. Trivial: a `Promise`
   chain that each verb awaits before starting.
9. **Make verb methods async.** Every method on `Noggin` returns
   `Promise<...>`. The pure `applyX` functions stay sync. The file
   backend's verb implementations become `async (opts) => { await
   this._lock(); const doc = await this._load(); const { doc: doc2,
   view } = applyPush(doc, opts); await this._save(doc2); await
   this._unlock(); return view; }`.
10. **Make `fileNoggin` factory async.** Returns
    `Promise<Noggin>`. First load is awaited before resolving.
11. **Update CLI to await.** `cli/noggin.mjs`'s top-level dispatcher
    becomes `async function main()` with `await` on every verb.
    Exit-code handling moves into the `.catch` of `main().catch(...)`.
12. **Update MCP server to await.** Each tool body adds `await`. The
    MCP framework already supports async handlers.
13. **Update VS Code extension.** All `noggin.ts`/`treeBridge.ts`
    call sites add `await`. The webview message handlers were
    already async, so this is mostly mechanical.

### Phase 4 — Envelope change

14. **Rename and shrink the response envelope.** `formatSuccess` /
    `formatError` stop accepting `file`. The envelope's
    `schemaVersion` field is renamed `envelopeVersion` and bumped
    to `3`. The exported constant is renamed
    `RESPONSE_ENVELOPE_VERSION`. CLI `--json` output reflects all
    of the above.
15. **Update contract tests** in `cli/test/contract.test.mjs` —
    delete assertions on `env.file` / `r.json.file`; assert
    `envelopeVersion === 3`.

### Phase 5 — Documentation

16. **Rewrite `cli/README.md`** to describe the new shape:
    `NogginDocument`, `Noggin`, backends, serializers, pure verb
    functions, async semantics, the response envelope. Document
    the storage-tracking contract (no `reload()`; accessors
    update before `onDidChange` fires) and the locking model
    (single-machine local filesystem only).
17. **Rewrite `cli/SKILL.md`** to match (LLM-facing skill spec).
18. **Update `.github/copilot-instructions.md`**: the rule "CLI is
    the only sanctioned way to read or write a noggin file"
    becomes "the engine / a backend is the only sanctioned way to
    interact with a noggin; for raw documents use a serializer."
19. **Add this plan's `implemented:` frontmatter** with the commit
    hashes.

### Phase 6 — Lock it in

20. **TSDoc `@public` / `@internal` pass.** Annotate every export
    according to the tier list in the prior conversation. Add
    `eslint-plugin-tsdoc` (or just rely on review).
21. **Semver bump.** This is a major break of the in-process API,
    a major bump of the response envelope, and a minor bump of the
    user-facing CLI (verbs / on-disk format unchanged). Tag and
    release.

## Test plan

The golden CLI suite (`cli/test/*.test.mjs`) stays the safety net.
Every CLI verb test is unchanged — they spawn the CLI binary and
assert on stdout/exit codes. After the refactor those tests prove
end-to-end behaviour is preserved.

New / changed test files:

- `cli/test/apply.test.mjs` — pure verb functions. One test per
  applyX, plus a "no input mutation" test (input doc unchanged)
  and a clock-injection test (`now` parameter respected).
- `cli/test/serializers.test.mjs` — round-trip tests for both
  serializers; schema-version rejection; malformed-input
  rejection.
- `cli/test/file-backend.test.mjs` — exercises `fileNoggin`
  directly (atomic write, watcher events, dispose).
- `cli/test/concurrency.test.mjs` — spawns two CLI invocations
  in parallel against the same noggin file; verifies both writes
  land and no items are lost. Tests in-process queueing too.
- `cli/test/async-contract.test.mjs` — every `Noggin` method
  returns a `Promise`; rejection paths surface `NogginError` with
  the right code.
- `cli/test/contract.test.mjs` — updated for `envelopeVersion: 3`
  and no `file` field.

## Open questions

Resolved in conversation; recorded here for context. The plan
body above reflects the chosen answers.

1. **Determinism of `applyX` and timestamps** — resolved. Each
   `applyX` accepts an optional `now?: Date` parameter; defaults
   to `new Date()`. Pure when `now` is provided; tests pin time.
2. **`apiWhere` / `where` verb** — resolved. Replaced by
   `noggin.describe(): string`. CLI's `where` verb prints whatever
   `describe()` returns. `apiWhere`, `resolveFile`, `DEFAULT_FILE`,
   and `FileResolution` are removed from the engine entirely;
   path resolution moves into CLI-internal logic. Note: the
   `where --json` output is now `{data: "some string", …}` rather
   than today's structured `{file, source, exists, …}`. That's a
   breaking change to the JSON output for that verb; it rides
   along with the envelope changes.
3. **Multi-process concurrency** — resolved. Cross-process
   advisory lock around every read-modify-write using
   `proper-lockfile`, plus an in-process queue per `Noggin`
   instance. Single-machine local filesystem only; network
   mounts are explicitly unsupported.
4. **`reload()` and `dispose()`** — resolved. `reload()` is
   removed; the storage-tracking contract guarantees accessors
   always reflect the latest state and `onDidChange` fires when
   external changes are observed. `dispose()` stays (releases
   watchers / lock handles); async for backend symmetry.
5. **Subpath exports** — resolved. Yes. Engine `.`,
   `./apply`, `./serializers/{json,yaml}`, `./backends/file`.
6. **Skill-sync script changes** — trivial; the script will need
   to walk subdirectories. Tracked as part of Phase 5.
7. **`apply*` naming** — confirmed.

## Estimated impact

- ~All exports from `cli/noggin-api.mjs` change shape.
- CLI dispatcher (`cli/noggin.mjs`): ~50 lines changed (sync →
  async, drop `file` from envelope plumbing, absorb path
  resolution).
- MCP server (`cli/noggin-mcp.mjs`): ~30 lines changed (async tool
  bodies).
- Extension (`extension/src/*`): ~10 files touched; each gets
  `await` added to verb call sites; ~5 lines per file. The
  webview's `treeBridge.ts` is the biggest, but the change is
  mechanical.
- Golden tests in `cli/test/`: unchanged in count, mostly
  unchanged in content. The contract tests lose `env.file`
  assertions and gain an `envelopeVersion: 3` assertion.
- New test files: 5 (apply, serializers, file-backend,
  concurrency, async-contract).
- `js-yaml` stays as a runtime dependency of the engine; moves
  from `noggin-api.mjs` to `serializers/yaml.mjs`.
- New runtime dependency: `proper-lockfile` (cross-process file
  locking).

## What we are deliberately not doing

- No streaming/paged accessors. Items live in memory.
- No `memoryNoggin`. In-memory work uses `applyX` + serializers.
- No additional backends.
- No backwards compatibility shims for the old `apiPush(file,
  opts)` shape. Major bump, clean break.
- No JSON Schema for the response envelope itself (the
  in-document schema stays; the envelope is just documented in
  the README).
- No change to the on-disk YAML format. `schemaVersion: 1` stays.
- No new exports for the CLI argv parser, output formatter,
  path-resolution helper, etc. Those stay private to
  `cli/noggin.mjs`.
- No support for network filesystems (NFS, SMB). The file
  backend's locking assumes local `flock` semantics.
