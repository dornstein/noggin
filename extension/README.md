# Noggin (VS Code extension)

A working-memory tree for in-flight work — your second brain for the
stuff you can't fit in your head.

This extension ships the [`noggin` skill](./skills/noggin/SKILL.md) into
Copilot Chat via the `chatSkills` contribution, plus a full UI for
inspecting and editing your noggin from VS Code.

## What it ships

- **Skill** — loaded into Copilot Chat automatically. The agent knows
  when to push/add/note/etc. without further configuration.
- **Tree view** — a custom React-based tree in the Noggin activity-bar
  container. Shows every item with its full dotted path (e.g. `1.2.3.`),
  the active item highlighted, a click-to-toggle done icon per row,
  and drag-and-drop reordering that supports dropping *on* a parent
  (becomes child) or *between* siblings (with a labeled insertion line
  so you can see exactly where the drop will land).
- **Details pane** — webview below the tree showing the focused item:
  state-toggle icon, full dotted path, inline-editable title, notes
  (Markdown-rendered) with a quick-add affordance, and view-title
  icons for Add Child / Move Up / Move Down / Delete.
- **Status bar** — left-side item showing the active item's title and
  the open file's friendly label. Hover for the full path. Click to
  reveal the active item in the tree.
- **Commands** — full set under "Noggin: …" in the command palette
  (`Push…`, `Add…`, `Show Active`, `Go To`, `Mark Done`, `Pop`,
  `Add Note…`, `Retitle…`, `Open YAML`, `Refresh`, …).
- **Language model tools** — `noggin_show`, `noggin_push`, `noggin_add`,
  `noggin_goto`, `noggin_done`, `noggin_pop`, `noggin_set_state`,
  `noggin_note`, `noggin_retitle`, `noggin_move`, `noggin_delete`.
  Available to Copilot Chat as referenceable tools (`#nogginShow`, etc.)
  so the agent can drive noggin in-process without spawning the CLI.

The store path is tracked per workspace: use `Noggin: New…` or
`Noggin: Open File…` to pick one. `Noggin: Open Workspace Noggin`
opens `.noggin.yaml` in the current workspace root.

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
npm run build      # tsc (host) + esbuild (tree webview bundle)
npm run package    # syncs skills/, builds, runs vsce package → .vsix
```

`npm run watch` rebuilds the host on save; `npm run watch:webview`
watches and rebundles the React tree.

The `package` script runs `node ../scripts/sync-skill.mjs` first,
so the bundled `skills/noggin/` is always fresh.

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
| `noggin.statusBar.enabled` | `true` | Show the active item in the status bar. |

The noggin file path is per-workspace (tracked in workspace state),
set via `Noggin: New…`, `Noggin: Open File…`, or
`Noggin: Open Workspace Noggin`.

## License

MIT. See the [repo LICENSE](../LICENSE).
