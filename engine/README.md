# @noggin/engine

The noggin engine — pure data model, verbs, change-event machinery,
and the file/memory providers. Host-agnostic; no CLI argv parsing,
no host UI, no IPC.

## What this package contains

- `noggin-api.{mjs,d.mts}` — the engine surface:
  - `NogginDocument`, `Item`, `Note`, `AtomicOp`, `applyOps`
  - `Noggin` class (live document + verb queue + watcher +
    `onDidChange` / `onDidError`)
  - `verbs.*` — `push`, `add`, `move`, `goto`, `done`, `pop`,
    `edit`, `note`, `delete`, `show`, `copy`
  - `providers` registry + `openNoggin(location)`
  - `formatSuccess` / `formatError` envelope helpers
  - `SCHEMA_VERSION` (on-disk document) and
    `RESPONSE_ENVELOPE_VERSION` (CLI / LM-tool wire format)
- `providers/file.mjs` — file provider (`fileNoggin(path, opts?)`)
  with cross-process locking, atomic writes, watchers
- `providers/memory.mjs` — in-memory provider for tests + sandboxes
- `serializers/{yaml,json}.{mjs,d.mts}` — round-tripping serializers
- `noggin.schema.json` — canonical JSON Schema for the on-disk format
- `SKILL.md` — agent-facing behavioural protocol for the noggin verbs
- `test/` — the golden test suite

This package also carries the **canonical version** for the whole
repo. Every other package's `version` is propagated from
`engine/package.json` by [`scripts/bump-version.mjs`](../scripts/bump-version.mjs).

## Who uses it

- [`cli/`](../cli/) — the `noggin` argv CLI (npm: `noggin-cli`)
- [`mcp/`](../mcp/) — the `noggin-mcp` stdio MCP server (npm: `noggin-mcp`)
- [`extension/`](../extension/) — VS Code extension host
- [`desktop/`](../desktop/) — Electron desktop app
- [`ui/`](../ui/) — `@noggin/ui` shared React components
- [`plugin/`](../plugin/) — agent-plugin distribution (Codex)

Most consumers import the engine directly as `@noggin/engine`
(workspace dep). `plugin/` and `extension/` additionally ship a
synced copy of the engine source + `SKILL.md` under their
`skills/noggin/` folder; the sync is driven by
[`scripts/sync-skill.mjs`](../scripts/sync-skill.mjs).

## Tests

```
cd engine
npm install
npm test          # node's built-in test runner
```

Tests in `engine/test/` cover both pure engine behaviour
(`change-events`, `empty-titles`, `memory-backend`, `serializers`,
`public-api-conformance`) and end-to-end semantics via the CLI
(`add`, `copy`, `lifecycle`, `move`, `paths`, `push`, `where`, …) —
those spawn `../cli/noggin.mjs` in a subprocess.

## See also

- [`SKILL.md`](SKILL.md) — agent-facing behavioural protocol
- [`cli/README.md`](../cli/README.md) — CLI package overview
- [`mcp/README.md`](../mcp/README.md) — MCP package overview
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — repo conventions and
  release flow

