---
title: Component reference
slug: "ui/components/"
---

# Component reference

`@noggin/ui` ships a small React surface. Everything below is
exported from the package's default entry point
(`import { … } from '@noggin/ui'`) unless a section says otherwise.

**Components**

- [`NogginTree`](#noggintree) — drag-and-drop tree view.
- [`NogginDetails`](#noggindetails) — right-hand details pane.
- [`NogginList`](#nogginlist) — multi-noggin browser (sidebar of
  recents / open / bookmarked noggins).
- [`Icon`](#icon) — thin Codicon `<i>` wrapper.

**Verb dispatch**

- [`createNogginActions(noggin, opts?)`](#createnogginactionsnoggin-opts)
  — the `NogginActions` factory every component consumes.

**Controllers, stores, helpers**

- [`createNogginListStore`](#createnogginliststoreopts) — the
  `NogginList` controller.
- [`defaultNogginListPrefs`](#defaultnogginlistprefs) — starter
  preferences for `NogginList`.
- [`applyListPrefs`](#applylistprefsentries-prefs-providers-mru) /
  [`completionStatusOf`](#completionstatusofentry) — the pure
  projection helpers `NogginList` uses internally.
- [`createNogginProviderRegistry`](#createnogginproviderregistryseed)
  / [`defaultNogginProviders`](#defaultnogginproviders) — the
  provider-type catalog `NogginList` renders badges from.
- [`createMRUManager`](#createmrumanageropts) — URI → last-used
  timestamp registry (drives the "Recent ▸" submenu and time
  chips).
- [`buildTreeMenuEntries`](#buildtreemenuentries-actions-key-onrequestrename)
  — canonical right-click / kebab menu for a tree item.
- [`DropdownActionsMenu`](#dropdownactionsmenu) — the same popup
  chrome the built-in menus use, wrapped around any trigger.

**Tree helpers**

- [`projectTree`](#projecttreenoggin) — flat items → nested
  `NogginNode[]`.
- [`findByPath` / `siblingsOf` / `parentOf` / `prevSibling` / `nextSibling` /
  `firstSibling` / `lastSibling`](#tree-navigation-helpers) — pure
  path walkers over a `NogginNode[]`.

**Misc**

- [`renderMarkdown`](#rendermarkdownsource) — sanitised markdown →
  HTML string, matching the note viewer.
- [`uiErrorMessage`](#uierrormessageerr) — engine error → short
  user-facing string.
- [`gestureForKey` / `shouldInterceptFromRename`](#keyboard-helpers)
  — the tree's keymap surfaced for host reuse.
- [`cn(...parts)`](#cnparts) — internal class-name composer.

**Types**

- [Public type exports](#public-type-exports) — the interface /
  type aliases every component prop table above references.

`RemoteNoggin` (the optimistic client-side adapter) lives in
[`@noggin/rpc`](../../noggin-rpc/), not here — see
[Working with a remote noggin](#working-with-a-remote-noggin).

Both top-level components accept a `classNames` prop — a per-slot
map of extra class names that are merged onto the built-in ones.
Use it for one-off host tweaks; for global re-skinning, use
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

## `NogginList`

Sidebar list of noggins the user has opened, bookmarked, or wants
to keep at hand. Renders one row per URI with a provider-type
badge, a completion gauge, cached "last active" hints, per-row
copy-to-clipboard chips, and a per-row remove (×) button. The
header carries a `+` menu (with an optional "Recent ▸" submenu) and
a `⋮` kebab menu (show-toggles, sort, filter, close-active-entry,
plus any host-supplied extras).

`NogginList` is **fully controlled** through three collaborators
the host constructs and owns:

- a [`NogginListStore`](#createnogginliststoreopts) — the entries
  and selection controller;
- a [`NogginProviderTypeReader`](#createnogginproviderregistryseed)
  — the provider catalog (drives badges + the `+` menu);
- a `NogginListPrefs` value (with an `onPrefsChange` callback) —
  view preferences the host persists.

An optional [`MRUReader`](#createmrumanageropts) enables the
"Recent ▸" submenu, the per-row time chips, and the `'newest'` /
`'oldest'` sort modes.

```tsx
import {
  NogginList,
  createNogginListStore,
  createNogginProviderRegistry,
  defaultNogginProviders,
  defaultNogginListPrefs,
  createMRUManager,
} from '@noggin/ui';

const store = createNogginListStore({
  initialEntries: loadFromLocalStorage('noggin:list'),
  onStateChange: ({ entries }) => save('noggin:list', entries),
  onUriActivity: (uri) => mru.touch(uri),
});
const providers = createNogginProviderRegistry(defaultNogginProviders);
const mru = createMRUManager({
  initial: loadFromLocalStorage('noggin:mru') ?? {},
  onStateChange: ({ entries }) => save('noggin:mru', entries),
});
const [prefs, setPrefs] = useState(defaultNogginListPrefs);

<NogginList
  store={store}
  providers={providers}
  prefs={prefs}
  onPrefsChange={setPrefs}
  recent={mru}
  onActivate={(uri) => host.openNoggin(uri)}
  onCloseActiveEntry={() => host.closeActive()}
/>
```

Bridge a live noggin into the store so the row's cached counts
and active-item hint stay fresh:

```tsx
useEffect(() => {
  if (!noggin || !openedUri) return;
  store.add(openedUri);
  store.setSelectedIds([openedUri]);
  return store.observe(openedUri, noggin).dispose;
}, [noggin, openedUri, store]);
```

### Props

| Prop | Type | Required | What it does |
| --- | --- | --- | --- |
| `store` | `NogginListStore` | yes | Entries + selection controller. See `createNogginListStore`. |
| `providers` | `NogginProviderTypeReader` | yes | Catalog for badges + the `+` menu's picker list. |
| `prefs` | `NogginListPrefs` | yes | View preferences (sort, filters, column toggles). Controlled — the component never mutates. |
| `onPrefsChange` | `(next) => void` | yes | Fires with the next prefs when the kebab menu changes a toggle / radio. |
| `onActivate` | `(uri) => void` | yes | User clicked or Enter-activated a row. Host opens the noggin. |
| `onCloseActiveEntry` | `() => void` | no | When present *and* at least one row is selected, the kebab menu shows "Close active noggin". |
| `extraMenuEntries` | `readonly TreeContextMenuEntry[]` | no | Extra entries appended to the kebab menu's footer. Uses the same vocabulary as the tree menu. |
| `recent` | `MRUReader` | no | Enables the "Recent ▸" submenu, the per-row time chip, and `'newest'`/`'oldest'` sort. |
| `emptyState` | `ReactNode` | no | Override the default "no entries yet" copy. |
| `headerTitle` | `ReactNode` | no | Override the header title (default `'Noggins'`). |
| `classNames` | `NogginListClassNames` | no | Per-slot class-name overrides. |

### Slots

| Slot | Element |
| --- | --- |
| `root` | Outer `<aside>` wrapper. |
| `row` | Each row. |
| `rowSelected` | Extra class on rows in `store.selectedIds`. |
| `rowMissing` | Extra class on rows whose entry has `exists === false`. |
| `label` | The row's title element. |
| `badge` | Provider-type badge (right-aligned). |
| `gauge` | Completion-gauge wrapper. |
| `copyButton` | Each copy-to-clipboard chip. |
| `removeButton` | The per-row (×) button. |
| `emptyState` | The empty-state container. |

### Gotchas

- The component is **controlled** for prefs and selection. The
  store owns entries; the host owns prefs and hands them in.
- Drag-reorder is enabled when `prefs.sortMode === 'manual'`.
  Under `'newest'` / `'oldest'` the rows are sorted by the MRU and
  drag handles are disabled.
- `store.observe(uri, noggin)` and `onUriActivity` are two
  different channels: the observation bridge keeps counts + active
  hint fresh, while `onUriActivity` fires on every observed change
  so hosts can wire it to `mru.touch(uri)`. **Simply opening a
  noggin** does not fire `onUriActivity` — only subsequent change
  events do.
- Missing entries (`exists: false`) still render, greyed out, with
  the remove chip enabled so the user can clear them.

## `Icon`

Codicon `<i>` wrapper. Codicons are loaded once by `styles.css`;
this component just standardises the markup.

```tsx
import { Icon } from '@noggin/ui';

<Icon name="chevron-right" title="Collapse pane" />
```

| Prop | Type | Notes |
| --- | --- | --- |
| `name` | `string` | Codicon name (without the `codicon-` prefix). |
| `title` | `string` | Optional `title` attribute; when set, the icon is announced to screen readers (otherwise `aria-hidden`). |
| `className` | `string` | Merged onto `codicon codicon-<name>`. |
| `style` | `CSSProperties` | Passthrough. |

## Controllers & pure helpers

### `createNogginListStore(opts?)`

Build the [`NogginList`](#nogginlist) controller. Owns the raw
entries array, the selected-ids array, and an internal bridge
between live `Noggin` instances and cached row data.

```ts
import { createNogginListStore } from '@noggin/ui';

const store = createNogginListStore({
  initialEntries: [{ uri: 'file:///work/today.yaml' }],
  onStateChange: ({ entries }) => save('noggin:list', entries),
  onUriActivity: (uri) => mru.touch(uri),
});
```

Options:

| Option | Type | Purpose |
| --- | --- | --- |
| `initialEntries` | `readonly NogginListEntry[]` | Seed entries (e.g. persisted from localStorage). |
| `onStateChange` | `({ entries }) => void` | Fires after any change to `entries`. Not called for selection-only or observation-only shifts. Host persists here. |
| `onUriActivity` | `(uri, at) => void` | Fires whenever an observed noggin's `onDidChange` fires. Wire this to an MRU manager. Does **not** fire on the initial snapshot. |

Returned surface (`NogginListStore`):

| Member | Purpose |
| --- | --- |
| `entries` | Raw entries in stored order. |
| `selectedIds` | Currently-selected URIs (v1 UX is single-select). |
| `onDidChange(cb)` | Subscribe to any state shift. Returns `{ dispose }`. |
| `add(uri, init?)` | Insert or merge an entry. |
| `remove(uri)` | Remove; drops from selection if present. |
| `reorder(uri, beforeUri)` | Move `uri` before `beforeUri` (or to end when `beforeUri === null`). |
| `setSelectedIds(ids)` | Replace the selection. |
| `observe(uri, noggin)` | Bridge a live noggin into the entry (updates cached counts + active hint on every change). Returns `{ dispose }`. |

Persistence errors thrown by `onStateChange` are captured and
rethrown on the next mutation so hosts see them without losing the
in-memory change that triggered them.

### `defaultNogginListPrefs`

Starter `NogginListPrefs` value. Merge with loaded persisted
prefs (spread the default first so newly-added prefs pick up a
sensible fallback):

```ts
import { defaultNogginListPrefs } from '@noggin/ui';

const prefs = { ...defaultNogginListPrefs, ...(loadPrefs() ?? {}) };
```

Fields (see `NogginListPrefs` in the [types
reference](#public-type-exports)): `sortMode`, `typeFilter`,
`completionFilter`, `showTitle`, `showKey`, `showPath`,
`showType`, `wrapTitles`.

### `applyListPrefs(entries, prefs, providers, mru?)`

Pure projection: apply a `NogginListPrefs` to an array of
entries and return the filtered/sorted view. `NogginList` runs
this internally; exported so hosts and tests can reuse the same
logic outside React.

```ts
import { applyListPrefs } from '@noggin/ui';

const visible = applyListPrefs(store.entries, prefs, providers, mru);
```

Ordering:

1. Filter by `prefs.typeFilter` (URI scheme match; provider
   aliases honoured).
2. Filter by `prefs.completionFilter` (`'unknown'` counts as
   `'incomplete'`).
3. Sort by `prefs.sortMode`:
   - `'manual'` — preserve input order.
   - `'newest'` / `'oldest'` — sort by `mru.lastUsedAt(uri)`.
     Without an `mru`, falls back to manual order.

### `completionStatusOf(entry)`

Pure derivation of an entry's completion status from its cached
counts.

```ts
completionStatusOf({ itemsTotal: null }) // 'unknown'
completionStatusOf({ itemsTotal: 3, itemsDone: 3 }) // 'complete'
completionStatusOf({ itemsTotal: 3, itemsDone: 1 }) // 'incomplete'
completionStatusOf({ itemsTotal: 0 })   // 'incomplete' (empty ≠ done)
```

## Provider-type registry

The renderer-side catalog of noggin provider descriptors (label,
badge, icon, pickers, read-only flag). `NogginList` reads it for
row badges + the `+` menu. Also consumed by the desktop app's
Help → Installed Providers dialog.

The registry is a pure renderer-side concern — it holds no
engine references and is safe in any browser bundle.

### `createNogginProviderRegistry(seed?)`

Build a mutable registry. Pass the default catalog to seed, or
`undefined` for an empty registry.

```ts
import {
  createNogginProviderRegistry,
  defaultNogginProviders,
} from '@noggin/ui';

const providers = createNogginProviderRegistry(defaultNogginProviders);

// Register a picker with the file descriptor:
const fileType = providers.get('file');
// (in practice: extend the descriptor before registration, or
//  re-register with picker set — see NogginList docs)

const dispose = providers.register({
  scheme: 'redis',
  label: 'Redis',
  badgeTone: 'accent',
  icon: 'database',
});
// dispose.dispose() removes it later
```

Reader surface (`NogginProviderTypeReader`):

- `types` — snapshot in registration order.
- `get(scheme)` — resolve by scheme; honours aliases (e.g. `http`
  resolves to the `https` descriptor).
- `forUri(uri)` — extract the scheme (defaults to `'file'` for
  bare paths) and delegate to `get`.
- `onDidChange(cb)` — subscribe to catalog changes.

Mutable surface adds `register(type)` (throws on duplicate
scheme; returns `{ dispose }`).

### `defaultNogginProviders`

Metadata for the three providers bundled with `@noggin/engine`
(`file`, `https` + `http` alias, `memory`). Hosts wire pickers
on top by re-registering the descriptor after construction (or by
providing a pre-seeded catalog).

## `createMRUManager(opts?)`

Small, self-contained registry of URI → ISO-8601 UTC "last used"
timestamps with bounded retention and MRU-first enumeration.

```ts
import { createMRUManager } from '@noggin/ui';

const mru = createMRUManager({
  initial: JSON.parse(localStorage.getItem('noggin:mru') ?? '{}'),
  onStateChange: ({ entries }) =>
    localStorage.setItem('noggin:mru', JSON.stringify(entries)),
  maxEntries: 20,
});

mru.touch('file:///work/today.yaml');
mru.recent(5); // top 5 URIs, MRU-first
```

Options: `initial`, `onStateChange`, `maxEntries` (default `10`;
pass `Infinity` or `0` to disable eviction).

Reader surface (`MRUReader`): `lastUsedAt(uri)`, `entries()`,
`recent(limit?)`, `onDidChange(cb)`. Mutable surface adds
`touch(uri, at?)`, `forget(uri)`, `clear()`.

The MRU never subscribes to anything; hosts bridge activity into
it explicitly. The canonical wiring is from
`createNogginListStore({ onUriActivity })` (which fires on every
observed change of an open noggin) into `mru.touch(uri)`.

## Menus & popovers

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
// entries is a readonly array of TreeContextMenuEntry.
```

The builder reads `actions.noggin` for current sibling neighbours
and active state, so disabled flags ("Move up" on the first
sibling, "Promote" on a root, etc.) match the live tree. Returns
an empty array when `key` doesn't resolve.

### `DropdownActionsMenu`

Generic click-to-open dropdown wrapper using the same Radix
chrome the tree's kebab menu uses. Bring your own trigger (an
icon button in the sidebar, a header chip, etc.).

```tsx
import { DropdownActionsMenu } from '@noggin/ui';

<DropdownActionsMenu
  trigger={<button aria-label="More"><Icon name="kebab-vertical" /></button>}
  buildEntries={() => [
    { kind: 'item', key: 'export', label: 'Export…', onClick: doExport },
    { kind: 'separator', key: 's1' },
    { kind: 'item', key: 'settings', label: 'Settings', onClick: openSettings },
  ]}
/>
```

| Prop | Type | Notes |
| --- | --- | --- |
| `trigger` | `ReactNode` | A single focusable element (Radix `asChild`). |
| `buildEntries` | `() => readonly TreeContextMenuEntry[]` | Called on open — supports `item`, `checkbox`, `radio`, `header`, `separator`. |
| `align` | `'start' \| 'center' \| 'end'` | Radix alignment. Default `'end'` (right edge). |

## Tree helpers

Pure walkers over the `NogginNode[]` forest `NogginTree` renders.
Every helper is synchronous, O(depth) at worst, and does not
mutate its input.

### `projectTree(noggin)`

Projects a noggin's flat `items` accessor into the nested
`NogginNode` forest the tree renders.

```ts
import { projectTree } from '@noggin/ui';

const nodes = projectTree(noggin);   // NogginNode[]
```

Hosts typically subscribe to `noggin.onDidChange` and re-project
on every change. For very large noggins consider memoising or
applying incremental patches; the desktop renderer uses an
`applyChanges` helper to patch the projected forest instead of
rebuilding it.

### Tree navigation helpers

All take a `NogginNode[]` forest plus a slash-path (`/1/2/3`) and
return a `NogginNode` (or null).

| Helper | Purpose |
| --- | --- |
| `findByPath(nodes, path)` | Locate a node by its dotted path. |
| `siblingsOf(nodes, path)` | The sibling list containing `path` (including itself). |
| `parentOf(nodes, path)` | Parent node, or `null` for a root. |
| `prevSibling(nodes, path)` | Preceding sibling, or `null` at start. |
| `nextSibling(nodes, path)` | Following sibling, or `null` at end. |
| `firstSibling(nodes, path)` | First node in the containing sibling list. |
| `lastSibling(nodes, path)` | Last node in the containing sibling list. |

## Misc

### `renderMarkdown(source)`

Sanitised markdown → HTML string. Matches the flavour the
`NogginDetails` note viewer renders. Returns a plain string
suitable for `dangerouslySetInnerHTML` (safe because the
converter escapes/strips inline HTML).

```ts
import { renderMarkdown } from '@noggin/ui';

const html = renderMarkdown('**hello** _world_');
```

### `uiErrorMessage(err)`

Convert a `NogginError` (or the `error` field of a JSON envelope
— anything with `code`, `message`, and optional `data`) into a
short user-facing string keyed off the stable error `code`. Uses
UI vocabulary ("tree", "menu", "drag") rather than the CLI's
`--flag` vocabulary. Falls back to `err.message` for unknown
codes.

```ts
import { uiErrorMessage } from '@noggin/ui';

try {
  await actions.moveUp(key);
} catch (err) {
  toast.show(uiErrorMessage(err));
}
```

The CLI has its own catalog at
[`cli/error-messages.mjs`](https://github.com/dornstein/noggin/blob/main/cli/error-messages.mjs);
the MCP server has one too. Same underlying `code`, different
audience.

### Keyboard helpers

Two helpers surface the tree's keymap for hosts that need to
recognise or intercept the same gestures elsewhere.

```ts
import { gestureForKey, shouldInterceptFromRename } from '@noggin/ui';

// In a global keydown listener:
const gesture = gestureForKey(e); // TreeGesture | null
if (gesture === 'moveUp') { … }

// While an inline-rename input is focused:
if (shouldInterceptFromRename(gesture)) {
  // commit rename, then dispatch the gesture
}
```

- `gestureForKey(e)` → the tree's `TreeGesture` union (or
  `null`) for a `KeyboardEvent`. Full mapping is in
  [`ui/src/types.ts`](https://github.com/dornstein/noggin/blob/main/ui/src/types.ts).
- `shouldInterceptFromRename(gesture)` → `true` for the gestures
  the tree auto-commits rename for before dispatching (Enter,
  Alt+arrows, etc.).

### `cn(...parts)`

The tiny class-name composer used internally. Accepts strings,
falsy values, and undefined; joins truthy strings with spaces.

```ts
import { cn } from '@noggin/ui';

cn('btn', isActive && 'btn--active', extraClass);
// → "btn btn--active foo" (when isActive && extraClass='foo')
```

Exported so consumers can use the same helper when composing
their own `classNames` slot values.

## Public type exports

Every publicly-consumed type is exported from `@noggin/ui`.
Grouped by area:

**Components**

- `NogginTreeProps`, `NogginTreeHandlers`, `NogginTreeClassNames`
- `NogginDetailsProps`, `NogginDetailsHandlers`,
  `NogginDetailsClassNames`
- `NogginListProps`, `NogginListClassNames`

**Data**

- `NogginNode` — a tree node the components consume.
- `NogginNoteData` — a note (`{ timestamp, text }`).
- `NogginDetailsItem` — the item shape the details pane expects.
- `NogginMoveIntent` — payload of a drag-drop move.

**Actions**

- `NogginActions`, `NogginItemKey`, `CreateNogginActionsOptions`
- `RenameResult`, `ToggleDoneResult`, `DeleteResult`, `AddResult`,
  `MoveResult`, `ActivateResult`, `AppendNoteResult`

**Menus**

- `TreeContextMenuEntry` — one entry (item / checkbox / radio /
  header / separator).
- `TreeContextMenuRenderProps` — argument bag for a host's
  `renderContextMenu` override.
- `BuildTreeMenuEntriesOptions`

**NogginList controllers**

- `NogginListStore`, `NogginListEntry`, `NogginListPrefs`,
  `CreateNogginListStoreOptions`
- `NogginListCompletionStatus`
- `NogginProviderType`, `NogginProviderPicker`,
  `NogginProviderTypeReader`, `NogginProviderTypeRegistry`
- `MRUManager`, `MRUReader`, `CreateMRUManagerOptions`

**Errors**

- `RenderableError` — the shape `uiErrorMessage` accepts.

## Working with a remote noggin

The optimistic adapter at [`@noggin/rpc`](../../noggin-rpc/).
Wraps a `noggin-rpc` transport (Electron IPC, postMessage,
fetch+SSE, …) and exposes the engine's `Noggin` interface.

```ts
import { RpcClient } from '@noggin/rpc';
import { openRemoteNoggin } from '@noggin/rpc';
import { createNogginActions } from '@noggin/ui';

const client = new RpcClient(myTransport);
const noggin = await openRemoteNoggin({
  client,
  location: 'file:///work/today.yaml',
});
const actions = createNogginActions(noggin);
// Every component works exactly as it does with an in-process noggin.
```

The components don't know whether they're talking to an
in-process engine or a remote one; both satisfy `Noggin` and both
work as the input to `createNogginActions`.

