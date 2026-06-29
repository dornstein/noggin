---
title: Component reference
slug: "ui/components/"
---

# Component reference

`@noggin/ui` ships two top-level React components — `NogginTree` and
`NogginDetails` — plus a handful of supporting helpers. Both
components share a single `actions: NogginTreeActions` prop for every
mutation they initiate; build one with `createTreeActions(noggin)`
and pass it to both.

Every component accepts a `classNames` prop — a per-slot map of
extra class names that are merged onto the built-in ones. Use it for
one-off host tweaks. For global re-skinning, use
[design tokens](../theming/) instead.

## `createTreeActions(noggin, opts?)`

The verb-dispatch surface every UI component consumes. Returns a
`NogginTreeActions` — one method per logical user gesture
(`rename`, `toggleDone`, `delete`, `appendNote`, `activate`,
`move`, `runGesture`, `getMenuEntries`). Each method calls the
appropriate verb on the bound noggin.

```tsx
import { createTreeActions } from '@noggin/ui';

const actions = createTreeActions(noggin, {
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
const base = createTreeActions(noggin);
const actions = {
  ...base,
  delete: async (path, hasKids) => {
    if (hasKids && !(await confirm('Delete subtree?'))) return;
    await base.delete(path, hasKids);
  },
};
```

`noggin` is any object that satisfies the engine's `Noggin`
interface — an in-process noggin from `@noggin/engine`, or a
`RemoteNoggin` from `@noggin/rpc`. The components don't care which.

## `NogginTree`

Drag-and-drop tree backed by
[react-arborist](https://github.com/brimdata/react-arborist).
Renders the noggin's items as a virtualized tree with keyboard
navigation, drag reordering, inline rename, and a right-click
context menu (Radix-backed under the hood).

```tsx
import { NogginTree, createTreeActions, projectTree } from '@noggin/ui';

const actions = useMemo(() => createTreeActions(noggin), [noggin]);
const nodes = useMemo(() => projectTree(noggin), [noggin, tick]);

<NogginTree
  nodes={nodes}
  activeKey={noggin.active?.key ?? null}
  selectedPath={selectedPath}
  renamingPath={renamingPath}
  actions={actions}
  onSelect={setSelectedPath}
  onRequestRename={(path) => setRenamingPath(path)}
  onRenameCancel={() => setRenamingPath(null)}
  onAfterGesture={(path, gesture, result, ctx) => {
    // Drop newly-added rows into rename mode, refocus moved rows,
    // handle delete-fallback focus, etc.
    if (result.newKey) setPendingRenameKey(result.newKey);
    if (result.movedKey) setPendingFocusKey(result.movedKey);
  }}
/>
```

### Props

| Prop | Type | Required | What it does |
| --- | --- | --- | --- |
| `nodes` | `NogginNode[]` | yes | The projected forest. Use `projectTree(noggin)` to derive from a live noggin. |
| `activeKey` | `string \| null` | yes | Key of the engine's active item. |
| `actions` | `NogginTreeActions` | yes | Verb-dispatch surface. Build with `createTreeActions(noggin)`. |
| `onSelect` | `(path) => void` | yes | Host-owned selection state. Fires on click and keyboard navigation. |
| `selectedPath` | `string \| null` | no | Controlled selection. The host typically mirrors `onSelect` into this. |
| `renamingPath` | `string \| null` | no | Controlled inline-rename mode. Non-null switches the matching row into an input. |
| `onRequestRename` | `(path) => void` | no | Tree asks for rename mode (double-click, F2, "Rename" menu pick). Host sets `renamingPath`. |
| `onRenameCancel` | `() => void` | no | Rename was abandoned (Escape, blur on unchanged). Host clears `renamingPath`. |
| `onAfterGesture` | `(path, gesture, result, ctx) => void` | no | Fires after a keyboard gesture completes. Use for post-orchestration (focus, rename mode). |
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
  fire through `actions.runGesture` automatically — the tree owns
  the keyboard map. The exported `gestureForKey(e)` helper is
  available if you need to recognise the same gestures elsewhere.
- The `onAfterGesture` callback receives the gesture's outcome
  (`result.newKey`, `result.movedKey`) plus a pre-flight
  `TreeGestureContext` (`beforeNode`, `fallbackFocusKey`) captured
  before the verb fired. Use it for post-orchestration that needs
  to know what was there before.
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
| `actions` | `NogginTreeActions` | yes | Verb-dispatch surface. Same instance the tree consumes. |
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
  `actions.getMenuEntries(path)`, which resolves against the bound
  noggin's current state. Hosts don't supply menu items.

## Utilities

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

### `executeGesture(noggin, nodes, path, gesture)`

The lower-level dispatcher behind `actions.runGesture`. Lives at
`@noggin/ui/gestures` (separate subpath to keep `node:crypto` out
of browser bundles that don't drive verbs). Most consumers use
`createTreeActions(noggin)` instead — it wraps this for you and
projects `nodes` from the bound noggin's current items.

### `RemoteNoggin`

The optimistic adapter at [`@noggin/rpc`](../../noggin-rpc/). Wraps
a `noggin-rpc` transport (Electron IPC, postMessage, fetch+SSE, …)
and exposes the engine's `Noggin` interface. The components don't
know whether they're talking to an in-process engine or a remote
one; both satisfy `Noggin` and both work as the input to
`createTreeActions`.
