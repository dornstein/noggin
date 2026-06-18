# noggin

A small, single-user working-memory tree for in-flight work — your
second brain for the stuff you can't fit in your head.

Lives in `~/.noggin.yaml` by default. Override per call with `--file
<path>`, or set `$NOGGIN_FILE` to point every invocation at a
different file. (The VS Code extension sets `NOGGIN_FILE` in its
terminals so the CLI follows whichever noggin you have open.) Driven
by [`cli.mjs`](cli.mjs) next to this file. The YAML file is the source
of truth; the CLI is the only sanctioned way to read or write it.

For the agent-facing behavioral instructions, see [SKILL.md](SKILL.md).
This document is the human reference: what noggin is, what the
commands do, how the file is shaped.

## Mental model

Items form a tree. There is at most one **active** item; the path
from a root to the active item is your current spine. Other open
items are paused — work you started but stepped away from. Done
items stay in the tree under their parent so you can see what got
finished. Use `set-state --undone` if it turns out something was not
really finished.

An item and a "todo" are the same thing at different lifecycle stages:

- **push** = create a child of active and immediately become it
  ("I'm going to do this now").
- **add** = create a child of active without becoming it (a deferred
  task; same shape, just never activated).

You can later `goto` an added child to make it active, or just `done`
it without ever activating.

### What an item carries

Just the things that are about an item *being an item* in the tree:

- a **title** (one line)
- a **done** flag and timestamps (`pushedAt`, `closedAt`)
- append-only timestamped **notes** — anything you want to remember

There is **no fixed schema** for things like "why," "where," "what's
next," tags, or resolution. If it matters, drop a `note`. The CLI
stays focused on tree shape and lifecycle; everything else is content
the user (or an agent) writes in note text.

## Identifiers and paths

- **key** — an opaque, stable internal identifier (e.g.
  `i-20260616-184644-f04bf5`). Used in the YAML file for parent links
  and the active pointer. Hidden from human output; included in JSON
  output when you want to inspect it.
- **position** — a computed 1-based index among siblings. Shown in
  brackets in human output, e.g. `[2]`.
- **path** — how you refer to items on the command line.

### Path syntax

Absolute: slash-joined positions from a root.

```
"1/2/3"
 │ │ │
 │ │ └── third child of "1/2"
 │ └──── second child of root "1"
 └────── first root item
```

Relative to the active item (file-system style):

| Token | Meaning |
|---|---|
| `.` | active item |
| `..` | parent of active |
| `-` | previous sibling of active |
| `+` | next sibling of active |
| `./X/Y` | descendant of active |
| `../X` | sibling of active (child X of parent) |
| `-/X/Y` | descendant under the previous sibling |
| `+/X/Y` | descendant under the next sibling |
| `../../X` | walk up two and then down |

Any path that doesn't start with `.`, `..`, `-`, or `+` is treated as
absolute. Paths are coordinates into the current tree order — they
are intended for immediate interactive use, not long-term bookmarks.
Stable identity lives in `key` and `parentKey`.

## Command reference

Every command takes:

- `--file <path>` — override the file resolution (highest priority).
- `--json` — emit structured JSON instead of the human tree view.
- `--debug` — human output followed by JSON.

The file is resolved in this order:

1. `--file <path>`
2. `$NOGGIN_FILE` environment variable
3. `~/.noggin.yaml`

Use `noggin where` at any time to print which file would be used and
why.

Commands that change or inspect a target also take `--goto [path]`.
With no path, `--goto` activates the command's target; with a path,
the path resolves from the command target (not from the previously
active item).

Common flags can appear before or after the verb.

| Verb | Effect |
|---|---|
| `push <title>` | Create a child of active and make it active. |
| `add <title> [--before\|--after\|--into <path>] [--goto [path]]` | Create a child of active by default. `--before <path>` / `--after <path>` insert as a sibling of the anchor; `--into <path>` makes it the last child of the anchor. Active does **not** change unless `--goto` is present. |
| `move [<path>] (--before\|--after\|--into <path>) [--goto [path]]` | Relocate an item. Default target is the active item. Exactly one of `--before` / `--after` / `--into` is required. Active is preserved by key, so the computed path may change but `📍` stays on the same item. Cycles (anchor in the moved subtree) are rejected. |
| `goto <path>` | Make the item at `<path>` active. |
| `done [<path>]` | Mark an item done, then make the target's parent active. Refuses if open descendants exist. Root items leave no active item after completion. |
| `pop` | Shorthand for `done` on the active item (no path). |
| `set-state [<path>] (--done\|--undone) [--goto [path]]` | Explicitly set lifecycle state. Default target is active. Exactly one of `--done` / `--undone` is required. Active does not move unless `--goto` is present. |
| `show [<path>] [--nokids] [--notes] [--goto [path]]` | Current-position view: ancestor spine, sibling peers, current-item details, and first-level children. Default target is active. `--nokids` skips children. `--notes` appends note bodies. |
| `note [<path>] <text…> [--goto [path]]` | Append a timestamped note. |
| `retitle [<path>] <new title…> [--goto [path]]` | Change an item's title. |
| `delete <path> [--recursive]` | Remove an item. Refuses if the item has descendants unless `--recursive` is passed, in which case the whole subtree is deleted. If the active item is inside the deleted subtree, active falls back to the deleted item's parent (or becomes empty if it was a root). |
| `where` | Print which noggin file would be used and why (flag / env / default). |
| `help` | Print full help. |

