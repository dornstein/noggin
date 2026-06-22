---
title: Quickstart — Agent
slug: "quickstart/agent/"
---

# Quickstart: agent

Use noggin through an LLM agent — GitHub Copilot Chat, Claude Code,
OpenAI Codex, or any other host that loads the noggin
[plugin](../../install/) or its MCP server. The agent reads the noggin
[skill](https://github.com/dornstein/noggin/blob/main/cli/SKILL.md)
and picks verbs for you; you talk in plain English.

## 1. Make sure noggin is wired up

- **VS Code + Copilot Chat**: install the [extension](../../install/);
  the skill + language-model tools are loaded automatically.
- **GitHub Copilot CLI, Claude Code**: install the
  [agent plugin](../../install/) (gets you the skill) and add the MCP
  server entry (gets you the tools). The plugin install page has the
  exact wiring.
- **OpenAI Codex**: install the marketplace plugin; skill + MCP server
  ship together.

You'll know it's working when typing about pausing or capturing work
makes the agent invoke a `noggin_*` tool.

## 2. Push when you context-switch

Just say what you mean:

> "Pause this — I need to chase down a regression in the cache layer
> before I forget."

The agent will run `noggin push "regression in cache layer"`, take
you down into the side-quest, and confirm:

> Pushed `/1/2 — regression in cache layer`. Active: `/1/2`.

Working assumption: when you say "pause", "side-quest", "go look at",
"defer this for a sec" — push.

## 3. Add when you don't want to dive in

> "Don't let me forget to update the README before I ship this."

The agent runs `noggin add "update the README before shipping"` as a
child of the active item without making it active. You stay where you
are; the todo is captured.

## 4. Notes for resumption

Before a meaningful context switch, ask the agent to take a resumption
note:

> "Before I switch off this, jot down where I left off."

The agent will follow the noggin skill's
[resumption note template](https://github.com/dornstein/noggin/blob/main/cli/SKILL.md#resumption-note-template):

```
Where I am
  - branch users/me/cache-fix
  - last action: added retry logic in tryFetch()

What I believe
  - root cause is TTL wrap when timezone offsets cross midnight

Ruled out
  - cache key collision (verified with dump)

Decisions in flight
  - whether to backport to v1.x

Resume by
  - run the failing test in tests/cache-ttl.test.ts and step into tryFetch
```

When you (or a new chat) returns, "show me where I left off" reads it
back.

## 5. Pop when finished

> "Done with the regression — back to where I was."

The agent runs `noggin pop` (= done on active, then surface). The
side-quest item stays in the tree with `✅` and your notes; active
returns to where it was.

## 6. Where was I?

> "What's on my noggin?"

The agent runs `noggin show` and prints the current-tree view (spine
+ peers + first-level children) inline in the chat.

## What you've learned

- You don't say "run `noggin push X`" — you say "pause this, chase X."
- The agent picks the verbs from the skill.
- Resumption notes are how you reload context after a break.

## Next

- [Skill spec](https://github.com/dornstein/noggin/blob/main/cli/SKILL.md) —
  what the agent actually reads.
- [CLI reference](../../cli/) — when you want to peek at the underlying
  commands the agent is running.
- [VS Code quickstart](../vscode/) — for the same workflows plus a
  sidebar UI.
