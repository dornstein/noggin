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
| [`cli/`](./cli/) | The bare CLI — `noggin.mjs`, `SKILL.md`, `README.md`. Source of truth for everything else. |
| [`plugin/`](./plugin/) | An [agent plugin](https://code.visualstudio.com/docs/agent-customization/agent-plugins) that wraps the skill for VS Code, GitHub Copilot CLI, and Claude Code. Install with `Chat: Install Plugin From Source`. |
| [`extension/`](./extension/) | A VS Code extension that ships the skill plus UI (status bar, tree view, language model tools). Install from the Marketplace. |

The CLI and skill are the source of truth. The plugin and extension
both reference the same `cli/` directory so the skill stays in sync
across all three distributions.

## Install

Pick the surface you want:

### VS Code extension (recommended for VS Code users)

See [`extension/`](./extension/) to build a `.vsix` locally:

```bash
cd extension
npm install
npm run package    # produces noggin-vscode-<version>.vsix
code --install-extension noggin-vscode-*.vsix
```

You get:
- The skill loaded into Copilot Chat automatically
- A sidebar tree of your noggin with drag-and-drop reordering (drop *on* or *between* items), inline state-toggle icon, and per-item path numbering
- A details pane with notes, inline title editing, and view-title action icons
- A status bar item showing the active item
- Language model tools (`#nogginPush`, `#nogginAdd`, `#nogginShow`, …) the agent can call directly
- Commands in the Command Palette

### Agent plugin (works in VS Code, Copilot CLI, and Claude Code)

See [`plugin/`](./plugin/). Install from source via the Command Palette:

```
> Chat: Install Plugin From Source
  https://github.com/dornstein/noggin.git
```

You get the skill and the CLI (no UI — install the extension for that).

### Bare CLI (everyone else)

Clone the repo and run [`cli/noggin.mjs`](./cli/noggin.mjs) directly:

```bash
git clone https://github.com/dornstein/noggin.git
cd noggin/cli
npm install
node noggin.mjs help
```

## Documentation

- [`cli/README.md`](./cli/README.md) — full user reference: mental model, path syntax, command reference, file schema, JSON output, invariants.
- [`cli/SKILL.md`](./cli/SKILL.md) — what the agent sees: when to use noggin, verb-selection table, behavioral protocol.
- [`docs/api-design.md`](./docs/api-design.md) — design history for the in-process API extraction (kept for reference).
- [`extension/README.md`](./extension/README.md) — build, configure, and use the VS Code extension.
- [`plugin/README.md`](./plugin/README.md) — install and use the agent plugin.
- [`CHANGELOG.md`](./CHANGELOG.md) — release notes.

## License

MIT. See [LICENSE](./LICENSE).
