---
title: Component reference
slug: "ui/components/"
---

# Component reference

Every component below accepts a `classNames` prop — a per-slot map
of extra class names that are merged onto the built-in ones. Use it
for one-off host tweaks. For global re-skinning, use
[design tokens](../theming/) instead.

## `NogginTree`

Drag-and-drop tree backed by
[react-arborist](https://github.com/brimdata/react-arborist).
Renders the noggin's items as a virtualized tree with keyboard
navigation, multi-select, drag reordering, and inline rename.

```tsx
import { NogginTree } from '@noggin/ui';

<NogginTree
  items={nodes}
  activePath={activePath}
  selectedPath={selectedPath}
  onSelect={(path) => host.select(path)}
  onMove={(intent) => noggin.move(intent.path, intent.to)}
  onToggleDone={(path, done) => noggin.edit(path, { done })}
  onRetitle={(path, title) => noggin.edit(path, { title })}
  onRequestContextMenu={(x, y, path) => host.openMenu(x, y, path)}
/>
```

### Slots

| Slot | Element |
| --- | --- |
| `root` | Outer wrapper `<div>`. |
| `row` | Each tree row. |
| `rowSelected` | Extra class when row is selected. |
| `rowActive` | Extra class when row is the engine-active item. |
| `rowDone` | Extra class when row is done. |
| `title` | The title `<span>` inside the row. |
| `path` | The dotted-path `<span>` (e.g. `/1/2`). |

```tsx
<NogginTree
  items={nodes}
  classNames={{
    rowSelected: 'my-row--highlighted',
    rowActive:   'my-row--active-pulse',
  }}
  /* ...handlers... */
/>
```

### Gotchas

- Tree gestures (Alt+arrows to move, Enter to add sibling,
  Ctrl+Enter to add child, etc.) live in
  [`@noggin/ui/gestures`](https://github.com/dornstein/noggin/blob/main/ui/src/gestures.ts).
  The tree fires them as `onGesture`; the host runs them against
  the engine.
- Inline rename uses a controlled input that intercepts most
  keystrokes. The exported `shouldInterceptFromRename(key)` helper
  tells parent components whether a keystroke should be ignored
  while a row is being renamed.
- Drag and drop is **internal-only** by default. Hosts that want
  to accept drops from outside the tree must wire up their own
  `react-dnd` providers.

## `NogginDetails`

Right-hand pane that shows the selected item's title, dotted path,
metadata, notes (markdown-rendered), and an inline note editor.

```tsx
import { NogginDetails } from '@noggin/ui';

<NogginDetails
  item={selectedItem}
  onToggleDone={(path, done) => noggin.edit(path, { done: !done })}
  onGoto={(path) => noggin.goto(path)}
  onAppendNote={(path, md) => noggin.note(path, md)}
  onRetitle={(path, title) => noggin.edit(path, { title })}
  onOpenMenu={(x, y, path) => host.openMenu(x, y, path)}
  onCollapse={() => host.collapsePane()}
  collapseIcon="chevron-right"
/>
```

### Slots

| Slot | Element |
| --- | --- |
| `root` | Outer pane wrapper. |
| `header` | Row with state icon, title, and overflow buttons. |
| `title` | The `<h2>` title element. |
| `path` | The dotted-path caption (rendered twice — both share this slot). |
| `notes` | The notes `<ul>`. |
| `noteItem` | Each note `<li>`. |
| `addNote` | The collapsed "Add note" button. |

### Gotchas

- Pass `item={null}` for the empty state. The pane handles "nothing
  selected" itself.
- The pane is keyboard-aware: most tree gestures (Enter, Ctrl+Enter,
  Alt+arrows) work when focus is inside the pane but not in a text
  input or button. `Tab` / `Shift+Tab` are deliberately **not**
  intercepted — they cycle through the pane's own buttons.
- `collapseIcon` defaults to `'chevron-right'`. Hosts with a
  bottom-docked pane pass `'chevron-down'` instead.

## `NogginNoteEditor`

CodeMirror 6 markdown editor with a live preview pane. Used for
adding new notes from inside `NogginDetails`, but exported standalone
so hosts can reuse it elsewhere.

```tsx
import { NogginNoteEditor } from '@noggin/ui';

<NogginNoteEditor
  initialValue=""
  placeholder="Write a note in markdown…"
  onSubmit={(text) => noggin.note(activePath, text)}
  onCancel={() => host.collapseEditor()}
  submitLabel="Add note"
  showPreview={true}
/>
```

### Slots

| Slot | Element |
| --- | --- |
| `root` | Outer wrapper. |
| `textarea` | The CodeMirror host `<div>`. |
| `actions` | The footer row (hint + submit/cancel buttons). |

### Gotchas

- `initialValue` and `placeholder` are only honoured on mount.
  CodeMirror owns the document afterwards; re-rendering the
  component with a new `initialValue` will **not** swap the editor's
  contents.
- Ctrl/Cmd+Enter submits. Escape cancels (calls `onCancel`). The
  Submit button is disabled while the document is empty/whitespace.

## `NogginContextMenu`

Reusable popover menu primitive. Render at the React root and
control via the `open` prop (viewport coordinates, or `null` to
close).

```tsx
import { NogginContextMenu } from '@noggin/ui';

<NogginContextMenu
  open={menuPos}
  onClose={() => setMenuPos(null)}
  items={[
    { key: 'rename', label: 'Rename', icon: 'pencil',
      onClick: () => host.beginRename() },
    { separator: true },
    { key: 'delete', label: 'Delete', icon: 'trash',
      danger: true, shortcut: 'Del',
      onClick: () => noggin.delete(path) },
  ]}
/>
```

### Slots

| Slot | Element |
| --- | --- |
| `root` | The `<ul>` element. |
| `item` | Each menu `<li>`. |
| `itemDanger` | Extra class for items where `danger: true`. |
| `separator` | The separator `<li>` (`{ separator: true }` entries). |

### Gotchas

- The menu closes on outside click, Escape, or any item's `onClick`.
- Items can be `hidden: true` to omit them entirely, or
  `disabled: true` to grey them out while still showing.
- The menu clamps to the viewport — passing coordinates near a
  screen edge will shift it inward.

## Utilities

### `cn(...parts)`

The tiny class-name composer used internally. Accepts strings,
falsy values, and undefined; joins truthy strings with spaces.

```ts
import { cn } from '@noggin/ui';

cn('btn', isActive && 'btn--active', extraClass);
// → "btn btn--active foo" (when isActive && extraClass='foo')
```

Exported so consumers can use the same helper when composing their
own `classNames` slot values.

### `executeGesture(noggin, gesture, item)`

The engine-side dispatcher for tree gestures. Lives at
`@noggin/ui/gestures` (separate subpath to keep `node:crypto` out of
browser bundles that don't need it). Takes a `Noggin` handle, a
`TreeGesture` (the same union the tree fires), and the focused
item, and routes the gesture to the right verb.

### `RemoteNoggin`

The optimistic adapter at `@noggin/ui/remote`. Wraps a
`noggin-rpc` transport (Electron IPC, postMessage, fetch+SSE, …)
and exposes the same surface as a local `Noggin`. The components
don't know whether they're talking to an in-process engine or a
remote one. See the
[noggin-rpc protocol](../../noggin-rpc/) page for transport details.
