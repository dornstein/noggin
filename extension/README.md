# Noggin (VS Code extension)

A working-memory tree for in-flight work — your second brain for the
stuff you can't fit in your head.

This extension ships the [`noggin` skill](./skills/noggin/SKILL.md) into
Copilot Chat via the `chatSkills` contribution, plus a full UI for
inspecting and editing your noggin from VS Code.

## What it ships

- **Skill** — loaded into Copilot Chat automatically. The agent knows
  when to push/add/note/etc. without further configuration.
- **Tree view** — a "Noggin" view container in the Activity Bar shows
  your whole tree, with the active item highlighted (📍) and done
  items checked off. Inline actions for go-to, mark done/undone, add
  note, retitle, add child.
- **Status bar** — left-side item showing the active item's title.
  Click it to reveal the active item in the tree.
- **Commands** — full set under "Noggin: …" in the command palette
  (`Push…`, `Add…`, `Show Active`, `Go To`, `Mark Done`, `Pop`, `Add
  Note…`, `Retitle…`, `Open Storage File`, `Refresh`, …).
- **Language model tools** — `noggin_show`, `noggin_push`,
  `noggin_add`, `noggin_goto`, `noggin_done`, `noggin_pop`,
  `noggin_set_state`, `noggin_note`, `noggin_retitle`, `noggin_move`.
  Available to Copilot Chat as referenceable tools (`#nogginShow`,
  etc.) so the agent can drive noggin directly instead of shelling
  out to the CLI.

The store lives at `~/.noggin.yaml` by default. Override with the
`noggin.file` setting.

## How writes happen

The extension imports the bundled noggin API
(`skills/noggin/noggin-api.mjs`) directly and calls verb methods in
process — no child processes, no JSON round-trip. The same library
backs the bundled CLI (`skills/noggin/noggin.mjs`), so the extension,
the CLI, and any chat tools all share one code path. The tree view
reads from the API's in-memory snapshot, which is kept in sync with
the YAML file via a file watcher.

## Build

```powershell
cd extension
npm install
npm run compile        # tsc → out/
npm run package        # syncs cli/, compiles, runs vsce package → .vsix
```

The `package` script also runs `node ../scripts/sync-skill.mjs`
beforehand, so the bundled `skills/noggin/` is always fresh.

## How the skill is kept in sync

`skills/noggin/` is a synced copy of the canonical [`cli/`](../cli/)
directory in the repo root. After editing anything under `cli/`, run:

```powershell
node ../scripts/sync-skill.mjs
```

from the repo root to refresh both `extension/skills/noggin/` and
`plugin/skills/noggin/`.

## Configuration

| Setting | Default | Meaning |
|---|---|---|
| `noggin.file` | `""` | Override the store file path. Blank = `~/.noggin.yaml`. |
| `noggin.statusBar.enabled` | `true` | Show the active item in the status bar. |

## License

MIT. See the [repo LICENSE](../LICENSE).
