---
title: Quickstart — VS Code
slug: "quickstart/vscode/"
---

# Quickstart: VS Code

The richest noggin experience. Sidebar tree, drag-and-drop reordering,
inline-editable notes, status-bar active-item indicator, and full
Copilot Chat integration with both the agent skill and the
language-model tools.

## 1. Install the extension

Open the Marketplace and install
[**Noggin**](https://marketplace.visualstudio.com/items?itemName=davidorn.noggin-vscode),
or run:

```
ext install davidorn.noggin-vscode
```

## 2. Open or create a noggin

Run **Noggin: New** from the Command Palette and pick a location.
Most people put `.noggin.yaml` at the root of the workspace they're
working in.

The **Noggin** view appears in the activity bar. If your workspace
already has a noggin, it opens automatically.

## 3. Add your first item

Click the **+** button in the Noggin view, type a title, hit Enter.
That item becomes active (marked with 📍).

The status bar shows the active item title. Click it for a quick
"jump to" picker.

## 4. Add children, drag to reorder

- Click an item, hit **+** again — the new item becomes a child.
- Drag an item between two siblings to reorder.
- Drag onto a parent to re-home it.

## 5. Notes

Click an item to open the details pane. Type into the **Add note**
box; press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (or <kbd>Cmd</kbd>+<kbd>Enter</kbd>)
to append. Earlier notes are append-only; you can't edit them in
place. (That's deliberate — they're a log, not a wiki.)

## 6. Mark things done

Right-click an item → **Mark done**, or with the item focused press
<kbd>D</kbd>. Active moves to the parent ("done, what's next?").

## 7. Use the agent

Open Copilot Chat in the same workspace and just say what you mean:

> "Push a side-quest to debug the cache, and remind me where I was"

The agent uses the noggin skill to pick the right verb
(`#nogginPush`), runs it, and shows you the result. See the
[agent quickstart](../agent/) for more examples.

## What you've learned

- The sidebar is the fastest way to add, reorder, and finish items.
- The details pane is where notes live.
- Copilot Chat can drive noggin for you in this same window.

## Next

- [CLI reference](../../cli/) — every verb, every flag (if you want
  to drop into a terminal sometimes).
- [Verb demo](../../demo/) — the JSON shape of every verb response.
- [Noggin schema](../../schema/) — what's actually in the file on disk.
