---
title: Quickstart — JavaScript API
slug: "quickstart/api/"
---

# Quickstart: JavaScript / Node

Embed noggin's engine — the verb functions, the live `Noggin` class,
the file provider, the YAML/JSON serializers — directly in your own
Node program. Same engine the CLI, MCP server, VS Code extension, and
desktop app run on; nothing host-specific.

## Caveat: not on npm yet

The engine lives in this repo as **`@noggin/engine`**, a workspace
package marked `"private": true`. It is **not currently published to
npm**. To consume it today you have two options:

- **Workspace dep** — clone this repo and add `@noggin/engine` as a
  `file:` dependency from a sibling folder. Same mechanism the
  in-tree `cli/`, `mcp/`, `extension/`, `desktop/`, and `ui/`
  packages use.
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
import { fileNoggin } from '@noggin/engine/providers/file';

const noggin = await fileNoggin('/path/to/.noggin.yaml', { watch: true });
```

`fileNoggin` is async because the first load happens before the
instance is returned. Subsequent reads come from an in-memory snapshot
that the file watcher keeps fresh.

## 3. Call verbs

All verb methods return `Promise`. Per-instance calls are serialized
(in-process queue); concurrent processes are protected by an advisory
file lock the provider manages.

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

## 4. React to changes

```js
noggin.onDidChange(() => render(noggin.items));
```

Fires after every verb call in this process, and whenever the watcher
detects an external write (the CLI in another terminal, the extension
saving in another window, etc.).

## 5. Pure functions on documents

If you need to manipulate a noggin without a provider — composing,
running scenarios in tests, batch-transforming — use the
[`applyX`](../../api/#functions) functions over a
[`NogginDocument`](../../api/#interface-noggindocument) directly:

```js
import { applyPush, applyAdd } from '@noggin/engine';
import { fromYaml, toYaml } from '@noggin/engine/serializers/yaml';

let doc = fromYaml(text);
({ doc } = applyPush(doc, { title: 'one' }));
({ doc } = applyAdd(doc, { title: 'two' }));
const out = toYaml(doc);
```

Each `applyX` mutates the passed-in document and returns
`{ doc, view }`. No I/O, no events — just data → data.

## 6. Clean shutdown

```js
await noggin.dispose();
```

Releases the file watcher, the in-process queue, and (when present)
the advisory lock. After dispose the noggin is unusable.

## What you've learned

- `fileNoggin()` gives you a live instance.
- `Noggin` methods are async and serialized.
- `applyX` + serializers give you pure data manipulation.
- `onDidChange` is how you keep UIs in sync.

## Next

- [JavaScript API reference](../../api/) — every public symbol with
  TSDoc tier tags.
- [Noggin schema](../../schema/) — the document shape, with the
  invariants the engine enforces.
- [Response envelope](../../envelope/) — when you're producing CLI- or
  MCP-compatible output of your own.
