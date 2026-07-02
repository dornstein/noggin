---
title: Opening a noggin
slug: "api/opening/"
---

# Opening a noggin

Every caller-facing entry point for turning a URI into a live
[`Noggin`](../handles/noggin/) handle.

- [`openNoggin`](open-noggin/) — the general entry point. Takes a
  URI, dispatches to the right provider via the scheme prefix,
  returns a handle.
- [Provider registry](provider-registry/) — the process-wide
  catalog. Importing a provider (`import '@noggin/engine/providers/file'`)
  side-effect-registers it here. Hosts can also register custom
  providers programmatically via `providers.register(...)`.

For the specific factories each bundled provider exports
(`openFileNoggin`, `openMemoryNoggin`, `openLocalStorageNoggin`,
`openHttpNoggin`) plus their options and behaviour, see the
narrative [Providers](../../providers/) section.

## Handle sharing

Repeated calls to `openNoggin` with the same location return
distinct handles that **share** the underlying provider instance:
a mutation through one handle is observed by the other (including
its `onDidChange`), and the underlying provider is torn down only
after every handle has been disposed. Pass `opts.shared = false`
to bypass this dedupe and get an independent provider instance.
