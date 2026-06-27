# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Versioning:** as of v0.4.0 noggin uses **one unified version** across
> every artifact — the VS Code extension, the `noggin-cli` and
> `noggin-mcp` npm packages, and both plugin manifests. New release
> headings are `## [v0.X.Y]`; older per-artifact headings
> (`[extension-v…]`, `[cli-v…]`) are kept for historical reference. The
> source of truth is `engine/package.json`; see
> [CONTRIBUTING.md](CONTRIBUTING.md#releasing) for the release
> pipeline.

## [Unreleased]

### Changed

- **Repo restructure.** Three changes:
  1. The MCP server moved from `cli/noggin-mcp.mjs` to its own top-level
     folder, `mcp/`, and is now published as a separate npm package
     (`noggin-mcp`). Install with `npm i -g noggin-mcp` or wire up via
     `npx -y noggin-mcp@latest`. The `noggin-cli` package no longer
     ships a `noggin-mcp` bin.
  2. `desktop/` and `ui/` no longer carry a vendored `skills/noggin/`
     copy of the engine source; both now depend on `@noggin/engine` as
     a workspace package like `extension/` already did.
  3. The agent skill protocol (`SKILL.md`) moved from `cli/` to
     `engine/`. It always described the verb protocol, not the CLI
     binary specifically; the new home matches that. The canonical
     repo version source also moved from `cli/package.json` to
     `engine/package.json` for the same reason.

### Added

- **MCP server** (`mcp/noggin-mcp.mjs`) — stdio Model Context Protocol
  server that exposes the 11 noggin verbs as `tools/call` actions for
  hosts that don't see the VS Code language-model tools (GitHub Copilot CLI,
  Claude Code, Codex CLI). Returns the same canonical JSON envelope
  as the CLI. Codex plugins auto-launch it via `plugin/.mcp.json`;
  other hosts can wire it up manually — see `plugin/README.md` and
  `mcp/README.md`.

### Changed

- **JSON contract overhaul.** Every verb now emits a stable envelope
  (`ok`, `verb`, `view`, plus verb-specific payload). `view` is a
  recursive `ViewNode` tree (spine + peers + optional descendants)
  with a whitelisted node shape. Field rename: `pushedAt` →
  `createdAt`. Absolute paths are canonical `/1/2/3`.
- **Lifecycle verbs unified.** `set-state` and `retitle` collapsed
  into a single `set` verb — then renamed to **`edit`** for clarity.
  `edit --done` / `edit --open` / `edit --title <text>` (combinable).
  Closing is idempotent; reopening with `--open` does NOT touch notes.
- **Flag naming consistency pass.** All multi-word flags now use
  hyphens and a `--with-*` prefix where they extend output:
  - `--undone` → `--open`
  - `--closeall` → `--close-all`
  - `--nokids` → `--no-children`
  - `--notes` → `--with-notes`
  - `--allup` / `--alldown` / `--all` → `--with-siblings` /
    `--with-descendants` / `--with-all`
  - `--debug` → `--with-json`
- **Extension** — language-model tool `noggin_set` → `noggin_edit`;
  state enum `"undone"` → `"open"`; command `noggin.undone` →
  `noggin.reopen` ("Mark Undone" → "Reopen").
- **Error code** `nothing-to-set` → `nothing-to-edit`.

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
  `edit`, `show`, `note`, `delete`, `where`, `help`.
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

See [`docs/plans/2026-06-api-extraction.md`](docs/plans/2026-06-api-extraction.md)
for the original design proposal that drove the extraction.
