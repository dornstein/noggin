---
title: Verbs
slug: "api/verbs/"
---

# Verbs

Every mutation to a noggin's state flows through a **verb**. Ten
built-in verbs (`push`, `add`, `move`, `goto`, `done`, `pop`,
`edit`, `show`, `note`, `delete`) plus one two-noggin verb
(`copy`), all bundled as the [`verbs`](verbs/) singleton and
exposed as bound methods on every noggin.

- [`verbs`](verbs/) — the singleton + `Verbs` interface. Each
  verb reads current state via the noggin's accessors, composes
  a list of [`AtomicOp`](../atomic-ops/atomic-op/)s, calls
  `noggin.apply(ops)` once, and returns the resulting view (or a
  `DeleteResult` / `CopyResult`).
- [Verb options](verb-options/) — one interface per verb (`PushOptions`,
  `AddOptions`, `MoveOptions`, ...) plus the `CloseOptions` mixin
  shared by the closing verbs and the `GotoOption` mixin for the
  `--goto` follow-up flag.
- [`bindNogginVerbs`](bind-noggin-verbs/) — attach bound verb
  methods onto a noggin instance. Providers call this in their
  constructors so consumers can use the ergonomic `noggin.push(opts)`
  form.
- [`VerbContext`](verb-context/) — optional per-call context for
  verbs that stamp timestamps (mostly a `now` clock override for
  deterministic tests).
- [`CopyResult`](copy-result/) — the `copy` verb's return shape
  (mapping of source-key → dest-key, plus a count).

## Keys, not paths

Verbs take path strings (`/1/2`, `.`, `..`) for user ergonomics,
but the UI-facing intent surface (`@noggin/ui`'s `NogginActions`)
uses opaque item keys. Both funnel into the same verb calls; the
key vs path distinction is where the caller draws the line
between "human-friendly coordinate" and "stable identifier".

## Bound methods vs free functions

`noggin.push(opts)` and `verbs.push(noggin, opts)` do the same
thing. Bound methods exist for ergonomics; free functions exist
so the CLI, MCP server, and RPC layer can take a noggin as a
parameter. UI code prefers the bound form; in-tree tooling
prefers the free form. Both call the exact same implementation.
