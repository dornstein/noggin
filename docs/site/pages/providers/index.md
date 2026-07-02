---
title: Providers — overview
slug: "providers/"
---

# Providers

A **provider** binds a URI scheme to an implementation of the
engine's `Noggin` interface. When you call `openNoggin(location)`,
the engine looks up the scheme on `location` (or falls back to the
default), invokes that provider, and hands you back a live noggin.

Every provider produces something that satisfies the same `Noggin`
contract: read accessors, bound verb methods, `apply(ops)` for
mutations, `onDidChange`/`onDidError` events, `dispose()`. Hosts
write to that interface and don't care which provider sits behind
it. The same UI components, CLI verbs, and MCP tools work against
every provider.

## Providers own sync

Providers are responsible for keeping the noggin's in-memory
state in sync with their backing store. That's the whole point of
the abstraction — callers observe `onDidChange` and trust the
accessors; there is no `noggin.refresh()` verb because callers
should never need to know when a provider might have missed
something.

Concretely:

- **File** attaches an `fs.watch` listener on the containing
  directory and additionally runs a short `fs.statSync` poll
  (default 2 s) as a safety net for filesystems where `fs.watch`
  drops events.
- **LocalStorage** listens for the DOM `storage` event
  (cross-tab) and runs a `getItem` + diff poll (default 500 ms)
  to catch same-tab out-of-band writes the event API doesn't
  surface.
- **Memory** has no external state; the in-memory doc is the
  source of truth.
- **HTTP(S)** is one-shot: a `fetch` at open time and nothing
  after. It's declared `readOnly: true`; there is no "reload"
  affordance. Re-open the URL if you want fresh data.

Both timing knobs are exposed as `pollIntervalMs` options for
callers who want to tune them (or set them to `0` to disable
polling entirely).

## Built-in providers

| Provider | Scheme | Persistent? | Read-only? | Runs in | Page |
| --- | --- | --- | --- | --- | --- |
| File | `file://` | Yes — on disk | No | Node | [File](file/) |
| LocalStorage | `localstorage://` | Yes — per origin | No | Browser | [LocalStorage](localstorage/) |
| HTTP(S) | `https://`, `http://` | Source-controlled | **Yes** | Node, Browser | [HTTP(S)](http/) |
| Memory | `memory://` | No — process lifetime | No | Anywhere | [Memory](memory/) |

## Opening a noggin

The same three-line dance works for every provider. The scheme on
the URI picks the provider; everything else is identical:

```ts
import { openNoggin } from '@noggin/engine';
import '@noggin/engine/providers/file';
import '@noggin/engine/providers/memory';

const local = await openNoggin('file:///tmp/work.yaml');
const scratch = await openNoggin('memory://demo');

await local.push({ title: 'ship v1' });
await local.dispose();
```

`openNoggin` always wants a URI with a scheme. Hosts that take raw
filesystem paths from the user (file-open dialogs, drag-drop, CLI
flags) convert at the boundary or call the file provider's direct
factory:

```ts
import { openFileNoggin } from '@noggin/engine/providers/file';

const noggin = await openFileNoggin(chosenPath); // OS path or file:// URI
```

Importing a provider module **side-effect-registers** it with the
engine's `providers` registry. Most hosts pull in only the providers
they use:

| Where you are | Typical imports |
| --- | --- |
| Node CLI / server | `providers/file`, optionally `providers/memory`, `providers/http` |
| Browser (docs site, sandboxed renderer) | `providers/localstorage`, `providers/http`, `providers/memory` |
| Tests | `providers/memory`, anything you're testing |

The CLI loads `file` automatically. The bundled MCP server loads
`file` + `memory` + `http`. The docs site playground loads
`localstorage` + `memory`.

## Direct-factory shortcuts

Each provider also exposes a direct factory for the common case
where you don't want to construct a URL just to open one noggin:

```ts
import { openMemoryNoggin } from '@noggin/engine/providers/memory';
import { openLocalStorageNoggin } from '@noggin/engine/providers/localstorage';
import { openHttpNoggin } from '@noggin/engine/providers/http';

const n1 = await openMemoryNoggin({ label: 'demo' });
const n2 = await openLocalStorageNoggin({ slot: 'groceries' });
const n3 = await openHttpNoggin('https://example.com/sample.yaml');
```

These are equivalent to `openNoggin(uri, opts)` but skip the registry
lookup. Use them when the provider is statically known at the call
site.

## Inspecting what's registered

```ts
import { providers } from '@noggin/engine';

for (const p of providers.list()) {
  console.log(p.scheme, p.default ? '(default)' : '');
}
```

The CLI exposes the same listing via `noggin providers`. The desktop
app surfaces it through **Help → Installed Providers**; that dialog
consumes the same `NogginProviderTypeReader` from
[`@noggin/ui`](../ui/) that drives the `NogginList`'s provider
badges.

## Registering a custom provider

A provider is a tiny object: a scheme name plus an async `open`
function returning anything that satisfies `NogginStore`. The
engine's [`bindNogginVerbs(store)`](../api/verbs/bind-noggin-verbs/)
attaches the bound verb methods so consumers can call
`noggin.push(...)` instead of `verbs.push(noggin, ...)`.

```ts
import { providers, bindNogginVerbs, applyOps, freezeDocument } from '@noggin/engine';

providers.register({
  scheme: 'redis',
  async open(location, opts) {
    const noggin = new RedisNoggin(location, opts);
    await noggin._init();
    bindNogginVerbs(noggin);
    return noggin;
  },
});
```

The in-tree providers ([`file`](file/), [`memory`](memory/),
[`localstorage`](localstorage/), [`http`](http/)) are the reference
implementations. Each one is a single `.mjs` file under
`engine/providers/`; reading them is the fastest way to see the
full contract a new provider has to honour.

## Read-only providers

A provider can declare itself read-only by setting `readOnly: true`
on the returned noggin. The `apply()` method must reject with
`NogginError({ code: 'read-only' })` for any mutating op.

UI code reads `noggin.readOnly` to gate mutation affordances ahead
of time (the desktop sidebar's `NogginList` greys out the action
menu, for example). The HTTP provider is the only read-only
built-in.
