# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [extension-v0.1.2] - 2026-06-18

Retry release: `0.1.1` published successfully per the workflow log but
did not appear in the Marketplace gallery within 10 minutes. Bumping
to `0.1.2` to retry through the same pipeline.

## [extension-v0.1.1] - 2026-06-18

First exercise of the GitHub-Actions release pipeline (no behavioural
changes vs `0.1.0`, which was published manually). All `[Unreleased]`
items below moved into this release.

### Added

- **CLI** (`cli/noggin.mjs`) — single-file ES module, depends only on
  `js-yaml`. Verbs: `push`, `add`, `move`, `goto`, `done`, `pop`,
  `set`, `show`, `note`, `delete`, `where`, `help`.
  Stable `--json` output contract; exit code 1 = runtime/state, exit code
  2 = usage/parse/invalid.
- **In-process API** (`cli/noggin-api.mjs` + `cli/noggin-api.d.mts`) —
  source of truth for noggin behaviour. Stateless verb functions
  (`apiPush`, `apiAdd`, …) plus a `Noggin` class with cached store,
  file watcher, `onDidChange` / `onDidError`, and deep-frozen snapshots.
  Both the CLI and the VS Code extension consume it.
- **Golden CLI test suite** — 108 tests covering every verb, placement,
  path syntax, error code, JSON shape, and file-resolution path.
- **Agent plugin** (`plugin/`) — VS Code / GitHub Copilot CLI / Claude
  Code-compatible plugin that ships the skill and CLI.
- **VS Code extension** (`extension/`) — ESM extension built with tsc
  (host) + esbuild (webview):
  - Custom React tree view (react-arborist) with full path numbering,
    inline state-toggle icon, and drag-and-drop that supports dropping
    on a parent or between siblings with a labeled insertion cursor.
  - Details webview with inline-editable title, Markdown-rendered notes,
    quick-add affordance, and view-title icons for Add Child / Move Up /
    Move Down / Delete.
  - Status bar item with friendly file label and full-path tooltip.
  - 11 language model tools (`#nogginPush`, `#nogginAdd`, etc.) so the
    Copilot agent can drive noggin without spawning the CLI.
  - Per-workspace noggin file tracking via workspace state.
- **Skill** (`cli/SKILL.md`) — agent guide for the working-memory
  tree, kept in sync into both consumer packages by
  `scripts/sync-skill.mjs`.
- **Item schema**: `key`, `parentKey`, `title`, `done`, `createdAt`,
  `notes[]`. A system-generated `closed` note is appended whenever an
  item transitions from open to done; its timestamp is the close time
  (no separate `closedAt` field).
- **CI** runs the CLI smoke test and the full golden test suite, plus
  verifies that the skill copies are in sync with `cli/`.

### Architecture notes

- The CLI is a thin wrapper over the API. Both end-user interfaces
  (the CLI and the extension) share the same code path.
- The extension is fully ESM (`type: module`, `module: Node16`,
  `.js`-suffixed relative imports). The tree view runs as a React
  webview bundled by esbuild; React/react-dnd/react-arborist are
  inlined into the bundle, not shipped as runtime dependencies.
- Reading: extension reads from the API's deep-frozen in-memory
  snapshot, kept fresh by an `fs.watch` on the YAML file.
- Writing: extension calls verb methods on the API in process.
  No `child_process.spawn`, no JSON round-trip.

See [`docs/api-design.md`](docs/api-design.md) for the original design
proposal that drove the extraction.
