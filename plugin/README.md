# noggin agent plugin

This is the [agent plugin](https://code.visualstudio.com/docs/agent-customization/agent-plugins)
distribution of noggin. It works in VS Code, GitHub Copilot CLI, and
Claude Code.

If you want VS Code-specific UI (status bar, tree view, language model
tools), install the [VS Code extension](../extension/) instead.

## Install from source

In VS Code, open the Command Palette and run:

```
Chat: Install Plugin From Source
```

Then enter:

```
https://github.com/dornstein/noggin.git
```

VS Code will clone the repo and load the plugin from this directory.

## What you get

- The `noggin` skill, automatically loaded into Copilot Chat when relevant.
- The full CLI under `skills/noggin/noggin.mjs`, runnable directly with Node.

The skill teaches the agent when and how to use noggin's `push`, `add`,
`goto`, `done`, `note`, `show`, `move`, and `set-state` commands. Full
human reference is in [`skills/noggin/README.md`](./skills/noggin/README.md).

## Structure

```
plugin/
├── plugin.json              # plugin manifest
└── skills/
    └── noggin/              # mirrors ../../cli/ — synced at build time
        ├── SKILL.md
        ├── README.md
        ├── noggin.mjs
        └── package.json
```

The `skills/noggin/` directory is a synced copy of [`../cli/`](../cli/) —
the CLI directory is the source of truth. See the repo
[CONTRIBUTING](../README.md) for how the sync works.
