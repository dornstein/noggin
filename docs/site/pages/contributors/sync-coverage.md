---
title: Sync coverage matrix
slug: "contributors/sync-coverage/"
---

# Cross-instance sync coverage

The hardest noggin bugs are the ones where two views of the same
noggin disagree. They live at the intersection of two axes:

- **Provider** — where the bytes live (`file://`, `memory://`,
  `localstorage://`, future `sqlite://` / `http://`).
- **Topology** — how many handles observe the same target, and
  what process boundary separates them.

This page maps every (provider × topology) cell to the test that
pins its behaviour. A cell marked **—** with a reason isn't a gap:
it's a combination that's structurally impossible (e.g. there's no
"two processes" case for `memory://`, because each process has its
own in-memory store).

When you add a new provider or change a notification mechanism,
update this table along with the code. CI doesn't enforce it yet,
but a stale row here is a strong signal that something in the
contract has drifted.

## Matrix

| Topology | `file://` | `memory://` | `localstorage://` |
|---|---|---|---|
| **Same handle**<br>(baseline: my writes are visible to me) | [provider-parity.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/provider-parity.test.mjs) (file://) | [provider-parity.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/provider-parity.test.mjs) (memory://) | [provider-parity.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/provider-parity.test.mjs) (localstorage://) |
| **Two handles, one process**<br>(engine dedupe + refcount) | [multi-instance.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/multi-instance.test.mjs) (file://) | [multi-instance.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/multi-instance.test.mjs) (memory://) | [multi-instance.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/multi-instance.test.mjs) (localstorage:// same tab) |
| **Two handles via RPC**<br>(noggin.changed fan-out) | [server-adapter.test.ts](https://github.com/dornstein/noggin/blob/main/rpc/test/server-adapter.test.ts) (two RPC servers on one file) | [RemoteNoggin.test.ts](https://github.com/dornstein/noggin/blob/main/ui/src/__tests__/RemoteNoggin.test.ts) (rebases when another client mutates) | — *(RPC is server-side; `localStorage` only exists in a browser)* |
| **Two processes, one machine**<br>(file lock + fs.watch) | [concurrency.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/concurrency.test.mjs) (CLI processes) + [two-windows-sync.spec.ts](https://github.com/dornstein/noggin/blob/main/extension/test/e2e/two-windows-sync.spec.ts) (VS Code dev hosts) | — *(memory is per-process; cross-process sharing is impossible by construction)* | — *(localStorage is per-origin-per-process; processes don't share)* |
| **Two browser tabs**<br>(DOM `storage` event) | — *(file:// is a Node-side provider)* | — *(memory is per-process)* | [playground.spec.ts](https://github.com/dornstein/noggin/blob/main/docs/site/tests/playground.spec.ts) (cross-window sync) + [external-change-cause.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/external-change-cause.test.mjs) (cross-window via Node shim) |

## Contract tests that span all providers

Beyond the cells above, these tests pin the *contract* that every
provider must honour:

| Contract | Test |
|---|---|
| Empty-diff `apply` does not fire `onDidChange` | [empty-diff.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/empty-diff.test.mjs) |
| Dispose is idempotent; peer survives sibling dispose | [dispose-semantics.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/dispose-semantics.test.mjs) |
| `ChangeEvent` payload is `readonly ItemChange[]` (no wrapping) | [external-change-cause.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/external-change-cause.test.mjs) |
| Apply queue serializes within one handle | [multi-instance.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/multi-instance.test.mjs) + [provider-parity.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/provider-parity.test.mjs) |
| Two opens of the same URL share state (URL dedupe) | [multi-instance.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/multi-instance.test.mjs) + [dispose-semantics.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/dispose-semantics.test.mjs) |
| Refcount: backend torn down only after last handle disposes | [dispose-semantics.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/dispose-semantics.test.mjs) |

## Edge-case tests

These are narrower than the matrix cells — each pins a specific
failure mode that doesn't fit neatly into "(provider, topology)"
but has bitten us or could bite us:

| Edge case | Test |
|---|---|
| `fs.watch` rapid-write race + identical-bytes rewrite | [file-watch-race.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/file-watch-race.test.mjs) |
| RemoteNoggin rolls back on server-side apply failure | [RemoteNoggin.test.ts](https://github.com/dornstein/noggin/blob/main/ui/src/__tests__/RemoteNoggin.test.ts) (server-side apply failure) |
| RPC subscribe / unsubscribe / resubscribe yields fresh id | [server-adapter.test.ts](https://github.com/dornstein/noggin/blob/main/rpc/test/server-adapter.test.ts) (resubscribe) |
| External file write fires `noggin.changed` over RPC | [server-adapter.test.ts](https://github.com/dornstein/noggin/blob/main/rpc/test/server-adapter.test.ts) (`watch: true` default) |
| Unrelated storage keys do not fire `onDidChange` | [external-change-cause.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/external-change-cause.test.mjs) |

## Notes on the topology axis

- **"Two handles, one process"** is what `openNoggin(url)` × 2 must
  produce: two distinct handles backed by the same provider instance,
  with full convergence. The engine wrapper at
  [createSharedHandle](https://github.com/dornstein/noggin/blob/main/engine/noggin-api.mjs)
  is what makes this work; pass `{ shared: false }` to opt out.
- **"Two handles via RPC"** is two `RemoteNoggin` clients against one
  `RpcServer` against one underlying provider. The fan-out happens at
  the server: every subscription gets its own `noggin.changed` stream.
  This is the desktop renderer ↔ main, the extension webview ↔ host.
- **"Two processes, one machine"** is independent OS processes
  sharing a backing store. For `file://` we rely on `proper-lockfile`
  for writes and `fs.watch` for reads.
- **"Two browser tabs"** is two same-origin browser windows sharing a
  `localStorage` slot. The DOM `storage` event delivers cross-tab,
  but never to the writing tab. Within one tab, two
  `LocalStorageNoggin` instances are kept coherent by the engine's
  `openNoggin` dedupe (covered by the "two handles, one process"
  cell).

## When a new provider lands

1. Add a row of cells for the new scheme in the **Matrix** above.
2. Add the provider to [provider-parity.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/provider-parity.test.mjs)'s `FACTORIES`
   array so the same-handle baseline runs.
3. Decide which topologies are structurally applicable. Skip the
   ones that aren't and document the reason in the cell. Don't leave
   a cell empty without a reason — empty cells look like gaps.
4. Add multi-instance and dispose coverage to
   [multi-instance.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/multi-instance.test.mjs) and
   [dispose-semantics.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/dispose-semantics.test.mjs).
5. If the provider supports a notification mechanism (file watching,
   pub/sub, etc.), add an external-mutation test to
   [external-change-cause.test.mjs](https://github.com/dornstein/noggin/blob/main/engine/test/external-change-cause.test.mjs).

The matrix is descriptive, not generative — there's no single test
file that loops over every cell. Each cell links to where the
relevant test actually lives. The reason is pragmatic: the test
runners differ (`node:test`, `vitest`, Playwright) and the fixtures
differ too. Forcing one uniform shape over all of them costs more
than the visibility benefit returns. See the adversarial critique
in the session log for the full reasoning.
