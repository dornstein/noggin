---
title: Quickstart — Desktop
slug: "quickstart/desktop/"
---

# Quickstart: Desktop

The standalone Windows app. No editor, no terminal — just the noggin
tree and details pane in their own window, built from the same
`@noggin/ui` components the VS Code extension uses, plus a sidebar
that can list more than one noggin at a time.

## 1. Install

1. Grab the latest installer from
   [GitHub Releases](https://github.com/dornstein/noggin/releases/latest)
   — the `noggin-<version>-win-x64.exe` asset.
2. Run it. It's an NSIS installer: pick per-user or per-machine, and
   optionally change the install directory. Desktop and Start Menu
   shortcuts are created for you.
3. Launch **noggin** from the Start Menu.

The app checks GitHub Releases on launch and installs newer versions
silently in the background — you generally never have to repeat this.

> **Windows only for now.** The app is cross-platform-capable Electron,
> but only the Windows installer is wired into the release pipeline
> today. It also isn't code-signed yet, so Windows SmartScreen will
> flag it as an "unknown publisher" on first run — that doesn't affect
> auto-updates, which verify each download's checksum independently.

## 2. Open or create a noggin

Use the hamburger menu at the top-left (or <kbd>Ctrl</kbd>+<kbd>N</kbd>
/ <kbd>Ctrl</kbd>+<kbd>O</kbd>) to create a new noggin or open an
existing `.noggin.yaml`. You can also just drag a `.noggin.yaml` file
onto the window.

Whatever you open lands in the **sidebar**, which lists every noggin
you've opened — not just the current one — so you can switch between,
say, a work noggin and a side-project noggin without hunting for
files. "Open Recent" in the hamburger menu gets you back to any of
them.

## 3. Add your first item

Click the **+** in the tree, type a title, hit Enter. That item
becomes active (marked with 📍).

## 4. Add children, drag to reorder

- Click an item, then **+** again (or right-click → **Add child**) —
  the new item becomes a child.
- Drag an item between two siblings to reorder, or onto another item
  to re-home it.
- Keyboard fans: <kbd>Enter</kbd> adds a sibling, <kbd>Ctrl</kbd>+<kbd>Enter</kbd>
  adds a child, <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd>
  demote/promote — all without touching the mouse.

## 5. Notes

Click an item to open the details pane (to the side or below the
tree, your choice). Type into **Add note** and submit; earlier notes
are append-only — a log, not a wiki.

## 6. Mark things done

Select an item and press <kbd>Space</kbd>, or use **Mark done** from
the right-click menu. Active moves to the parent — same "done, what's
next?" motion as everywhere else noggin runs.

## 7. Pair it with an agent

The desktop app has no chat built in, but it doesn't need one: point
Copilot Chat, Claude Code, Codex, or the CLI at the *same*
`.noggin.yaml` file (via the extension, the agent plugin, or
`noggin-mcp`) and the desktop window updates live — it watches the
file. Handy as a permanently-open "what am I doing" view while an
agent drives the changes.

## What you've learned

- The sidebar can hold more than one noggin — this is the environment
  built for juggling several at once.
- The tree and details pane behave exactly like the VS Code
  extension's, because they're the same components.
- It's as much a viewer as an editor: leave it open and watch changes
  land from an agent or the CLI in real time.

## Next

- [CLI reference](../../cli/) — every verb, every flag.
- [Verb demo](../../demo/) — the JSON shape of every verb response.
- [VS Code quickstart](../vscode/) — the other rich UI, if you split
  your time between an editor and a standalone window.
