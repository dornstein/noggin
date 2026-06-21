# noggin plugin

This folder is noggin's plugin distribution. It carries two manifests
side-by-side so the same skill + CLI can be loaded by two different
plugin ecosystems:

- [`plugin.json`](./plugin.json) — VS Code [agent-plugin](https://code.visualstudio.com/docs/agent-customization/agent-plugins) format. Works in VS Code, GitHub Copilot CLI, and Claude Code.
- [`.codex-plugin/plugin.json`](./.codex-plugin/plugin.json) — [OpenAI Codex](https://developers.openai.com/codex/plugins) plugin format. Works in the Codex CLI and Codex app.

Both manifests point at the same [`skills/noggin/`](./skills/noggin/)
directory, so behaviour is identical across hosts.

If you want VS Code-specific UI (status bar, tree view, language model
tools), install the [VS Code extension](../extension/) instead.

## Install in VS Code, Copilot CLI, or Claude Code

In VS Code, open the Command Palette and run:

```
Chat: Install Plugin From Source
```

Then enter:

```
https://github.com/dornstein/noggin.git
```

VS Code will clone the repo and load the plugin from this directory.

## Install in OpenAI Codex

Add the repo as a Codex marketplace, then install the plugin from it:

```
codex plugin marketplace add dornstein/noggin
```

Codex resolves that to [`.agents/plugins/marketplace.json`](../.agents/plugins/marketplace.json)
at the repo root, which lists noggin. Open `/plugins` in the Codex CLI
or the Plugins view in the Codex app, pick the **Noggin** marketplace,
and install.

## What you get

- The `noggin` skill, automatically loaded into Copilot Chat when relevant.
- The full CLI under `skills/noggin/noggin.mjs`, runnable directly with Node.

The skill teaches the agent when and how to use noggin's `push`, `add`,
`goto`, `done`, `note`, `show`, `move`, and `set` commands. Full
human reference is in [`skills/noggin/README.md`](./skills/noggin/README.md).

## Structure

```
plugin/
├── plugin.json                 # VS Code agent-plugin manifest
├── .codex-plugin/
│   └── plugin.json             # OpenAI Codex plugin manifest
└── skills/
    └── noggin/                 # mirrors ../../cli/ — synced at build time
        ├── SKILL.md
        ├── README.md
        ├── noggin.mjs           # thin CLI wrapper
        ├── noggin-api.mjs       # typed in-process API the CLI uses
        ├── noggin-api.d.mts     # TypeScript declarations for the API
        └── package.json
```

The `skills/noggin/` directory is a synced copy of [`../cli/`](../cli/) —
the CLI directory is the source of truth. See [CONTRIBUTING.md](../CONTRIBUTING.md)
for how the sync works.