### Tree output

Each row is `[position<indicators>] title`. Indicators after the
position are:

- `📍` active
- `✅` done
- `✏️` has notes

`show` keeps note bodies collapsed by default; pass `--notes` to
append them after the tree.

### JSON output

`--json` and `--debug` emit structured JSON that mirrors the current
tree view. Fields with default values (`null`, `false`, empty arrays,
empty objects) are omitted to keep the payload focused. Stable
internal `key` and `parentKey` are included so you can correlate
items across calls. Notes appear as `{ timestamp, text }` objects.

## File schema (v1)

The CLI reads and writes a single YAML file. Writes are atomic: the
CLI writes to `<file>.tmp-<pid>-<ts>` and renames over the real path,
so a partial write never corrupts the user's file.

### Top-level shape

```yaml
schemaVersion: 1
active: <key> | null   # the item currently being worked on
items: []              # flat array; tree is implied via parentKey
```

- `schemaVersion` is required and must equal `1`. Any other value
  causes the CLI to refuse to read the file.
- `active` is the opaque `key` of the active item, or `null` when
  nothing is active. The active item's path is computed at runtime
  by walking parents.
- `items` is a flat list. Tree structure comes from `parentKey`
  pointers. Sibling order is array order, and display positions are
  computed from that order.

### Item shape

```yaml
- key: i-20260616-184644-f04bf5 # opaque, immortal
  parentKey: null               # null = root item
  title: marketplace import path
  done: false                   # true once finished; reversible via `set-state --undone`
  pushedAt: 2026-06-16T18:46:44.071Z
  closedAt: null                # set when done flips true; cleared on set-state --undone
  notes:
    - timestamp: 2026-06-16T18:46:45.625Z
      text: found the storage abstraction in tableStorageService
    - timestamp: 2026-06-16T18:46:46.200Z
      text: |
        Resumption note

        Where I am
          - branch users/davidorn/marketplace-import
          ...
```

### Field semantics

| Field | Purpose |
|---|---|
| `key` | Opaque, never reused. Format `i-YYYYMMDD-HHMMSS-<hex>` (display only — don't parse). Hidden from human output; included in JSON. |
| `parentKey` | Opaque key of the parent item, or `null` for roots. Multiple roots are allowed. |
| `title` | One-line human label. |
| `done` | `false` while the work is live, `true` once finished. Reversible via `set-state --undone`. |
| `pushedAt` | ISO-8601 timestamp when the item was created. |
| `closedAt` | ISO-8601 timestamp when `done` last flipped to `true`, else `null`. Cleared back to `null` on `set-state --undone`. |
| `notes` | Append-only list of note objects with independent `timestamp` and `text` fields. |

### Invariants

The CLI validates these on every save:

1. Every item has a unique `key`.
2. Every non-null `parentKey` references an existing item.
3. `active`, if non-null, references an existing item. An active
   item may have `done: true` after explicit `set-state --done`; use
   `set-state --undone` to revert, or `goto ..` to leave it.
4. Done items (`done: true`) remain in the tree (they are not
   deleted) and can be reverted via `set-state --undone`.
5. An item cannot be marked done while it has any open descendant.

## Resumption notes

Resumption notes are for **cold-start rehydration** — what an LLM (or
you, two days later) needs to resume work without reading the whole
session. They are just notes; the schema does not enforce structure.

A useful shape:

```
Where I am
  - branch / file / cursor
  - last action

What I believe
  - the model of the system that this work assumes
  - constraints and invariants

Ruled out
  - approaches considered and rejected (and why)

Decisions in flight
  - questions that aren't settled yet

Resume by
  - the literal first thing to do on return
```

Append it as a normal note:

```powershell
node cli.mjs note "Resumption note`n`nWhere I am`n  - ...`nResume by`n  - ..."
```

## Constraints

- Single-user, single-machine. No collaboration, no network, no
  remote sync.
- The CLI is intentionally tiny: stdlib + `js-yaml`. Bundleable into
  the Agency plugin if needed (vendor `js-yaml` next to `cli.mjs` at
  bundle time).
