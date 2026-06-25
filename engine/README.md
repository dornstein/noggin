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
- `test/` — the golden test suite

## Who uses it

- [`cli/`](../cli/) — the `noggin` argv CLI and `noggin-mcp` server
- [`extension/`](../extension/) — VS Code extension host
- [`desktop/`](../desktop/) — Electron desktop app
- [`ui/`](../ui/) — `@noggin/ui` shared React components
- [`plugin/`](../plugin/) — agent-plugin distribution

All hosts import the engine either directly (`@noggin/engine`) or
through the synced `skills/noggin/` folder mirrored from
`engine/` + `cli/` by `scripts/sync-skill.mjs`.

## Tests

```
cd engine
npm install
npm test          # node's built-in test runner; 174 tests
```

Tests in `engine/test/` cover both pure engine behaviour
(`change-events`, `empty-titles`, `memory-backend`, `serializers`,
`public-api-conformance`) and end-to-end semantics via the CLI
(`add`, `copy`, `lifecycle`, `move`, `paths`, `push`, `where`, …) —
those spawn `../cli/noggin.mjs` in a subprocess.

## See also

- [`cli/README.md`](../cli/README.md) — full verb reference, JSON
  envelope contract, schema invariants
- [`cli/SKILL.md`](../cli/SKILL.md) — agent-facing behavioural
  protocol
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — repo conventions and
  release flow
