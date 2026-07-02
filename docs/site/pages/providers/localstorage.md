---
title: LocalStorage provider
slug: "providers/localstorage/"
---

# LocalStorage provider

The localStorage provider backs a noggin with a single YAML document
in `window.localStorage`. It's the browser-native counterpart to the
[file provider](../file/): same atomic-write semantics, same change
events, plus cross-tab synchronization via the DOM `storage` event.

## At a glance

| | |
| --- | --- |
| **Scheme** | `localstorage://` |
| **Module** | `@noggin/engine/providers/localstorage` |
| **Default in** | Browser hosts (docs site playground, sandboxed renderers) |
| **Persistent** | Yes — per origin, per browser profile |
| **Read-only** | No |
| **Cross-tab sync** | Via the DOM `storage` event |
| **Same-tab drift** | Detected via a periodic `getItem` + diff poll (default 500 ms) |
| **Storage layout** | Single key: `noggin:<slot>` |

## When to use

Use this when you want a noggin that survives a page reload **and**
needs no server. It's the right choice for:

- The docs site playground.
- Sandboxed browser renderers (Electron renderer with strict CSP,
  embedded webviews).
- Demos / tutorials where users should be able to come back later
  and find their work.

If you're inside Node, want disk persistence, or need
multi-process locking, use the [file provider](../file/) instead.

## Quick start

```ts
import { openNoggin } from '@noggin/engine';
import '@noggin/engine/providers/localstorage';

const noggin = await openNoggin('localstorage://groceries');
await noggin.push({ title: 'milk' });
await noggin.dispose();
```

Or skip the registry lookup with the direct factory:

```ts
import { openLocalStorageNoggin } from '@noggin/engine/providers/localstorage';

const noggin = await openLocalStorageNoggin({ slot: 'groceries' });
```

## URL syntax

A `localstorage://<slot>` URL maps to the `localStorage` key
`noggin:<slot>`. The slot is the **noggin's** identifier; the full
storage key includes the `noggin:` prefix so the engine can use
shared origins without colliding with unrelated keys.

| URL | Slot | Storage key |
| --- | --- | --- |
| `localstorage://groceries` | `groceries` | `noggin:groceries` |
| `localstorage://` | `playground` (default) | `noggin:playground` |
| `localstorage:groceries` | `groceries` | `noggin:groceries` |

Use the exported `localStorageKeyFor(uri)` helper if you need to
poke at the underlying storage from host code (e.g. to wipe a
specific slot).

## Options

`openLocalStorageNoggin(opts)` accepts:

| Option | Default | Purpose |
| --- | --- | --- |
| `slot` | `'playground'` | The slot name (URL path segment) |
| `storage` | `globalThis.localStorage` | A custom `Storage`-shaped object — useful for tests with `node-localstorage` |
| `window` | `globalThis.window` | A `Window`-shaped object the provider attaches the `storage` listener to |
| `pollIntervalMs` | `500` | Interval (ms) for the same-tab drift poll. Set to `0` to disable — cross-tab sync via the DOM `storage` event keeps working either way. |

The same options work as positional args when using
`openNoggin('localstorage://...', { … })`.

## Persistence and behaviour

- **Synchronous reads, queued writes.** The provider reads the YAML
  on construction and on every external `storage` event; reads are
  served from the in-memory snapshot. Writes serialize through a
  tail promise so concurrent verbs from the same tab can't
  interleave.
- **Cross-tab synchronization.** When another tab in the same origin
  mutates the same slot, the browser fires a DOM `storage` event.
  The provider listens, re-reads, diffs against the previous
  document, and fires `onDidChange` with a concrete `ChangeEvent`.
  Same-tab writes don't trigger the event (the writing tab already
  has the new state), so subscribers see each change exactly once.
- **Same-tab drift polling.** The DOM `storage` event fires
  cross-tab only — it deliberately excludes the writing window. So
  if some out-of-band code in the same tab (dev-tools, a secondary
  script, a peer `Storage` handle to the same origin) mutates the
  slot, the event-driven layer can't see it. To bound drift, the
  provider polls `getItem` + diff at `pollIntervalMs` (default 500
  ms). Writes issued through `apply()` update state synchronously
  first, so the next poll is a no-op in the common case.
- **YAML on disk.** The slot stores the same canonical YAML the file
  provider writes. You can copy a `localstorage://groceries` blob
  to `~/groceries.yaml` and open it with the CLI; round-trip works
  unchanged.

## Convenience methods

The returned noggin exposes three extra methods on top of the
standard `Noggin` surface for hosts that want playground-style demo
flows:

| Method | Purpose |
| --- | --- |
| `snapshot()` | Read the current document directly |
| `reset()` | Wipe the slot (fires `onDidChange`) |
| `loadDocument(doc)` | Replace the slot wholesale (e.g. "Load sample data") |
| `hasData()` | True iff the slot has non-empty items |

These don't appear on a `Noggin` typed against the engine surface;
narrow with `instanceof LocalStorageNoggin` (also exported) when you
need them.

## Error codes you might see

| Code | When |
| --- | --- |
| `no-location` | The host runs where `globalThis.localStorage` is undefined and no `storage` option was supplied |
| `disposed` | An `apply()` was issued after `dispose()` |

## Storage limits

`localStorage` enforces a per-origin quota — typically ~5 MB.
A single noggin is generally tiny (a few KB), but a host with many
slots in the same origin can hit the cap. The provider doesn't
truncate or compress; if `setItem` throws, the verb rejects with
the underlying error and the in-memory state stays at the old
snapshot.

## Related

- [`file://`](../file/) — the disk-backed equivalent for Node hosts
- [`memory://`](../memory/) — non-persistent equivalent for tests
- [Playground](../../playground/) — live demo backed by this provider
