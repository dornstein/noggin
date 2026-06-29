---
title: Quickstart — JavaScript API
slug: "quickstart/api/"
---

# Quickstart: JavaScript / Node

Embed noggin's engine — the `Noggin` interface, the verb dispatch,
the file/memory providers, the YAML/JSON serializers — directly in
your own Node program. Same engine the CLI, MCP server, VS Code
extension, and desktop app run on; nothing host-specific.

## Caveat: not on npm yet

The engine lives in this repo as **`@noggin/engine`**, a workspace
package marked `"private": true`. It is **not currently published to
npm**. To consume it today you have two options:

- **Workspace dep** — clone this repo and add `@noggin/engine` as a
  `file:` dependency from a sibling folder. Same mechanism the
  in-tree `cli/`, `mcp/`, `extension/`, `desktop/`, `rpc/`, and
  `ui/` packages use.
- **Vendor the source** — copy `engine/noggin-api.mjs`,
  `engine/providers/`, and `engine/serializers/` into your project.
  Banner-stamped sync is automated for the in-tree consumers; see
  [`scripts/sync-skill.mjs`](https://github.com/dornstein/noggin/blob/main/scripts/sync-skill.mjs).

The TypeScript declarations in
[`engine/noggin-api.d.mts`](https://github.com/dornstein/noggin/blob/main/engine/noggin-api.d.mts)
give your editor IntelliSense once the workspace dep is wired up.

If you want this published as `@noggin/engine` on npm, please open an
issue — the API itself is stable; only the publication path is
deferred.

## 1. Add the workspace dep

In your project's `package.json`:

```jsonc
{
  "dependencies": {
    "@noggin/engine": "file:../noggin/engine"
  }
}
```

Then `npm install`.

## 2. Open a noggin

```js
// Side-effect import: registers the `file://` provider.
import '@noggin/engine/providers/file';
import { openNoggin } from '@noggin/engine';

const noggin = await openNoggin('/path/to/.noggin.yaml', { watch: true });
```

`openNoggin` is async because the first load happens before the
instance is returned. Subsequent reads come from an in-memory
snapshot that the file watcher keeps fresh. The provider is selected
by URL scheme — `file://`, `memory://`, or a bare absolute path
(which routes to the default provider, registered by the file
module).

## 3. Call verbs

The returned `Noggin` exposes a bound method for every verb:
`push`, `add`, `move`, `goto`, `done`, `pop`, `edit`, `show`, `note`,
`delete`. All return `Promise`. Per-instance calls are serialised
through an in-process queue; concurrent processes are protected by
an advisory file lock the provider manages.

```js
const view = await noggin.push({ title: 'ship the redesign' });
await noggin.add({ title: 'write the spec' });
await noggin.add({ title: 'wire up tests' });
await noggin.note({ text: 'using node:test, not jest' });

console.log(noggin.active?.title);   // 'ship the redesign'
console.log(noggin.items.length);    // 3
```

`view` is a [`CurrentTreeView`](../../api/#interface-currenttreeview)
— the same shape returned by the CLI's `--json` output.

### Free-function alternative

If you'd rather call verbs as free functions (the in-tree CLI and
MCP server do, since they take a noggin in from above), import
`verbs` instead:

```js
import { verbs } from '@noggin/engine';

await verbs.push(noggin, { title: 'ship the redesign' });
```

Both forms run the same engine code; bound methods are sugar over
the free functions. The bound form is preferable when you only have
one noggin in scope; the free form is preferable when you accept a
noggin as a parameter and want to keep verb dispatch obviously
parametric (the engine's own tests use this form).

## 4. React to changes

```js
noggin.onDidChange((changes) => render(noggin.items, changes));
```

Fires after every verb call in this process, and whenever the
watcher detects an external write (the CLI in another terminal, the
extension saving in another window, etc.). The `changes` payload is
a `ChangeEvent` — an `ItemChange[]` describing what shifted between
the previous and current documents (`added`, `removed`, `moved`,
`updated`, `activeChanged`).

## 5. Pure document operations

If you need to manipulate a noggin without a provider — composing,
running scenarios in tests, batch-transforming — use
[`applyOps`](../../api/#function-applyops) over a
[`NogginDocument`](../../api/#interface-noggindocument) directly:

```js
import { applyOps, SCHEMA_VERSION } from '@noggin/engine';
import { fromYaml, toYaml } from '@noggin/engine/serializers/yaml';

let doc = fromYaml(text);
// Atomic ops compose every mutation the verbs make. The verb
// modules ship the high-level combinators; for one-off batches
// you can hand-build ops yourself.
doc = applyOps(doc, [
  { type: 'add', item: { /* ... */ }, parentKey: null, position: 'end' },
]);
const out = toYaml(doc);
```

`applyOps` mutates the passed-in document in place AND returns it
(convenience for chaining). No I/O, no events — just data → data.

## 6. Clean shutdown

```js
await noggin.dispose();
```

Releases the file watcher, the in-process queue, and (when present)
the advisory lock. After dispose the noggin is unusable.

## What you've learned

- `openNoggin(location)` gives you a live `Noggin` instance.
- `Noggin` methods (`push`, `add`, `move`, …) are async and
  serialized; free-function `verbs.*` work too.
- `applyOps` + serializers give you pure data manipulation.
- `onDidChange` is how you keep UIs in sync.

## Next

- [JavaScript API reference](../../api/) — every public symbol with
  TSDoc tier tags.
- [Noggin schema](../../schema/) — the document shape, with the
  invariants the engine enforces.
- [Response envelope](../../envelope/) — when you're producing CLI-
  or MCP-compatible output of your own.
