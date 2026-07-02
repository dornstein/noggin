---
title: Core data model
slug: "api/core-data-model/"
---

# Core data model

The pure-data shapes noggin is built on. The JSON schema validates
them, the serializers convert them to/from YAML or JSON, providers
load and save them, and every verb-returned view is derived from
them.

- [`NogginDocument`](noggin-document/) — the top-level shape. What
  the file / localstorage / http providers read and write.
- [`Item` and `Note`](item/) — a single tree entry plus its
  append-only note log.
- [View shapes](item-view/) — the read-side projections verbs
  return: `ItemView`, `ViewNode`, `CurrentTreeView`, `DeletedItem`.
- [`Placement`](placement/) — the "where does the new / moved item
  go" spec (`before` / `after` / `into` an anchor).
- [Type aliases](type-aliases/) — `ItemKey`, `ItemPath`,
  `IsoTimestamp`. Opaque string types the rest of the API
  references.

## Immutability

All accessors on a live [`Noggin`](../handles/noggin/) return
deep-frozen values — the same `Item[]` reference across two
`noggin.items` reads (until the next mutation) so subscribers can
memoise on identity. Consumers must not mutate the values they
receive; the freeze is enforced, but the pattern is a design rule
regardless.
