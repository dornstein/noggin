---
title: Response envelope
slug: "envelope/"
---

# Response envelope

Every structured noggin response — CLI `--json` output, MCP tool
responses, VS Code language-model tool responses — is wrapped in the
same canonical envelope so a single consumer can target all three
surfaces.

## Success

```jsonc
{
  "status": "ok",
  "envelopeVersion": 3,
  "verb": "push",            // command that produced this payload
  "data": { ... }            // verb-specific (CurrentTreeView, DeleteResult, ...)
}
```

## Error

Written to **stderr**; the process exits with `error.exitCode`.

```jsonc
{
  "status": "error",
  "envelopeVersion": 3,
  "verb": "push",
  "error": {
    "code": "title-required",
    "message": "push: title required (--title or positional)",
    "exitCode": 2
  }
}
```

## Versioning

`envelopeVersion` versions the **wrapper shape** (and the per-verb
payloads inside `data`). It is distinct from the on-disk document's
`schemaVersion` (see [Document schema](../schema/)) — the two
revision numbers rev independently:

- `schemaVersion` bumps when the **stored YAML/JSON shape** changes
  in a way that older readers can't parse.
- `envelopeVersion` bumps when the **response shape** (envelope or
  any `data` payload) changes in a way that consumers must adapt to.

## Default pruning

Inside `data`, a small whitelist of fields whose value matches their
declared default is **omitted** to keep payloads focused. A consumer
that doesn't see one of these fields should treat it as the default:

| Field | Omitted when |
|---|---|
| `parentKey` | `null` (item is a root) |
| `done` | `false` (item is still open) |
| `notes` | `[]` (no notes) |
| `activePath` | `null` (no active item) |
| `activeKey` | `null` (no active item) |
| `descendantCount` | `0` (in `DeleteResult`) |
| `view` | `null` (delete left the tree empty) |

Everything else is always present, including the envelope itself
(`status`, `envelopeVersion`, `verb`, `data` / `error`).

## Verb-specific payloads

- Most verbs put a [`CurrentTreeView`](../api/core-data-model/item-view/) in `data`.
- `delete` puts a [`DeleteResult`](../api/core-data-model/item-view/) in `data`.
- `where` is a special case: `data` is a plain string (the noggin's
  `describe()` output) rather than a structured object.

For per-verb examples with real CLI output, see the
[verb demo page](../demo/).

## Error codes

`error.code` is a short, stable string identifying the failure mode.
The set of codes is documented as
[`NogginErrorCode`](../api/errors/noggin-error-code/) in the API reference.
Codes additions are non-breaking; treat unknown codes as fallback
errors and don't exhaustively `switch` on the union.

## Exit codes

`error.exitCode` mirrors the CLI process exit code:

| Code | Meaning |
|---|---|
| `0` | Success — no error envelope |
| `1` | Runtime / state error (item not found, open descendants, cycle, etc.) |
| `2` | Usage / parse / invalid input (missing title, unknown flag, bad path syntax) |

## Why an envelope at all

- **Stable** across surfaces: CLI, MCP, LM tools all parse the same
  shape. Tooling written for one works for the others.
- **Self-versioning**: `envelopeVersion` lets consumers branch on
  shape changes without sniffing field names.
- **Error symmetry**: success and failure use the same wrapper. A
  client can `JSON.parse(...)` once and switch on `status`.
- **Forward-compatible**: adding a field is non-breaking; removing
  one bumps `envelopeVersion`.
