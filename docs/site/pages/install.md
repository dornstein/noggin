---
title: Install
slug: "install/"
---

# Install

Pick the environment you want. The four experiences (sidebar UI,
agent skill, agent tools, bare CLI) are described on the
[overview page](../).

## VS Code extension

Install from the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=davidorn.noggin-vscode).

You get:

- A **sidebar tree** with drag-and-drop reordering.
- A **details pane** with inline-editable notes.
- A **status bar item** showing the active item.
- The **agent skill** loaded into Copilot Chat automatically.
- **Language-model tools** (`#nogginPush`, `#nogginShow`, …) the agent
  can call directly without spawning a CLI subprocess.

See [`extension/README.md`](https://github.com/dornstein/noggin/blob/main/extension/README.md) for
the full feature list.

## Agent plugin

For VS Code, GitHub Copilot CLI, and Claude Code, install via the
Command Palette:

```
> Chat: Install Plugin From Source
  https://github.com/dornstein/noggin.git
```

You get the agent skill plus the bundled CLI. No UI — install the
extension above for that.

For hosts that load MCP servers explicitly rather than agent plugins
(GitHub Copilot CLI, Claude Code), see
[`plugin/README.md`](https://github.com/dornstein/noggin/blob/main/plugin/README.md#mcp-setup-other-hosts).
The recommended setup is `npx -y -p noggin-cli@latest noggin-mcp`.

> "GitHub Copilot CLI" here means the agentic
> [`copilot`](https://github.com/github/copilot-cli) CLI — not the
> older `gh copilot` extension to the `gh` command, which is just a
> shell-command suggester and doesn't load skills or MCP servers.

## OpenAI Codex

```
codex plugin marketplace add dornstein/noggin
```

Then `/plugins` in the Codex CLI (or the Plugins view in the Codex
app), pick **Noggin**, install. Bundles the skill, the CLI, and the
MCP server.

## Bare CLI

```bash
npm install -g noggin-cli
noggin help

# or, ad-hoc:
npx -y -p noggin-cli noggin help
```

Runs on Node 20+.

## What's next

- [Quickstart](../quickstart/) — your first noggin in five minutes.
- [CLI reference](../cli/) — every verb, every flag.
- [Verb demo](../demo/) — real CLI runs, human vs JSON.
