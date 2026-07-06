---
title: Quickstart — Agent
slug: "quickstart/agent/"
---

# Quickstart: agent

Use noggin through an LLM agent — GitHub Copilot Chat, Claude Code,
OpenAI Codex, or any other host that loads the noggin plugin (see
step 1 below) or its MCP server. The agent reads the noggin
[skill](https://github.com/dornstein/noggin/blob/main/engine/SKILL.md)
and picks verbs for you; you talk in plain English.

## 1. Make sure noggin is wired up

**VS Code + Copilot Chat** — install the [extension](../vscode/); the
skill and language-model tools are loaded automatically. No separate
agent setup needed.

**GitHub Copilot CLI** — `copilot` has its own plugin marketplace
system, separate from VS Code's Command Palette:

```
copilot plugin marketplace add dornstein/noggin
copilot plugin install noggin@noggin
```

(Inside an already-running interactive `copilot` session, use the
slash-command form instead: `/plugin marketplace add dornstein/noggin`
then `/plugin install noggin@noggin`.) That gets you the skill plus
the bundled CLI. Then add the [MCP server](../../mcp/) entry to
`~/.copilot/mcp-config.json` (recommended wiring: `npx -y
noggin-mcp@latest`) so the agent can call the tools directly.

> "GitHub Copilot CLI" here means the agentic
> [`copilot`](https://github.com/github/copilot-cli) CLI — not the
> older `gh copilot` extension to the `gh` command, which is just a
> shell-command suggester and doesn't load plugins or MCP servers.

**Claude Code** — also has its own plugin marketplace system, not a
Command Palette:

```
claude plugin marketplace add dornstein/noggin
claude plugin install noggin@noggin
```

(Inside an interactive session, use `/plugin marketplace add
dornstein/noggin` then `/plugin install noggin@noggin`.) Same deal —
that's the skill plus the CLI; add the MCP server entry to your
Claude Code config (see the [MCP reference](../../mcp/) for the exact
file path per OS) separately for the tools.

**OpenAI Codex** —

```
codex plugin marketplace add dornstein/noggin
```

Then `/plugins` in the Codex CLI (or the Plugins view in the Codex
app), pick **Noggin**, install. Skill, CLI, and MCP server ship
together — no extra wiring.

You'll know it's working when typing about pausing or capturing work
makes the agent invoke a `noggin_*` tool. See the
[MCP reference](../../mcp/) for the full list of tools, their
parameters, and host-specific config locations.

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
[resumption note template](https://github.com/dornstein/noggin/blob/main/engine/SKILL.md#resumption-note-template):

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

- [Skill spec](https://github.com/dornstein/noggin/blob/main/engine/SKILL.md) —
  what the agent actually reads.
- [CLI reference](../../cli/) — when you want to peek at the underlying
  commands the agent is running.
- [VS Code quickstart](../vscode/) — for the same workflows plus a
  sidebar UI.
