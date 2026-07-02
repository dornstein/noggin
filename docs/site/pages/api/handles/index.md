---
title: Handles
slug: "api/handles/"
---

# Handles

A **noggin handle** is the object every consumer holds and drives.
Two interfaces make it up:

- [`Noggin`](noggin/) — the primary surface. Accessors (`items`,
  `active`, `roots`, `findByKey`, `pathOf`, `resolvePath`,
  `tryResolvePath`, `childrenOf`), bound verb methods (`push`,
  `add`, `move`, ...), lifecycle (`dispose`), events (`onDidChange`,
  `onDidError`), plus `location`, `readOnly`, and `describe()`.
  This is what UI code, tests, and RPC-remoted callers work with.

- [`NogginStore`](noggin-store/) — extends `Noggin` with the atomic
  `apply(ops)` primitive. Every in-process provider satisfies this;
  `RemoteNoggin` (from `@noggin/rpc`) does not, because `apply`
  requires locally-constructed ops against current state which the
  wire protocol doesn't model. The `verbs.*(noggin, opts)` free
  functions consume `NogginStore`; UI code and RPC-consuming
  gestures take the wider `Noggin`.

Both are ES-module interfaces — no runtime shape. Providers
implement them, `bindNogginVerbs` attaches the method set, and the
handle is what `openNoggin` returns.
