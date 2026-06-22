---
title: Quickstart — JavaScript API
slug: "quickstart/api/"
---

# Quickstart: JavaScript / Node

Embed noggin in your own Node program. Reuses the same engine the CLI
and the VS Code extension run on; nothing CLI-specific bleeds into the
API.

## 1. Install

```bash
npm install noggin-cli
```

(The package is named `noggin-cli` for historical reasons; it ships
both the binary and the library entry points.)

## 2. Open a noggin

```js
import { fileNoggin } from 'noggin-cli/backends/file';

const noggin = await fileNoggin('/path/to/.noggin.yaml', { watch: true });
```

`fileNoggin` is async because the first load happens before the
instance is returned. Subsequent reads come from an in-memory snapshot
that the file watcher keeps fresh.

## 3. Call verbs

All verb methods return `Promise`. Per-instance calls are serialized
(in-process queue); concurrent processes are protected by an advisory
file lock the backend manages.

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

If you need to manipulate a noggin without a backend — composing,
running scenarios in tests, batch-transforming — use the
[`applyX`](../../api/#functions) functions over a
[`NogginDocument`](../../api/#interface-noggindocument) directly:

```js
import { applyPush, applyAdd } from 'noggin-cli';
import { fromYaml, toYaml } from 'noggin-cli/serializers/yaml';

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
