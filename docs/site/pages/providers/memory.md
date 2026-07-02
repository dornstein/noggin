---
title: Memory provider
slug: "providers/memory/"
---

# Memory provider

The memory provider keeps a noggin entirely in process. Nothing is
persisted; the noggin dies with the process (or sooner, when you
call `dispose()`). It's the canonical backend for tests, demos, and
short-lived scratch noggins.

## At a glance

| | |
| --- | --- |
| **Scheme** | `memory://` |
| **Module** | `@noggin/engine/providers/memory` |
| **Persistent** | No — process lifetime only |
| **Read-only** | No |
| **Cross-process** | None — each process has its own copy |
| **Runs in** | Node, browsers, Deno — anywhere the engine runs |

## When to use

Use this for:

- **Tests.** The golden test suite uses memory noggins as the default
  fixture; they're cheap to construct and never leak state between
  tests.
- **Demos.** The CLI's `verb demo` page runs every scenario against
  a freshly-created memory noggin.
- **Throw-away scratch.** UI playgrounds, MCP tool sandboxes, the
  "let me try a verb without affecting my real noggin" workflow.

If you want anything to survive a reload, switch to
[`file://`](../file/) or [`localstorage://`](../localstorage/).

## Quick start

```ts
import { openMemoryNoggin } from '@noggin/engine/providers/memory';

const noggin = await openMemoryNoggin({ label: 'demo' });
await noggin.push({ title: 'just trying things' });
await noggin.dispose();
```

Or via the registry:

```ts
import { openNoggin } from '@noggin/engine';
import '@noggin/engine/providers/memory';

const noggin = await openNoggin('memory://demo');
```

## URL syntax

`memory://<label>`. The label is purely decorative — it shows up in
`describe()` and `noggin.location` so multiple memory noggins are
easy to tell apart in logs. There is no shared registry of labels;
two calls to `openMemoryNoggin({ label: 'demo' })` return **two
independent** noggins.

## Options

`openMemoryNoggin(opts)` accepts:

| Option | Default | Purpose |
| --- | --- | --- |
| `label` | `'in-memory'` | Human-readable tag shown in `describe()` |
| `initialDocument` | `null` | Seed the noggin with an existing `NogginDocument` |

```ts
import { openMemoryNoggin } from '@noggin/engine/providers/memory';

const noggin = await openMemoryNoggin({
  label: 'seeded',
  initialDocument: {
    schemaVersion: 1,
    active: null,
    items: [
      { key: 'k1', parentKey: null, title: 'pre-loaded', done: false, notes: [] },
    ],
  },
});
```

The initial document is normalized + validated — it has to be a
shape the engine would otherwise accept on disk.

## Behaviour

- **Apply is fully in-memory.** Each `apply(ops)` deep-clones the
  current document, runs the ops, and freezes the result. No I/O,
  no async boundary other than the tail promise.
- **Change events.** `onDidChange` fires after every mutation that
  produces a non-empty diff. A no-op `apply()` (idempotent verb,
  setting a title to its current value) doesn't fire.
- **Dispose semantics.** `dispose()` waits for any in-flight `apply`
  to settle, then clears listeners. Subsequent `apply()` calls
  reject with `code: 'disposed'`.

## Error codes you might see

| Code | When |
| --- | --- |
| `disposed` | `apply()` after `dispose()` |
| `invalid-document` | `initialDocument` failed structural validation |

## Performance

The memory provider is the floor for engine performance. The golden
test suite issues thousands of verbs per test run against memory
noggins. If a verb is slow in this provider, the bottleneck is in
the engine itself, not in I/O.

## Related

- [`file://`](../file/) for disk persistence
- [`localstorage://`](../localstorage/) for browser persistence
- [Contributors → Testing strategy](../../contributors/testing/) —
  how the test suite uses memory noggins
