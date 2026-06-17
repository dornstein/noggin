# noggin

A working-memory tree for in-flight work — your second brain for the
stuff you can't fit in your head.

Items form a tree. There is at most one **active** item; the path from
a root to the active item is your current spine. Other open items are
paused. Done items stay in the tree so you can see what got finished.

```
[1📍] ship v1 of noggin
  [1✅] build a demo script
  [2✅] create a documentation file
  [3] perform final testing
  [4] create a PR
  [5] complete the PR
```

## What's in this repo

| Folder | What it ships |
|---|---|
| [`cli/`](./cli/) | The bare CLI — `cli.mjs`, `SKILL.md`, `README.md`. Source of truth for everything else. |
| [`plugin/`](./plugin/) | An [agent plugin](https://code.visualstudio.com/docs/agent-customization/agent-plugins) that wraps the skill for VS Code, GitHub Copilot CLI, and Claude Code. Install with `Chat: Install Plugin From Source`. |
| [`extension/`](./extension/) | A VS Code extension that ships the skill plus UI (status bar, tree view, language model tools). Install from the Marketplace. |

The CLI and skill are the source of truth. The plugin and extension
both reference the same `cli/` directory so the skill stays in sync
across all three distributions.

## Install

Pick the surface you want:

### VS Code extension (recommended for VS Code users)

> Coming soon — see [`extension/`](./extension/).

Install from the Marketplace. You get:
- The skill loaded into Copilot Chat automatically
- A sidebar tree view of your noggin
- A status bar item showing the active item
- Language model tools (`noggin_push`, `noggin_add`, `noggin_show`, …)
- Commands in the Command Palette

### Agent plugin (works in VS Code, Copilot CLI, and Claude Code)

> Coming soon — see [`plugin/`](./plugin/).

Once published, install from the Command Palette:

```
> Chat: Install Plugin From Source
  https://github.com/dornstein/noggin.git
```

### Bare CLI (everyone else)

Clone the repo and run [`cli/cli.mjs`](./cli/cli.mjs) directly:

```bash
git clone https://github.com/dornstein/noggin.git
cd noggin/cli
npm install
node cli.mjs help
```

## Documentation

- [`cli/README.md`](./cli/README.md) — full user reference: mental model, path syntax, command reference, file schema, JSON output, invariants.
- [`cli/SKILL.md`](./cli/SKILL.md) — what the agent sees: when to use noggin, verb-selection table, behavioral protocol.

## License

MIT. See [LICENSE](./LICENSE).
