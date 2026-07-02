---
title: Atomic ops
slug: "api/atomic-ops/"
---

# Atomic ops

The single write primitive. Verbs compose lists of
[`AtomicOp`](atomic-op/)s and hand them to `NogginStore.apply(ops)`
in one call; providers execute the list atomically — either every
op lands or none do.

Most consumers never touch this API directly; they use verbs or
their bound-method equivalents. Providers implement `apply(ops)`
by delegating to [`applyOps`](apply-ops/) after taking whatever
locking their backing store needs. Custom-provider authors and
tests that construct documents offline are the other two audiences.

- [`AtomicOp`](atomic-op/) — the discriminated union.
- [`applyOps`](apply-ops/) — apply a list of ops to a document
  in-place + validate. Throws `NogginError` on any structural
  problem in the resulting document.
- [Document utilities](document-utilities/) — `validateDocument`,
  `normalizeDocument`, `documentsEqual`, `diffDocuments`,
  `freezeDocument`. The pure-function toolkit providers use to
  keep their in-memory doc, on-disk doc, and change-event
  pipeline in sync.
