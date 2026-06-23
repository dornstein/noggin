# noggin

A small, single-user working-memory tree for in-flight work — your
second brain for the stuff you can't fit in your head.

Lives in `~/.noggin.yaml` by default. Override per call with `--file
<path>`, or set `$NOGGIN` to point every invocation at a
different file. (The VS Code extension sets `NOGGIN` in its
terminals so the CLI follows whichever noggin you have open.) Driven
by [`noggin.mjs`](noggin.mjs) next to this file. The YAML file is the source
of truth; the CLI is the only sanctioned way to read or write it.

For the agent-facing behavioral instructions, see [SKILL.md](SKILL.md).
This document is the human reference: what noggin is, what the
commands do, how the file is shaped.

## Mental model

Items form a tree. There is at most one **active** item; the path
from a root to the active item is your current spine. Other open
items are paused — work you started but stepped away from. Done
items stay in the tree under their parent so you can see what got
finished. Use `edit --open` if it turns out something was not
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
- a **done** flag and a `createdAt` timestamp
- append-only timestamped **notes** — anything you want to remember,
  including a system-generated `closed` note appended whenever the item
  transitions from open to done (the note's timestamp records when)

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

The leading `/` is the unambiguous marker that separates the two
families of paths.

**Absolute** paths start with `/` and walk from a root. This is the
canonical form used everywhere the API or human output reports a
path (`activePath`, `ItemView.path`, `parentPath`, error messages).

```
"/1/2/3"
  │ │ │
  │ │ └── third child of "/1/2"
  │ └──── second child of root "/1"
  └────── first root item
```

**Relative** paths are everything else, resolved against the active
item (file-system style):

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
| `X` / `X/Y` | bare positions are short for `./X` / `./X/Y` |

Relative paths require an active item. If none is set, pass an
absolute path instead (e.g. `noggin show /1` rather than `noggin
show 1`).

Paths are coordinates into the current tree order — they are
intended for immediate interactive use, not long-term bookmarks.
Stable identity lives in `key` and `parentKey`.

## Command reference

Every command takes:

- `--file <path>` — override the file resolution (highest priority).
- `--json` — emit structured JSON instead of the human tree view.
- `--with-json` — human output followed by JSON.

The file is resolved in this order:

1. `--file <path>`
2. `$NOGGIN` environment variable
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
| `done [<path>] [--force\|--close-all]` | Mark an item done, then make the target's parent active. Idempotent (no error if already done). Refuses if open descendants exist unless `--close-all` first closes them or `--force` closes just the target anyway. Root items leave no active item after completion. |
| `pop [--force\|--close-all]` | Shorthand for `done` on the active item (no path). Honors `--force` and `--close-all` the same way. |
| `edit [<path>] [--done\|--open] [--title T] [--force\|--close-all] [--goto [path]]` | Idempotent mutation of a single item's lifecycle state and/or title. Pass at least one of `--done` / `--open` / `--title`. Active is unchanged unless `--goto` is passed. When closing (`--done`), the same open-descendant rules apply as `done`: `--force` closes anyway, `--close-all` closes descendants first. Replaces the older `set-state` and `retitle` verbs. |
| `show [<path>] [--no-children\|--with-descendants] [--with-siblings] [--with-all] [--with-notes] [--goto [path]]` | Current-position view: ancestor spine, sibling peers, current-item details, and first-level children. Default target is active. `--no-children` omits children. `--with-siblings` also includes the full sibling row at every ancestor depth (sibling subtrees stay collapsed). `--with-descendants` expands the target's subtree recursively. `--with-all` = `--with-siblings --with-descendants`. `--with-notes` appends note bodies. `--no-children` and `--with-descendants` are mutually exclusive. |
| `note [<path>] <text…> [--goto [path]]` | Append a timestamped note. |
| `delete <path> [--recursive]` | Remove an item. Refuses if the item has descendants unless `--recursive` is passed, in which case the whole subtree is deleted. If the active item is inside the deleted subtree, active falls back to the deleted item's parent (or becomes empty if it was a root). |
| `where` | Print which noggin file would be used and why (flag / env / default). |
| `help` | Print full help. |

### Tree output

Each row is `<absolute-path> <state> title <notes>`, with three
optional indicator slots:

- `📍` (between path and title) — this is the active item
- `✅` (between path and title) — done
- `✏️` (trailing) — has notes

Every row leads with the item's absolute path (`/1/3` etc.) so each
row self-describes — ancestors on the spine still read clearly even
though their siblings are trimmed from the view.

`show` keeps note bodies collapsed by default; pass `--with-notes` to
append them after the tree.

### JSON output

`--json` and `--with-json` emit a stable response envelope shared with
the VS Code extension's language-model tools, so a single consumer can
target both surfaces.

```jsonc
// success
{
  "status": "ok",
  "envelopeVersion": 3,      // RESPONSE_ENVELOPE_VERSION — bump on breaking changes
  "verb": "push",            // command that produced this payload
  "data": { … }              // verb-specific (CurrentTreeView, DeleteResult, …)
}

// error (written to stderr; exit code matches error.exitCode)
{
  "status": "error",
  "envelopeVersion": 3,
  "verb": "push",
  "error": { "code": "title-required", "message": "…", "exitCode": 2 }
}
```

`envelopeVersion` versions the wrapper shape (and the per-verb
payloads inside `data`), independently of the on-disk document's
`schemaVersion` (see [File schema](#file-schema-v1)). The two rev
on different cadences.

Inside `data`, a small whitelist of fields whose value matches their
declared default is **omitted** to keep payloads focused. A consumer
that doesn't see one of these fields should treat it as the default:

| Field | Omitted when |
|---|---|
| `parentKey` | `null` (item is a root) |
| `done` | `false` (item is still open) |
| `notes` | `[]` (no notes) |
| `activePath` | `null` (no active item) |
| `activeKey` | `null` (no active item) |
| `descendantCount` | `0` (in `DeleteResult`) |
| `view` | `null` (delete left the tree empty) |

Everything else is always present, including the envelope itself
(`status`, `envelopeVersion`, `verb`, `data` / `error`).

`where --json` is a special case: `data` is a plain human-readable
string describing the noggin's backend location (e.g.
`file: /path/to/.noggin.yaml\n  exists: true`), not a structured
object.

`ViewNode.children` is special: it's already a tri-state encoded by
presence (see `CurrentTreeView` below). Pruning doesn't touch it.

#### `CurrentTreeView`

Returned in `data` by every mutating verb and by `show`. Carries
everything the human "current tree" view shows, so JSON consumers can
reconstruct the same picture without re-reading the file.

```jsonc
{
  "activePath": "/1/2/3",     // path of the active item, or null
  "activeKey":  "i-…",        // opaque key of the active item, or null
  "targetKey":  "i-…",        // opaque key of the item the verb acted on
  "items": [                  // top of the rendered tree (see below)
    { …ItemView…, "children"?: [ ViewNode, … ] },
    …
  ]
}
```

The view is a **recursive tree**. Each node (`ViewNode`) is an
`ItemView` (the usual `key, parentKey, path, position, title, done,
createdAt, notes` fields) plus an *optional* `children` slot:

| `children` | Meaning |
|---|---|
| present (array, possibly `[]`) | this view renders this node's child level; the array is the rendered children |
| **absent** | leaf of this view — the store may have a subtree here, but this view doesn't render it |

The recursion walks the direct ancestor chain from a root down to the
target. Sibling-of-ancestor items are **trimmed** — each intermediate
ancestor's `children` is a single-element array. The target's parent's
`children` is the full **peer row** (siblings + target itself, in
tree order). The target itself carries its first-level kids in
`children` (or omits the field entirely with `--no-children`).

Peers and grandkids (the children listed under the target) are
**leaves of the view**: no `children` field. To explore their
subtrees, call `show` on them.

`items` is either:
- a one-element array containing the target's root ancestor, when the
  target is below the root level; or
- the target's full peer row (the actual store roots, in tree order),
  when the target itself is a root.

To find the target node, walk the tree and match on `targetKey`.

Active is reported separately as both `activePath` and `activeKey`
because the active item may not appear in this view at all (e.g.
`add --into <other-branch>` returns a view of the new item, but
active is unchanged on a different branch). A consumer that wants
to show "📍 you're at `X`" needs the path explicitly.

An `ItemView` is `{ key, parentKey, path, position, title, done,
createdAt, notes }`. Notes are `{ timestamp, text }` objects.

#### `DeleteResult`

Returned in `data` by `delete`. Always carries the deletion record;
`view` is `null` only when the tree is left with no active item.

```jsonc
{
  "deleted": { "key": "i-…", "path": "/1/2/3", "title": "…" },
  "descendantCount": 2,
  "view": { … CurrentTreeView … } | null
}
```

#### `where`

Returns a plain string describing the noggin's backend location.
For the file backend this looks like
`file: /path/to/.noggin.yaml\n  exists: true`. The CLI's human
output adds a `source: flag|env|default` line below it.

## JavaScript API

For consumers embedding noggin in a Node process (the VS Code
extension, custom tooling), there's a small public API beyond the
CLI:

```js
import { fileNoggin } from 'noggin/backends/file';

const noggin = await fileNoggin('/path/to/.noggin.yaml', { watch: true });
const view = await noggin.push({ title: 'spike storage layer' });
console.log(noggin.active?.title);
noggin.onDidChange(() => render(noggin.items));
await noggin.dispose();
```

### Public surface

| What | Where |
|---|---|
| `Noggin` class — live noggin with verb methods, accessors, events | `noggin/noggin-api.mjs` |
| `fileNoggin(path, opts?): Promise<Noggin>` — open a file-backed noggin | `noggin/backends/file.mjs` |
| `applyX(doc, opts, ctx?)` — pure verb functions over `NogginDocument` | `noggin/noggin-api.mjs` |
| `fromYaml` / `toYaml` / `fromJson` / `toJson` — serializers | `noggin/serializers/{yaml,json}.mjs` |
| `NogginError`, `NogginErrorCode` — typed errors | `noggin/noggin-api.mjs` |
| `formatSuccess` / `formatError` — response envelope helpers | `noggin/noggin-api.mjs` |
| `SCHEMA_VERSION`, `RESPONSE_ENVELOPE_VERSION` — constants | `noggin/noggin-api.mjs` |

All `Noggin` verb methods return `Promise`. Per-instance calls are
serialized (in-process queue); cross-process callers should treat
the file as advisory-locked at the application layer.

### `NogginDocument` shape

The serialized form (what the JSON Schema validates, what
serializers convert to/from) is just:

```ts
interface NogginDocument {
  schemaVersion: 1;
  active: ItemKey | null;
  items: Item[];
}
```

A live `Noggin` does not expose `schemaVersion` — that's a wire
concern, owned by the serializers.

## File schema (v1)

The CLI reads and writes a single YAML file. Writes are atomic: the
CLI writes to `<file>.tmp-<pid>-<ts>` and renames over the real path,
so a partial write never corrupts the user's file.

A machine-readable JSON Schema for the noggin data model is published
at the repo root as [`noggin.schema.json`](../noggin.schema.json).
The schema describes the shape itself, independent of any particular
producer or consumer — YAML 1.2 is a JSON superset, so the same schema
validates both YAML and JSON renderings. To get autocomplete and inline
validation in VS Code, install the Red Hat YAML extension and add to
your settings:

```jsonc
"yaml.schemas": {
  "https://dornstein.github.io/noggin/noggin.schema.json": [
    ".noggin.yaml",
    "**/.noggin/*.yaml"
  ]
}
```

The CLI enforces stronger invariants than JSON Schema can express
(unique keys, `parentKey`/`active` referential integrity, the "done
items have no open descendants" rule unless force-closed) — see
[Invariants](#invariants) below.

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
  done: false                   # true once finished; reversible via `edit --open`
  createdAt: 2026-06-16T18:46:44.071Z
  notes:
    - timestamp: 2026-06-16T18:46:45.625Z
      text: found the storage abstraction in tableStorageService
    - timestamp: 2026-06-16T18:46:46.200Z
      text: |
        Resumption note

        Where I am
          - branch users/davidorn/marketplace-import
          ...
    - timestamp: 2026-06-16T18:50:11.300Z
      text: closed         # system-generated when the item is closed
```

### Field semantics

| Field | Purpose |
|---|---|
| `key` | Opaque, never reused. Format `i-YYYYMMDD-HHMMSS-<hex>` (display only — don't parse). Hidden from human output; included in JSON. |
| `parentKey` | Opaque key of the parent item, or `null` for roots. Multiple roots are allowed. |
| `title` | One-line human label. |
| `done` | `false` while the work is live, `true` once finished. Reversible via `edit --open`. |
| `createdAt` | ISO-8601 timestamp when the item was created. |
| `notes` | Append-only list of `{ timestamp, text }` objects. Each user note is added by `noggin note`. A single system-generated note with text `closed` is appended whenever the item transitions from open to done (via `done`, `pop`, `edit --done`, or the extension UI). Reopening with `edit --open` does not add or remove notes — the historical close stays in the log. |

### Invariants

The CLI validates these on every save:

1. Every item has a unique `key`.
2. Every non-null `parentKey` references an existing item.
3. `active`, if non-null, references an existing item. An active
   item may have `done: true` after explicit `edit --done`; use
   `edit --open` to revert, or `goto ..` to leave it.
4. Done items (`done: true`) remain in the tree (they are not
   deleted) and can be reverted via `edit --open`.
5. A done item may have open descendants only when it was closed
   with `--force`. The standard close paths (`done`, `pop`, `edit
   --done` without flags, or with `--close-all`) preserve the
   stronger invariant "done items have no open descendants".

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
node noggin.mjs note "Resumption note`n`nWhere I am`n  - ...`nResume by`n  - ..."
```

## Constraints

- Single-user, single-machine. No collaboration, no network, no
  remote sync.
- The CLI is intentionally tiny: stdlib + `js-yaml`. Bundleable into
  the Agency plugin if needed (vendor `js-yaml` next to `noggin.mjs` at
  bundle time).
