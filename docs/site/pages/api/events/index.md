---
title: Events
slug: "api/events/"
---

# Events

Every live noggin exposes two observable event streams:

- **`onDidChange`** — fires after every mutation that produced a
  non-empty diff, whether the mutation came from an in-process
  verb, a peer process (`file://`) or peer tab (`localstorage://`),
  or the safety-net drift poll. Payload is a
  [`ChangeEvent`](item-change/) — a list of
  [`ItemChange`](item-change/) records describing exactly what
  shifted.
- **`onDidError`** — fires for provider-side errors that surface
  outside a verb call (a corrupt file the watcher observed, a
  lock timeout from a peer writer, etc.). Payload is a
  [`NogginError`](../errors/noggin-error/).

Both accessors match the [`Event<T>`](event-disposable/) primitive:
pass a handler, get a [`Disposable`](event-disposable/) whose
`dispose()` unsubscribes. Modelled after `vscode.Event`.

## Ordering guarantees

`onDidChange` fires **after** the mutation has been persisted and
accessors reflect the new state. Verb methods return their result
only after the corresponding event has fired. That means:

```ts
const events = [];
const sub = noggin.onDidChange((e) => events.push(e));
await noggin.push({ title: 'x' });
sub.dispose();
// events.length === 1; noggin.items already contains the new item.
```

For change events observed through an RPC-remoted `RemoteNoggin`,
the server-adapter delivers the corresponding `noggin.changed`
notification **before** returning the verb's response — see
[noggin-rpc](../../noggin-rpc/) for the wire-level ordering rules.
