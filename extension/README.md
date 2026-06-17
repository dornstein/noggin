# Noggin (VS Code extension)

A working-memory tree for in-flight work — your second brain for the
stuff you can't fit in your head.

This extension ships the [`noggin` skill](./skills/noggin/SKILL.md) into
Copilot Chat via the `chatSkills` contribution point, so the agent
automatically knows when and how to use noggin.

## Status

**v0 skeleton.** The skill loads correctly. UI surfaces (status bar,
tree view, language model tools, command implementations) are
placeholders pending implementation.

## What it ships

- The `noggin` agent skill (loaded into Copilot Chat automatically).
- Stub commands in the Command Palette: `Noggin: Show`, `Noggin: Push…`, `Noggin: Add…`.
- A bundled copy of the CLI under `skills/noggin/cli.mjs`.

## Build

```powershell
cd extension
npm install
npm run compile
npm run package    # produces a .vsix
```

## How the skill is kept in sync

The `skills/noggin/` directory is a synced copy of the canonical
[`cli/`](../cli/) directory in the repo root. After editing anything
under `cli/`, run:

```powershell
node ../scripts/sync-skill.mjs
```

from the repo root to refresh `extension/skills/noggin/` and
`plugin/skills/noggin/`.

## License

MIT. See the [repo LICENSE](../LICENSE).
