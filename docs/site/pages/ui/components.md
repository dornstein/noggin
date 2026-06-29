---
title: Component reference
slug: "ui/components/"
---

# Component reference

`@noggin/ui` ships two top-level React components — `NogginTree` and
`NogginDetails` — plus a handful of supporting helpers. Both
components share a single `actions: NogginActions` prop for every
mutation they initiate; build one with `createNogginActions(noggin)`
and pass it to both.

Every component accepts a `classNames` prop — a per-slot map of
extra class names that are merged onto the built-in ones. Use it for
one-off host tweaks. For global re-skinning, use
[design tokens](../theming/) instead.

## `createNogginActions(noggin, opts?)`

The verb-dispatch surface every UI component consumes. Returns a
`NogginActions` — one method per logical user intent. Components
and hosts invoke the same method regardless of how the user
expressed the intent (click, menu pick, keyboard shortcut,
drag-drop).

Methods (every one takes a `NogginItemKey` instead of a path so
intermediate re-numbering doesn't strand pending intents):

| Group | Method | Returns |
| --- | --- | --- |
| Item-local | `rename(key, title)` | `{ key, title }` |
| | `toggleDone(key, currentlyDone)` | `{ key, nowDone }` |
| | `delete(key, hasChildren)` | `{ deletedKey, fallbackFocusKey }` |
| | `appendNote(key, markdown)` | `{ key }` |
| | `activate(key)` | `{ key }` |
| Adds | `addSiblingAfter(key)` | `{ newKey }` |
| | `addSiblingBefore(key)` | `{ newKey }` |
| | `addChild(key)` | `{ newKey }` |
| | `addFirstSibling(key)` | `{ newKey }` |
| | `addLastSibling(key)` | `{ newKey }` |
| Moves | `moveUp(key)` | `{ movedKey }` |
| | `moveDown(key)` | `{ movedKey }` |
| | `moveToFirst(key)` | `{ movedKey }` |
| | `moveToLast(key)` | `{ movedKey }` |
| | `demote(key)` | `{ movedKey }` |
| | `promote(key)` | `{ movedKey }` |
| Explicit | `move(key, { kind, anchor })` | `{ movedKey }` |

Every method is `async` and resolves to its result envelope. A null
`newKey` / `movedKey` / `fallbackFocusKey` means the action was a
no-op against current state (e.g. `moveUp` on the first sibling).

```tsx
import { createNogginActions } from '@noggin/ui';

const actions = createNogginActions(noggin, {
  // Optional middleware: wraps every dispatch. Hosts use it for
  // toasts on error, busy indicators, etc.
  middleware: async (fn) => {
    try { return await fn(); }
    catch (err) { showToast(uiErrorMessage(err)); throw err; }
  },
});
```

Hosts that need pre-flight confirmation (e.g. "confirm before
delete") decorate the returned object:

```ts
const base = createNogginActions(noggin);
const actions: NogginActions = {
  ...base,
  delete: async (key, hasKids) => {
    if (hasKids && !(await confirm('Delete subtree?'))) {
      return { deletedKey: key, fallbackFocusKey: null };
    }
    return base.delete(key, hasKids);
  },
};
```

`noggin` is any object that satisfies the engine's `Noggin`
interface — an in-process noggin from `@noggin/engine`, or a
`RemoteNoggin` from `@noggin/rpc`. The components don't care which.
The returned actions object exposes the bound noggin as a read-only
`noggin` field, which `buildTreeMenuEntries` and the components
read for current sibling / active state.

## `NogginTree`

Drag-and-drop tree backed by a virtualized list with keyboard
navigation, drag reordering, inline rename, and a right-click
context menu.

```tsx
import { NogginTree, createNogginActions, projectTree } from '@noggin/ui';

const actions = useMemo(() => createNogginActions(noggin), [noggin]);
const nodes = useMemo(() => projectTree(noggin), [noggin, tick]);

<NogginTree
  nodes={nodes}
  activeKey={noggin.active?.key ?? null}
  selectedPath={selectedPath}
  renamingPath={renamingPath}
  actions={actions}
  onSelect={setSelectedPath}
  onRequestRename={(path, opts) => {
    setRenamingPath(path);
    // opts.isNew is true when the tree is following up after an
    // add — wire a "cancel deletes the empty row" fallback if you
    // want one.
    setRenamingIsNew(opts?.isNew === true);
  }}
  onRenameCancel={() => setRenamingPath(null)}
/>
```

The tree drives default post-action UI orchestration internally:

- `addX` actions follow up with `onRequestRename(newPath, { isNew: true })`
  so the new row enters rename mode automatically.
- `moveX` actions follow up with `onSelect(newPath)` so selection
  follows the moved row.
- `delete` follows up with `onSelect(fallbackPath)` against the
  next-sibling-then-previous-then-parent fallback.

Hosts that need different orchestration wrap the actions object
before handing it to the tree.

### Props

| Prop | Type | Required | What it does |
| --- | --- | --- | --- |
| `nodes` | `NogginNode[]` | yes | The projected forest. Use `projectTree(noggin)` to derive from a live noggin. |
| `activeKey` | `string \| null` | yes | Key of the engine's active item. |
| `actions` | `NogginActions` | yes | Verb-dispatch surface. Build with `createNogginActions(noggin)`. |
| `onSelect` | `(path) => void` | yes | Host-owned selection state. Fires on click and keyboard navigation; also fired by the tree's default post-action orchestration. |
| `selectedPath` | `string \| null` | no | Controlled selection. The host typically mirrors `onSelect` into this. |
| `renamingPath` | `string \| null` | no | Controlled inline-rename mode. Non-null switches the matching row into an input. |
| `onRequestRename` | `(path, opts?) => void` | no | Tree asks for rename mode (F2, double-click, "Rename" menu pick, or its own post-add follow-up). The second arg is `{ isNew: true }` only for the post-add case; user-driven calls omit it. |
| `onRenameCancel` | `() => void` | no | Rename was abandoned (Escape, blur on unchanged). Host clears `renamingPath`. |
| `fileId` | `string \| null` | no | Stable id for the open noggin; tree state resets when it changes. |
| `rowHeight` | `number` | no | Default `22`. |
| `indent` | `number` | no | Indent per level. Default `14`. |
| `width` / `height` | `number` | no | Explicit virtualizer size. Defaults to filling parent. |
| `classNames` | `NogginTreeClassNames` | no | Per-slot class overrides. See below. |
| `renderContextMenu` | `(props) => ReactNode` | no | Swap the popup chrome (e.g. native VS Code menu). Tree still owns the entries. |

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
  /* ... */
  classNames={{
    rowSelected: 'my-row--highlighted',
    rowActive:   'my-row--active-pulse',
  }}
/>
```

### Gotchas

- Tree gestures (Alt+arrows to move, Enter to add sibling,
  Ctrl+Enter to add child, Tab/Shift+Tab to demote/promote, etc.)
  route to the matching `actions.X(key)` method automatically — the
  tree owns the keyboard map. The exported `gestureForKey(e)`
  helper is available if you need to recognise the same gestures
  elsewhere.
- The tree consumes each action's result envelope itself to drive
  `onRequestRename` (new rows) and `onSelect` (moved / fallback
  rows). Hosts that want to suppress this wrap the actions surface
  before passing it in.
- Inline rename uses a controlled input that intercepts most
  keystrokes. The exported `shouldInterceptFromRename(gesture)`
  helper indicates which keys auto-commit-then-dispatch during
  rename.
- Drag and drop is **internal-only** by default. Hosts that want
  to accept drops from outside the tree must wire up their own
  `react-dnd` providers.

## `NogginDetails`

Right-hand pane that shows the selected item's title, dotted path,
metadata, notes (markdown-rendered), and an inline note editor.
Includes a kebab "actions" button that opens the same canonical
context menu the tree's right-click produces.

```tsx
import { NogginDetails } from '@noggin/ui';

<NogginDetails
  item={detailsItem}
  actions={actions}
  onCollapse={() => host.collapsePane()}
  collapseIcon="chevron-right"
/>
```

### Props

| Prop | Type | Required | What it does |
| --- | --- | --- | --- |
| `item` | `NogginDetailsItem \| null` | yes | The item to display. `null` shows the empty state. |
| `actions` | `NogginActions` | yes | Verb-dispatch surface. Same instance the tree consumes. |
| `onCollapse` | `() => void` | no | Host should collapse the pane. When omitted, the chevron button is hidden. |
| `collapseIcon` | `string` | no | Codicon name for the collapse chevron. Default `'chevron-right'`. |
| `renderContextMenu` | `(props) => ReactNode` | no | Swap the kebab-menu popup chrome. |
| `classNames` | `NogginDetailsClassNames` | no | Per-slot class overrides. |

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
  Alt+arrows, Space to toggle done, Delete) work when focus is
  inside the pane but not in a text input or button. `Tab` /
  `Shift+Tab` are deliberately **not** intercepted — they cycle
  through the pane's own buttons.
- `collapseIcon` defaults to `'chevron-right'`. Hosts with a
  bottom-docked pane pass `'chevron-down'` instead.
- The kebab menu's entries (and their disabled flags) come from
  `buildTreeMenuEntries({ actions, key: item.key, ... })`, which
  resolves against the bound noggin's current state. Hosts don't
  supply menu items.

## Utilities

### `buildTreeMenuEntries({ actions, key, onRequestRename? })`

The canonical right-click / kebab menu builder. Both `NogginTree`
and `NogginDetails` call this for their built-in menus; it's also
exported publicly so hosts that render the menu in a native popup
(e.g. VS Code's `showQuickPick`) get exactly the same entries the
components would have shown.

```ts
import { buildTreeMenuEntries } from '@noggin/ui';

const entries = buildTreeMenuEntries({
  actions,
  key: someItemKey,
  onRequestRename: (key) => host.openInlineRename(key),
});
// entries is a readonly array of { kind: 'item', label, icon,
// shortcut, disabled, danger, onClick } or { kind: 'separator' }.
```

The builder reads `actions.noggin` for current sibling neighbours
and active state, so disabled flags ("Move up" on the first
sibling, "Promote" on a root, etc.) match the live tree. Returns
an empty array when `key` doesn't resolve.

### `projectTree(noggin)`

Projects a noggin's flat `items` accessor into the nested
`NogginNode` forest the tree renders. Pure; O(N).

```ts
import { projectTree } from '@noggin/ui';

const nodes = projectTree(noggin);   // NogginNode[]
```

Hosts typically subscribe to `noggin.onDidChange` and re-project on
every change. For very large nogins consider memoising or applying
incremental patches; the desktop renderer uses an `applyChanges`
helper to patch the projected forest instead of rebuilding it.

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

### `RemoteNoggin`

The optimistic adapter at [`@noggin/rpc`](../../noggin-rpc/). Wraps
a `noggin-rpc` transport (Electron IPC, postMessage, fetch+SSE, …)
and exposes the engine's `Noggin` interface. The components don't
know whether they're talking to an in-process engine or a remote
one; both satisfy `Noggin` and both work as the input to
`createNogginActions`.
