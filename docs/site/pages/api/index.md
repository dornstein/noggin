---
title: API
slug: "api/"
---

# JavaScript API

The engine reference for consumers that embed noggin in a
JavaScript runtime — the VS Code extension, the desktop app, the
docs playground, custom tooling, tests. Detail pages are generated
by [TypeDoc](https://typedoc.org) from the hand-written `.d.mts`
files under [`engine/`](https://github.com/dornstein/noggin/tree/main/engine),
so descriptions, signatures, and release tags stay in sync with the
source automatically.

## Release tiers

Every public symbol carries a TSDoc release tag. Breaking changes
respect the tier:

- **`@public`** — stable. Breaking changes require a major bump.
- **`@experimental`** — public but the shape may still change.
- **`@deprecated`** — still works; scheduled for removal in a future major.

Symbols tagged `@internal` exist in the source but are deliberately
hidden from this reference. Consumers should not depend on internal
exports.

## The groups

- [Handles](handles/) — the live-noggin surface: [`Noggin`](handles/noggin/)
  and [`NogginStore`](handles/noggin-store/).
- [Opening a noggin](opening/) — [`openNoggin`](opening/open-noggin/)
  plus the [provider registry](opening/provider-registry/).
- [Verbs](verbs/) — the [`verbs`](verbs/verbs/) singleton, one
  [options interface](verbs/verb-options/) per verb, plus small
  wiring types.
- [Core data model](core-data-model/) — [`NogginDocument`](core-data-model/noggin-document/),
  [`Item`](core-data-model/item/), view shapes, `Placement`, and
  type aliases.
- [Atomic ops](atomic-ops/) — [`AtomicOp`](atomic-ops/atomic-op/),
  [`applyOps`](atomic-ops/apply-ops/), plus pure
  [document utilities](atomic-ops/document-utilities/).
- [Events](events/) — [`ItemChange` / `ChangeEvent`](events/item-change/)
  and the [`Event` / `Disposable`](events/event-disposable/)
  subscribe primitive.
- [Errors](errors/) — [`NogginError`](errors/noggin-error/), the
  [`NogginErrorCode`](errors/noggin-error-code/) union, and
  [`NogginErrorData`](errors/noggin-error-data/).
- [Response envelope](response-envelope/) — [`JsonEnvelope`](response-envelope/json-envelope/)
  and its [helpers](response-envelope/envelope-helpers/).
- [Path utilities](path-utilities/) — pure walkers over a
  `{items, active}` snapshot.
- [Constants](constants/) — `SCHEMA_VERSION`,
  `RESPONSE_ENVELOPE_VERSION`, `CLOSE_NOTE_TEXT`.
- [Serializers](serializers/) — [YAML](serializers/yaml/) and
  [JSON](serializers/json/) document I/O.

## Quick example

```js
import '@noggin/engine/providers/file'; // side-effect: registers file://
import { openNoggin } from '@noggin/engine';

const noggin = await openNoggin('file:///work/today.yaml', { watch: true });
const view = await noggin.push({ title: 'go async' });
console.log(noggin.active?.title);
noggin.onDidChange((changes) => render(noggin.items, changes));
await noggin.dispose();
```

Every URI passed to `openNoggin` needs an explicit scheme
(`file://`, `memory://`, `localstorage://`, `https://`). Hosts that
take a raw OS path from a file dialog or CLI flag either convert
to `file://` at the boundary or use `openFileNoggin(path)` from
`@noggin/engine/providers/file`.

## Anatomy of a mutation

Every write follows the same three-step path so behaviour is
identical across providers:

1. A **verb** (e.g. `verbs.push`) reads current state via the
   noggin's accessors and composes a list of
   [`AtomicOp`](atomic-ops/atomic-op/)s.
2. The verb calls `noggin.apply(ops)` **once**. Providers execute
   the list atomically and normalise + validate the resulting
   document.
3. The provider fires `onDidChange` with a
   [`ChangeEvent`](events/item-change/) that describes what shifted
   between the previous and current snapshot.

Every provider fires the same `ChangeEvent` shape whether the
change originated in-process or from the outside world, so
consumers write one listener that handles both.

## Errors

Verbs and provider operations throw [`NogginError`](errors/noggin-error/)
on failure. Each carries a stable string
[`code`](errors/noggin-error-code/) plus a frozen structured
[`data`](errors/noggin-error-data/) payload. Hosts that render
user-facing strings key off `code`; the raw `message` is a short
host-neutral fallback.

For CLI / MCP / RPC serialisation, wrap engine results with
[`formatSuccess()` / `formatError()`](response-envelope/envelope-helpers/)
to produce a versioned [`JsonEnvelope`](response-envelope/json-envelope/).
