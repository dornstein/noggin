# Copilot project instructions

You're working on **noggin** — a working-memory tree tool for in-flight
work. Read these before suggesting changes.

## Where things live

- `engine/` is the **engine source of truth**: the in-process API
  (`noggin-api.mjs` + `.d.mts`), the file/memory providers, the
  YAML/JSON serializers, and the JSON schema. Pure data model +
  verbs, no CLI or host knowledge.
- `cli/` is the CLI + MCP server. `noggin.mjs` and `noggin-mcp.mjs`
  are thin clients of `@noggin/engine`. The skill markdown
  (`SKILL.md`) and human reference (`README.md`) also live here.
- `extension/` is the VS Code extension. ESM TypeScript host + React
  webview for the tree.
- `plugin/` is the agent-plugin distribution.
- `desktop/` is the Electron desktop app. As of Phase 4 of the
  noggin-rpc plan, the **engine runs in the main process** behind a
  `createNogginRpcServer`; the renderer is a sandboxed browser
  bundle that drives verbs via `RemoteNoggin` (`@noggin/ui/remote`)
  over `ElectronIpcTransport`. `BrowserWindow` uses standard secure
  defaults (`contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`). Three preload bridges:
  `window.shell` (legacy file dialogs), `window.nogginRpcIpc`
  (`'noggin-rpc'` channel), `window.modalIpc` (separate channel for
  host.show* React modals).
- `ui/` is `@noggin/ui` — shared React components plus the
  `@noggin/ui/remote` subpath which exports the `RemoteNoggin`
  optimistic adapter (Phase 3 of the noggin-rpc plan).
- `*/skills/noggin/` are **auto-synced** flat copies of `engine/` +
  `cli/`. Don't edit them — edit `engine/` or `cli/` and run
  `node scripts/sync-skill.mjs`.

## Architecture in one paragraph

The **engine** lives in `engine/noggin-api.mjs`: the `Noggin` class
(live document + in-process verb queue + file watcher +
`onDidChange`/`onDidError` events), pure `applyX(doc, opts, ctx?)`
verb functions over a `NogginDocument`, error types, and the
response envelope helpers (`formatSuccess`/`formatError`). The file
**provider** is `engine/providers/file.mjs` (`fileNoggin(path, opts?):
Promise<Noggin>`). YAML/JSON **serializers** are in
`engine/serializers/{yaml,json}.mjs`. `cli/noggin.mjs` is the thin
CLI that parses argv, imports `@noggin/engine`, opens a
`fileNoggin`, and calls verb methods. The extension imports the
engine + file provider **in process** and re-exposes verbs through a
`NogginHandle` that backs the tree webview, details webview, status
bar, and language model tools. All verbs are **async**; per-Noggin
calls serialize through an internal Promise chain.

## Conventions

- The engine + a provider is **the only sanctioned way** to read or
  write a noggin. Don't `fs.readFile` the YAML directly. For raw
  document I/O without a live `Noggin`, use
  `cli/serializers/{yaml,json}.mjs`. If you need behaviour the API
  doesn't expose, add it to the engine or the file provider.
- Path syntax: absolute `/1/2/3`, or relative `.` / `..` / `-` / `+` /
  `./X` / `../X` / `-/X` / `+/X`. Don't store paths long-term — use
  the opaque `key` instead.
- Item shape: `{ key, parentKey, title, done, createdAt, notes[] }`.
  No `closedAt` — closing appends a system note `{ timestamp, text:
  'closed' }`. The note's timestamp is the close time. Reopening with
  `edit --open` does NOT modify notes; the historical close
  stays in the log.
- Two distinct versions: `SCHEMA_VERSION` versions the on-disk
  `NogginDocument`; `RESPONSE_ENVELOPE_VERSION` versions the
  `{ status, envelopeVersion, verb, data|error }` wrapper used by
  CLI `--json` output and the extension's LM tools. They rev
  independently.
- All `Noggin` verb methods return `Promise`. The CLI's main(),
  every cmdX handler, every extension call site needs `await`.
- The extension is fully ESM (`"type": "module"`,
  `moduleResolution: "Node16"`). All relative imports need explicit
  `.js` suffixes (TS rewrites to runtime paths).
- The React tree webview lives in `extension/src/treeWebview/` and is
  bundled by esbuild (`extension/esbuild.mjs`). tsc excludes that
  directory. React + react-dnd + react-arborist are devDependencies
  because esbuild inlines them into the bundle — they don't ship at
  runtime.
- The engine's golden test suite (`engine/test/*.test.mjs`) is the
  safety net for any refactor of `noggin-api.mjs`. Don't change
  behaviour without updating tests; don't change tests without thinking
  about whether you're locking in a bug. `cli/test/*.test.mjs` is just
  smoke tests for CLI / MCP bootstrap.

## Project workflow

- Releases are **continuous on push to main**. Every push runs
  [`.github/workflows/release-extension.yml`](workflows/release-extension.yml)
  which auto-bumps the patch version and publishes to the
  Marketplace.
- Override the bump with `[minor]` or `[major]` in the commit message.
- Skip the release entirely with `[skip release]` (use this for
  docs-only edits).
- After editing anything in `engine/` or `cli/`, run
  `node scripts/sync-skill.mjs` before committing. CI rejects merges
  where the synced copies have drifted.

## When suggesting code

- Prefer adding to `engine/noggin-api.mjs` (engine) or
  `engine/providers/file.mjs` (file provider) over duplicating logic in
  `extension/src/`. If the extension wants something behavioural,
  it usually belongs in one of those.
- Keep `cli/noggin.mjs` thin: argv parsing + output formatting only.
- New verbs require:
  1. Pure `applyX(doc, opts, ctx?)` function in `noggin-api.mjs`
     (throw `NogginError` with stable `code`).
  2. Async method on the `Noggin` class that wraps `applyX` via
     `_mutate` / `_maybeMutate` for the verb queue.
  3. Type declarations in `noggin-api.d.mts` (Promise-returning).
  4. CLI dispatcher entry in `noggin.mjs` (async cmdX + await on the
     noggin verb call).
  5. Golden tests in `engine/test/` (for the verb itself) and a
     CLI smoke test in `cli/test/` if the argv mapping is non-trivial.
  6. Documentation in `cli/README.md` and (if agent-relevant)
     `cli/SKILL.md`.
- New extension UI gestures should call existing verbs through
  `NogginHandle` and `await` the result. Don't reach into the YAML
  or spawn the CLI.
- Don't introduce a `closedAt` field or anything similar. Closure is
  recorded as a note. (We removed `closedAt` deliberately — see
  [`docs/plans/2026-06-api-extraction.md`](../docs/plans/2026-06-api-extraction.md)
  and the surrounding commits.)

## Documentation hierarchy

- [`README.md`](../README.md) — end-user landing.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — anything about *working on*
  noggin (build, test, release, architecture). When in doubt, this is
  where contributor-facing docs go.
- [`cli/README.md`](../cli/README.md) — full user reference (verbs,
  schema, JSON contract, invariants).
- [`cli/SKILL.md`](../cli/SKILL.md) — what the LLM sees when invoking
  noggin. Behavioural protocol for chat agents.
- [`extension/README.md`](../extension/README.md) — shown as the
  Marketplace listing. Keep it user-facing; contributor stuff belongs
  in `CONTRIBUTING.md`.
- [`docs/plans/`](../docs/plans/) — historical design proposals,
  frozen at the time they were written. Don't update them when the
  code changes; they're snapshots.
