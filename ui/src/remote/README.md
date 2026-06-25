# @noggin/ui/remote

UI-side adapter for a noggin running behind noggin-rpc. Phase 3 of the
[noggin-rpc plan](../../../docs/plans/2026-06-noggin-rpc.md).

## What's here

- `RemoteNoggin` — implements the verb-dispatch shape `NogginVerbs`
  plus the read accessors and event surface the UI consumes. Wraps an
  `RpcClient`; sends `verb.*` RPC requests; mirrors authoritative
  state from `noggin.changed` notifications.
- `openRemoteNoggin({ client, location })` — one-call factory that
  issues `noggin.open` + `noggin.subscribe` and returns a ready-to-use
  `RemoteNoggin`.
- `NogginVerbs` — the verb-dispatch interface every UI consumer
  depends on. Both `RemoteNoggin` and an in-process engine noggin
  (via `bindEngineVerbs`) implement it. Lets `executeGesture` and
  friends drive either kind of noggin without branching.

## Mental model

```
UI component
    │
    ▼ (handler props)
gesture handler / executeGesture
    │
    ▼ noggin.push({title: 'x'})
RemoteNoggin
    │
    ├──▶ predict on a local memory noggin
    ├──▶ fire onDidChange so the UI re-renders NOW
    │
    └──▶ send `verb.push` over RpcClient
              │
              ▼
         RpcServer + createNogginRpcServer
              │
              ▼
         real @noggin/engine memory/file/… noggin
              │
              ├──▶ fires onDidChange
              │       │
              │       ▼ server.notify('noggin.changed', { snapshot, … })
              │       │
              │  RemoteNoggin's notification handler:
              │   - update `confirmed` from snapshot
              │   - shift the FIFO pending op (this verb is now landed)
              │   - rebase local memory noggin
              │
              └──▶ resolves verb response
                      │
                      ▼
                  awaiter sees the server's view
```

## Why a parallel memory noggin

Prediction needs to produce the same shape the server will. Rather
than rewriting verb semantics in the UI layer, we run **the same
engine** locally — `openMemoryNoggin` seeded from the server's last
confirmed snapshot. Every verb call:

1. Runs against the local memory noggin (predicts).
2. Records the op in a FIFO `pending` queue.
3. Sends the RPC.

When the server's `noggin.changed` notification arrives, we shift
the front pending op (FIFO ordering is guaranteed: the server
processes verbs serially via the engine's per-noggin queue), update
the confirmed snapshot, and rebuild the local noggin from confirmed
+ still-pending ops.

Rollback on server reject is the same rebuild without the failed op.

## What can go wrong

- **Pending op assumed to be the front of the FIFO.** If a notification
  arrives without a pending op (e.g. another client mutated the same
  noggin), we treat it as an external change and rebase the local
  state. Multi-client correctness gets more attention in Phase 6 when
  multiple clients per noggin become a real scenario.
- **Server rejects a prediction.** Rare in single-client use — the
  prediction IS the engine, so server agrees by construction. Only
  happens if state diverged between predict and serve (a notification
  arrived in between). The rollback handles it: pending op removed,
  local rebuilt, error propagated.
- **Transport disconnect with predictions in flight.** Pending RPCs
  reject with `rpc.disconnected`. The matching rollback fires. The
  noggin is effectively dead from that point; the host should
  re-open it.

## Tests

- `ui/src/__tests__/RemoteNoggin.test.ts` — 10 unit tests covering
  verb dispatch, optimistic apply, rollback, ordering, lifecycle.
- `ui/src/__tests__/optimistic-ui-flow.test.tsx` — 2 component-level
  tests under simulated 50 ms RPC latency. Asserts predictions land
  within 20 ms and chord-of-three gestures all predict before any
  round-trip completes.
