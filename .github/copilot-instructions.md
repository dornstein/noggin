# Copilot project instructions

You're working on **noggin** — a working-memory tree tool for in-flight
work. Read these before suggesting changes.

## Where things live

- `engine/` is the **engine source of truth**: the in-process API
  (`noggin-api.mjs` + `.d.mts`), the file/memory providers, the
  YAML/JSON serializers, the JSON schema, and the agent skill
  protocol (`SKILL.md`). Pure data model + verbs, no CLI or host
  knowledge. Also carries the **canonical repo version** in its
  `package.json` (propagated to every other manifest by
  `scripts/bump-version.mjs`).
- `cli/` is the `noggin` argv CLI — a thin client of `@noggin/engine`,
  published as `noggin-cli` on npm. Contains `noggin.mjs`,
  `error-messages.mjs` (CLI-flavored error catalog), and the
  CLI-flavored `README.md`.
- `mcp/` is the `noggin-mcp` stdio MCP server — another thin client
  of `@noggin/engine`, published as `noggin-mcp` on npm. Contains
  `noggin-mcp.mjs`, its own `error-messages.mjs`, and its own
  `README.md`.
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
- `plugin/skills/noggin/` and `extension/skills/noggin/` are
  **auto-synced** flat copies of `engine/` + `cli/noggin.mjs` +
  `mcp/noggin-mcp.mjs` plus a bundled MCP server. Don't edit them —
  edit `engine/`, `cli/`, or `mcp/` and run
  `node scripts/sync-skill.mjs`. Other consumers (`desktop/`, `ui/`)
  depend on `@noggin/engine` as a workspace package and have no
  `skills/` folder.

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
`fileNoggin`, and calls verb methods. The extension hosts the engine
in process (via `NogginHandle`) for the command-palette commands,
the status bar, and the language-model tools; as of Phase 5 of the
noggin-rpc plan, the extension's webview drives a separate engine
instance behind a `createNogginRpcServer` over postMessage, and
mounts the same `@noggin/ui` React App the desktop renderer ships.
Both engine instances watch the same `file://` and stay in sync via
the file provider's watcher. All verbs are **async**; per-Noggin
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
- The React webview lives in `extension/src/webview/` and is
  bundled by esbuild (`extension/esbuild.mjs`). The extension HOST is
  also bundled (out/extension.js) so it can inline `@noggin/rpc` +
  `@noggin/engine` (both source-only workspace packages); `tsc` is
  used for typecheck only (`--noEmit`). React + react-dnd +
  react-arborist are devDependencies because esbuild inlines them
  into the bundle — they don't ship at runtime.
- **UI primitives** (menus, dialogs, popovers, tooltips, comboboxes,
  any other generic overlay/keyboard-managed widgets) use
  `@radix-ui/react-*`. Do not hand-roll these and do not pull in a
  competing library (MUI, Chakra, Ant, Headless UI, etc.). The
  constraint is: `@noggin/ui` must not force consumers to install a
  theme provider, a CSS reset, or a style system (Tailwind, CSS-in-JS,
  etc.) — Radix is unstyled and provider-free, which preserves that.
  Domain widgets stay specialized (`react-arborist` for the tree,
  `@codemirror/*` for the note editor); the Radix rule is for the
  generic primitives layer underneath them.
- The engine's golden test suite (`engine/test/*.test.mjs`) is the
  safety net for any refactor of `noggin-api.mjs`. Don't change
  behaviour without updating tests; don't change tests without thinking
  about whether you're locking in a bug. `cli/test/*.test.mjs` and
  `mcp/test/*.test.mjs` are just smoke tests for CLI / MCP bootstrap.

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
     `engine/SKILL.md`.
  7. **A page in `docs/site/generators/api.mjs`'s `PAGES` manifest.**
     Verb options usually go on the `Verb options` page; the verb
     method itself is already reflected on the `verbs` page via the
     `Verbs` interface. See "Documentation guardrails" below.
- Any **new public engine export** (a `@public` type, function, class,
  or constant added to `engine/noggin-api.d.mts` or a provider
  `.d.mts`) must be routed to a page in the API-reference tree. The
  docs site's build has a drift audit that fails if a public symbol
  isn't referenced by any page. See "Documentation guardrails" below
  for the checklist.
- New extension UI gestures should call existing verbs through
  `NogginHandle` and `await` the result. Don't reach into the YAML
  or spawn the CLI.
