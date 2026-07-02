---
title: Errors
slug: "api/errors/"
---

# Errors

Every failure noggin surfaces is either a
[`NogginError`](noggin-error/) (thrown by the engine + providers)
or wrapped as one at a boundary. Three pieces:

- [`NogginError`](noggin-error/) — the error class. Carries a
  stable `code`, a CLI-mirrored `exitCode` (1 = runtime / state,
  2 = usage / parse / invalid), and a frozen structured
  [`data`](noggin-error-data/) payload.
- [`NogginErrorCode`](noggin-error-code/) — the union of stable
  code strings. Hosts key user-facing strings off this. New codes
  are non-breaking; renaming or removing is always a breaking
  change.
- [`NogginErrorData`](noggin-error-data/) — the structured
  payload's shape. Each code carries a known set of fields; extra
  fields are non-breaking.

## Host-side rendering

The engine's `message` is a short host-neutral string suitable
for logs and fallback. Hosts that render errors to users go
through their own catalog, keyed on `code`:

- CLI: [`cli/error-messages.mjs`](https://github.com/dornstein/noggin/blob/main/cli/error-messages.mjs)
- MCP: [`mcp/error-messages.mjs`](https://github.com/dornstein/noggin/blob/main/mcp/error-messages.mjs)
- React UI: [`uiErrorMessage`](../../ui/components/#uierrormessageerr)
  in `@noggin/ui`.

Each catalog reads the `data` payload for context (path, title,
counts) and returns a string appropriate for the host's
vocabulary — the CLI speaks `--flag`, the UI speaks "tree" and
"menu".

## Wire boundaries

For CLI `--json` output, MCP tool responses, and noggin-rpc verb
errors, engine `NogginError`s are wrapped in an
[`ErrorEnvelope`](../response-envelope/json-envelope/) by
[`formatError()`](../response-envelope/envelope-helpers/). The
envelope preserves `code` + `exitCode` + `data` verbatim, so
downstream consumers pattern-match identically to in-process
callers.
