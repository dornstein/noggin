---
name: noggin
description: >
  A working-memory tree for in-flight work — your second brain for
  the work you can't fit in your head. Items form a tree: any item
  can have child items. Push when you go on a side-quest so you
  don't lose your place; add a child when you want to remember a todo
  without diving in; goto an item to make it active; mark it done
  when it's finished; use edit for explicit lifecycle correction. An item just has a
  title, a done flag, and append-only notes — no fixed schema for
  what content matters. Backed by a single YAML file via a small CLI; the
  file is the source of truth. USE FOR: I'm pausing this to chase X,
  side-quest, defer this, jot down a todo under what I'm doing, where
  was I, push an item, add a todo, goto an item, move up with `goto ..`, mark
  this done, edit, what was I working on, what's on my noggin, drop
  a resumption note before I context-switch. DO NOT USE FOR: long-term plans
  (use the engineer/plan workflow), team-visible task tracking (use
  ADO/work items), persistent project memory (use repo memory or
  docs).
---

# noggin (agent guide)

A small, single-user working-memory tree. Lives in `~/.noggin.yaml`.
Driven by the noggin verbs — surfaced as a CLI (`noggin.mjs`), an MCP
server (`noggin-mcp`), or in-process language-model tools depending on
where you're running. **Always use a noggin verb to read or write the
tree.** Don't open the YAML file directly.

The full human reference (file schema, atomic-write story, complete
flag list) is in [README.md](README.md). This file is for you, the
agent: when to invoke the skill, what verb to pick, and how to behave
around its output.

## Mental model in 60 seconds

- Items form a tree. At most one item is **active**. The path from a
  root to the active item is the user's current spine.
- Open items that are not active are paused. Done items stay in the
  tree under their parent so the user can see what got finished.
- **push** = create a child of active and become it (doing this now).
- **add** = create a child without becoming it (remember for later).
- An item has: title, done flag, a `createdAt` timestamp, and
  append-only notes. Nothing else. If something matters, write a
  `note`. Closing an item appends a system-generated `closed` note
  whose timestamp is the close time.

## Path shorthand

| Token | Meaning |
|---|---|
| `/1/2/3` | **absolute** (positions from root). Always starts with `/`. |
| `.` | active item |
| `..` | parent of active |
| `-` / `+` | previous / next sibling of active |
| `./X`, `../X`, `-/X`, `+/X` | descendants from those anchors |
| `X` / `X/Y` | bare positions are short for `./X` / `./X/Y` — **relative to active** |

The leading `/` is the only marker that makes a path absolute.
Everything else is relative and needs an active item. Output (from
`show`, JSON `activePath`, error messages, etc.) is always in the
canonical absolute form `/…`. Paths are display coordinates, not
stable IDs. Don't store them.

## Verb selection (the main job)

| What the user said | Verb |
|---|---|
| "Pause this — chase X first" / "drop everything" | `push <title>` |
| "While we're here, jot down Y" / "don't forget Z" | `add <title>` (place with `--before` / `--after` / `--into` if order matters) |
| "Switch back to Y" / "go to that thing" | `goto <path>` |
| "This is finished" (active) | `done` (or `pop`) — surfaces to parent |
| "That one over there is finished too" | `done <path>` |
| "Back to where I was" if side-quest done | `done` |
| "Back to where I was" if not done | `goto ..` |
| "Actually not finished, undo it" | `edit [<path>] --open` |
| "Mark X done but don't move me" | `edit <path> --done` |
| "Close X and everything under it" | `edit <path> --done --close-all` (or `done <path> --close-all`) |
| "Where was I?" / "what's on my noggin?" | `show` |
| "Reorder these" / "move that one up" | `move [<path>] (--before\|--after\|--into <anchor>)` |
| "Add a note about X" | `note <text>` (active) or `note <path> <text>` |
| "Rename this" | `edit [<path>] --title <new title>` |
| "Drop this" / "never mind, delete it" | `delete <path>` (add `--recursive` if it has children) |
| "Migrate my noggin into this repo" / "copy the home noggin into this folder" | `copy <from> <to>` (whole-noggin, append-only; preserves notes and timestamps) |

Default to `push` for active side-quests, `add` for everything that
can wait. The cost of `add` is near zero — capture stray "we should
also…" remarks rather than letting them evaporate.

## Behavioral protocol

1. **Watch for switch phrases.** "pause this," "side-quest," "defer
   this," "drop this for a sec," "while we're here also…," "where
   were we?" — these are cues to invoke the skill.
2. **Capture state on the outgoing item before pushing or leaving.**
   A short `note`, or a longer resumption note (template below) when
   the switch is non-trivial.
3. **Acknowledge the change in one line.** e.g. "Pushed `/1/2/3 —
   spike storage layer`. Spine: `/1` → `/1/2` → `/1/2/3`."
4. **Echo CLI output in chat.** The user shouldn't have to expand
   hidden tool sections to see results. Include the meaningful
   command output in your reply after every noggin call.
5. **Always print `show` output in chat by default**, even when the
   user didn't explicitly ask to "show output."
6. **When the user asks to see output, quote it verbatim** (or a
   clearly labeled trimmed excerpt if it is very large).
7. **Don't background-sync.** The file is the user's; never modify it
   without an explicit user-visible action.
8. **Don't block on it.** If the CLI errors, surface the error, fall
   back to plain conversation, and move on. Noggin is a memory aid,
   not a gate.
9. **Never read or write the YAML file directly.** Don't `Test-Path`,
   `cat`, or grep the noggin file. Use a noggin verb (CLI, MCP tool,
   or LM tool) every time. If the verb's output doesn't answer your
   question, that's a verb bug — file/fix it or accept the answer it
   gave you.
10. **In VS Code, prefer the language model tools** (`#nogginShow`,
   `#nogginPush`, `#nogginAdd`, `#nogginGoto`, `#nogginDone`,
   `#nogginPop`, `#nogginNote`, `#nogginEdit`,
   `#nogginMove`, `#nogginDelete`) over shelling out to `noggin.mjs`. The tools always
   target the noggin the user has open in the editor. If you do shell
   out, the CLI honors the `NOGGIN` env var, which the extension
   sets in every terminal — so `node noggin.mjs ...` in a VS Code
   terminal still hits the right file. Use `noggin where` if you need
   to confirm which file the CLI would touch.
11. **Outside VS Code (GitHub Copilot CLI, Claude Code, Codex), prefer the MCP
   tools** (`noggin_show`, `noggin_push`, etc.) when the host has the
   noggin MCP server wired up — they return the same JSON envelope as
   the CLI with no spawn cost. Fall back to `noggin.mjs` only when no
   tool surface is available.
12. **The MCP server is multi-noggin: every tool call requires a `noggin`
   parameter** — a canonical location string like `~/.noggin.yaml`,
   `./.noggin.yaml`, or `file:///abs/path.yaml`. There is no
   server-wide default. Pass the location the user is working with;
   if you don't know it, ask. Use `noggin_where` to confirm a noggin
   is reachable, or `noggin_providers` to discover what location forms
   the server accepts.

## Resumption note template

When the user is about to context-switch on something non-trivial,
offer to append a structured note in this shape:

```
Where I am
  - branch / file / cursor
  - last action

What I believe
  - the model this work assumes
  - constraints and invariants

Ruled out
  - approaches considered and rejected (and why)

Decisions in flight
  - questions that aren't settled yet

Resume by
  - the literal first thing to do on return
```

It's a regular `note`; the schema doesn't enforce structure. Offer
the template; don't impose it.