- Don't introduce a `closedAt` field or anything similar. Closure is
  recorded as a note. (We removed `closedAt` deliberately — see
  [`docs/plans/2026-06-api-extraction.md`](../docs/plans/2026-06-api-extraction.md)
  and the surrounding commits.)

## Documentation guardrails

The docs site (`docs/site/`) has three drift-prevention mechanisms.
Understand them before touching the API reference:

- **The API-reference tree is generated per-symbol.**
  [`docs/site/generators/api.mjs`](../docs/site/generators/api.mjs)
  runs TypeDoc against the `.d.mts` entry points listed in
  [`docs/site/typedoc.json`](../docs/site/typedoc.json), then splits
  the output into one page per exported symbol (or a tight cluster of
  related symbols) driven by the `PAGES` manifest at the top of that
  file. Each entry maps `{ slug, title, intro, symbols: [{module, name}] }`
  to a rendered page under `api/`.
- **Every group has a hand-authored overview.** Group index pages
  live under [`docs/site/pages/api/<group>/index.md`](../docs/site/pages/api/)
  and appear at the top of the group in the sidebar. When you add a
  new group in `PAGES`, also add its overview markdown file and its
  nav entry in [`docs/site/template.mjs`](../docs/site/template.mjs).
- **The build audits drift.** `buildApiPages()` fails the whole
  docs build if a public engine symbol isn't referenced by any page
  in `PAGES` (orphaned symbol) or if `PAGES` references a symbol
  TypeDoc didn't emit (ghost entry). The failure message names the
  symbol and the fix. Do not paper over drift by adding the symbol
  to `EXPECTED_ORPHANS` — prefer either routing it to a page or
  marking it `@internal` in the source.

### When you add a public engine export

1. **Type / interface / class** → add an entry to `PAGES` under the
   most-appropriate group. Small related types (e.g. all the verb
   options) share a page; substantial ones (a new `Noggin`-scale
   interface) get their own.
2. **Function** → same. Small related pure functions can share a
   page (see `Path utilities`, `Document utilities`). Standalone
   entry points (`openNoggin`, `bindNogginVerbs`) get their own page.
3. **Constant** → the `Constants` page unless it belongs with a
   specific type semantically.
4. **New provider** → add the `.d.mts` to `typedoc.json`, add the
   module name to `MODULE_FILES` in `api.mjs`, add a
   `MODULE_FALLBACK_SLUGS` entry pointing at the narrative
   `providers/<name>/` page, and write the narrative page. Do NOT
   create per-symbol API pages for provider-specific symbols
   (`openXNoggin`, `xProvider`, `OpenXOptions`, ...); the narrative
   page owns them.
5. **New group of pages under API/** → new PAGES entries + new
   `pages/api/<group>/index.md` overview + new subgroup block in
   `template.mjs`'s `NAV` under the `API` top-level group.
6. Run `node docs/site/build.mjs --out docs/site/dist` locally. The
   drift audit will tell you what's missing.

### When you rename / remove a public engine export

- The audit will flag the manifest entry as a ghost. Update or
  remove the entry in `PAGES`.
- Grep the narrative markdown (`docs/site/pages/**/*.md`) for the
  old name in case anything cross-refs it.

### Other generated pages

The narrative sections stay in `docs/site/pages/**/*.md` — normal
markdown, no generator. Sources of truth for other generated pages
are listed in [`docs/site/README.md`](../docs/site/README.md).

## Documentation hierarchy

- [`README.md`](../README.md) — end-user landing.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — anything about *working on*
  noggin (build, test, release, architecture). When in doubt, this is
  where contributor-facing docs go.
- [`cli/README.md`](../cli/README.md) — user reference for the CLI
  binary surface (install, argv, exit codes). Verb/schema/JSON
  envelope reference lives in [`engine/README.md`](../engine/README.md).
- [`engine/SKILL.md`](../engine/SKILL.md) — what the LLM sees when
  invoking noggin. Behavioural protocol for chat agents.
- [`extension/README.md`](../extension/README.md) — shown as the
  Marketplace listing. Keep it user-facing; contributor stuff belongs
  in `CONTRIBUTING.md`.
- [`docs/plans/`](../docs/plans/) — historical design proposals,
  frozen at the time they were written. Don't update them when the
  code changes; they're snapshots.
