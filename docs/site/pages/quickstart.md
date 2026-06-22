---
title: Quickstart
slug: "quickstart/"
---

# Quickstart

Five minutes to your first useful noggin.

## 1. Install the CLI

```bash
npm install -g noggin-cli
noggin help
```

(See [Install](../install/) for VS Code, Codex, Claude Code, etc.)

## 2. Push your top item

```bash
$ noggin push "ship the redesign"
[1📍] ship the redesign
```

A single item, active. The `📍` marks the active item.

## 3. Capture todos as children

`push` *enters* the new item; `add` just *captures* it.

```bash
$ noggin add "write the spec"
$ noggin add "wire up tests"
$ noggin add "update the README"
$ noggin show
[1📍] ship the redesign
  [1]   write the spec
  [2]   wire up tests
  [3]   update the README
```

## 4. Side-quest: push, do, pop

A bug derails you. `push` to descend; `pop` to surface back.

```bash
$ noggin push "investigate the cache miss"
$ noggin note "looks like the TTL wrap from the timezone bug"
$ noggin pop
$ noggin show
[1📍] ship the redesign
  [1] write the spec
  [2] wire up tests
  [3] update the README
  [4✅] investigate the cache miss ✏️
```

The side-quest item stays in the tree with `✅` and a note (`✏️`)
recording what you found. Your active position is back where you were.

## 5. Goto when you didn't pop

Sometimes you wandered off without closing what you started. Just
`goto` to teleport back.

```bash
$ noggin push "quick aside"
$ noggin goto /1            # absolute path — back to the top item
```

Paths use 1-based positions. `/1` is the first root, `/1/2` is its
second child, etc. Relative forms (`.`, `..`, `+`, `-`) work too;
see the [CLI reference](../cli/).

## 6. Mark things done

```bash
$ noggin goto /1/1
$ noggin done
[1📍] ship the redesign
  [1✅] write the spec
  [2]   wire up tests
  …
```

`done` closes the item *and* moves active to the parent — the natural
"finished, what's next?" motion. To close without moving, use
`edit --done`.

## 7. Take resumption notes

Before context-switching, leave breadcrumbs:

```bash
$ noggin note "left off rewriting the migration on line 142; \
next step: validate the rollback path"
```

Notes are append-only, timestamped, and free-form. Nothing else about
content has a fixed schema.

## What you've learned

- `push` to enter, `add` to capture.
- `pop` (or `goto`) to come back.
- `note` to record state before switching.
- `done` to finish and surface.
- Paths are display coordinates; the active `📍` is your cursor.

## Next

- [CLI reference](../cli/) for every verb and flag.
- [Verb demo](../demo/) to see the JSON envelope for each verb.
- [JavaScript API](../api/) if you're embedding noggin in code.
