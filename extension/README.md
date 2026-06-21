# Noggin

A working-memory tree for in-flight work — your second brain for the
stuff you can't fit in your head.

Push when you side-quest. Add when you want to remember something
without diving in. Pop when you're done. The active spine is always
in front of you.

**See it in action:** [live CLI demo](https://dornstein.github.io/noggin/) — every verb side-by-side, human vs JSON output.

```
[1📍] ship v1 of noggin
  [1✅] build a demo script
  [2✅] create a documentation file
  [3] perform final testing
  [4] create a PR
  [5] complete the PR
```

## What you get

- **Sidebar tree** — every item with its full dotted path
  (e.g. `1.2.3.`), the active item highlighted, a click-to-toggle
  done icon per row, and drag-and-drop reordering that supports
  dropping *on* a parent (becomes child) or *between* siblings (with
  a labeled insertion line so you can see exactly where the drop
  will land).
- **Details pane** — focused item with state-toggle icon, full
  dotted path, inline-editable title, notes (Markdown-rendered)
  with a quick-add affordance, and view-title icons for Add Child /
  Move Up / Move Down / Delete.
- **Status bar item** — left side, showing the active item's title
  and the open file's friendly label. Hover for the full path. Click
  to reveal the active item in the tree.
- **Commands** — full set under `Noggin: …` in the Command Palette
  (`Push…`, `Add…`, `Show Active`, `Go To`, `Mark Done`, `Pop`,
  `Add Note…`, `Retitle…`, `Open YAML`, `Refresh`, …).
- **Copilot Chat skill** — loaded automatically. The agent knows
  when to push / add / note / etc. without configuration. The agent
  can drive noggin in-process via the `#nogginPush`, `#nogginAdd`,
  `#nogginShow` … language model tools, so it never has to spawn a
  CLI.

## Getting started

1. Install the extension from the Marketplace.
2. Open the **Noggin** activity-bar container in the sidebar.
3. Run `Noggin: New…` to create a noggin file, or
   `Noggin: Open Workspace Noggin` to use a `.noggin.yaml` at your
   workspace root.
4. Push an item: click `Push…` in the tree's view-title, or run the
   command from the palette.

The noggin file is a small human-readable YAML file. Open it
anytime via `Noggin: Open YAML` to inspect or edit by hand.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `noggin.statusBar.enabled` | `true` | Show the active item in the status bar. |

The noggin file path is tracked per-workspace (in workspace state),
set via `Noggin: New…`, `Noggin: Open File…`, or
`Noggin: Open Workspace Noggin`.

## Learn more

- [Full user reference](https://github.com/dornstein/noggin/blob/main/cli/README.md) —
  mental model, path syntax, command reference, file schema.
- [What the agent sees](https://github.com/dornstein/noggin/blob/main/cli/SKILL.md) —
  the skill behavioural protocol.
- [Repo on GitHub](https://github.com/dornstein/noggin) —
  source, issues, contributions.

## License

MIT.
