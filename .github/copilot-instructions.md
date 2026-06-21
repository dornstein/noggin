# Copilot project instructions

You're working on **noggin** — a working-memory tree tool for in-flight
work. Read these before suggesting changes.

## Where things live

- `cli/` is the **source of truth**. The CLI (`noggin.mjs`), the
  in-process API (`noggin-api.mjs` + `.d.mts`), the agent skill
  (`SKILL.md`), and the human reference (`README.md`) all live here.
- `extension/` is the VS Code extension. ESM TypeScript host + React
  webview for the tree.
- `plugin/` is the agent-plugin distribution.
- `extension/skills/noggin/` and `plugin/skills/noggin/` are
  **auto-synced** copies of `cli/`. Don't edit them — edit `cli/` and
  run `node scripts/sync-skill.mjs`.

## Architecture in one paragraph

All noggin behaviour lives in `cli/noggin-api.mjs`: stateless verb
functions (`apiPush`, `apiAdd`, …) plus a `Noggin` class with a
cached store, file watcher, and `onDidChange` / `onDidError` events.
`cli/noggin.mjs` is a thin CLI wrapper. The extension imports
`noggin-api.mjs` **in process** (no `child_process.spawn`) and
re-exposes verbs through a `NogginHandle` that backs the tree
webview, details webview, status bar, and language model tools.

## Conventions

- The CLI is **the only sanctioned way** to read or write a noggin
  file. Don't `fs.readFile` the YAML directly. If you need behaviour
  the CLI doesn't expose, add it to the API.
- Path syntax: absolute `1/2/3`, or relative `.` / `..` / `-` / `+` /
  `./X` / `../X` / `-/X` / `+/X`. Don't store paths long-term — use
  the opaque `key` instead.
- Item shape: `{ key, parentKey, title, done, createdAt, notes[] }`.
  No `closedAt` — closing appends a system note `{ timestamp, text:
  'closed' }`. The note's timestamp is the close time. Reopening with
  `set --undone` does NOT modify notes; the historical close
  stays in the log.
- The extension is fully ESM (`"type": "module"`,
  `moduleResolution: "Node16"`). All relative imports need explicit
  `.js` suffixes (TS rewrites to runtime paths).
- The React tree webview lives in `extension/src/treeWebview/` and is
  bundled by esbuild (`extension/esbuild.mjs`). tsc excludes that
  directory. React + react-dnd + react-arborist are devDependencies
  because esbuild inlines them into the bundle — they don't ship at
  runtime.
- The CLI's golden test suite (`cli/test/*.test.mjs`) is the safety
  net for any refactor of `noggin-api.mjs`. Don't change behaviour
  without updating tests; don't change tests without thinking about
  whether you're locking in a bug.

## Project workflow

- Releases are **continuous on push to main**. Every push runs
  [`.github/workflows/release-extension.yml`](workflows/release-extension.yml)
  which auto-bumps the patch version and publishes to the
  Marketplace.
- Override the bump with `[minor]` or `[major]` in the commit message.
- Skip the release entirely with `[skip release]` (use this for
  docs-only edits).
- After editing anything in `cli/`, run `node scripts/sync-skill.mjs`
  before committing. CI rejects merges where the synced copies have
  drifted.

## When suggesting code

- Prefer adding to `cli/noggin-api.mjs` over duplicating logic in
  `extension/src/`. If the extension wants something behavioural,
  it usually belongs in the API.
- Keep `cli/noggin.mjs` thin: argv parsing + output formatting only.
- New verbs require:
  1. Implementation in `noggin-api.mjs` (throw `NogginError` with
     stable `code`).
  2. Type declaration in `noggin-api.d.mts`.
  3. CLI dispatcher entry in `noggin.mjs`.
  4. Golden tests in `cli/test/`.
  5. Documentation in `cli/README.md` and (if agent-relevant)
     `cli/SKILL.md`.
- New extension UI gestures should call existing verbs through
  `NogginHandle`. Don't reach into the YAML or spawn the CLI.
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
