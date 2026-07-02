---
title: NogginList — public component, list controller, provider registry
status: implemented
date: 2026-06-30
---

# NogginList — design doc

This plan adds three public exports to `@noggin/ui`:

- **`NogginList`** — the React component every host uses to render
  a multi-noggin browser (recents, bookmarks, "open this one"). The
  desktop sidebar is the first consumer; future surfaces
  (extension panel, mobile shell, web preview) reuse the same
  component.
- **`createNogginListStore`** — a JS factory that owns the list's
  entries, selection, and the lifecycle bridge between live
  `Noggin` instances and inert list rows.
- **`createNogginProviderRegistry`** — a separate, reusable
  registry of provider-type descriptors (label, badge, icon,
  pickers, read-only flag). NogginList consumes it; the
  Help → Installed Providers dialog and any future
  provider-aware UI can too.

The shape mirrors what we already do for the tree
(`NogginTree` + `createNogginActions`). Components stay pure
renderers; factories own coordination; pure helpers handle
projection. Persistence is host-owned.

## Why

The desktop's sidebar is the second place users navigate inside
noggin (the tree being the first). It's also the only surface that
shows multiple noggins at once: recents, the open noggin, type
badges, completion gauges, drag-reorder, filter/sort menus, an
MRU quick-switcher under the `+`, copy-to-clipboard chips for the
URI and the active item's key.

Today it's a desktop-private `Sidebar.tsx` plus a small forest of
hooks (`useRecents`, `useSidebarPrefs`). The VS Code extension has
no equivalent. A future mobile or web shell would re-invent the
same shape. The shape is generic; the implementation isn't.

This plan promotes the sidebar to public `@noggin/ui` surface and
factors the provider catalog out into its own registry so other
provider-aware UI (the existing Providers Info dialog, a future
"configure providers" page, an extension that contributes a new
storage type) can reuse it without dragging the list along.

## Goals

1. **One reusable component** every noggin surface can mount to
   get a consistent multi-noggin browser. Same visual story, same
   keyboard, drag, menu, gauge, copy affordances. No fork.
2. **Keyboard-first interaction from day one.** Arrow keys move
   selection; Enter activates; Delete removes; Esc clears
   selection. No retrofit later.
3. **Controller bridges live Noggins to inert entries** in one
   place with tests, so each host writes one effect and is done.
4. **Provider registry is its own thing.** Reusable across the
   list, the providers-info dialog, and any future
   provider-aware UI.
5. **Browser-pure.** `@noggin/ui` keeps its rule of not pulling
   `node:*` deps into the bundle graph. The component imports
   types from `@noggin/engine` but never instantiates a Noggin
   and never touches the file system.
6. **Honour the existing pattern.** Match
   `NogginTree` + `createNogginActions` shape — JS factory plus
   controlled component, no React-locked controllers, no new
   architectural primitives.

## Non-goals

- **No cross-process / cross-surface sync.** A shared list backend
  is a future feature that slots in as a host-supplied
  `onStateChange` adapter. We don't build the shared backend now.
- **No opening or disposing of Noggins.** Lifecycle stays with
  the host. The controller observes; it doesn't allocate.
- **No batch operations beyond multi-select selection.** The
  surface accommodates multi-select (`selectedIds` is an array)
  but v1 ships only single-select semantics and per-row mutators.
  Batch delete / batch close / batch export are later.
- **No tree state.** The list shows references *to* noggins; the
  state inside each noggin is `NogginTree`'s job.

## Architecture in one paragraph

`NogginList` is a controlled React component that takes a
`store`, a controlled `prefs` + `onPrefsChange`, and a
`providers` registry reader. It renders rows, a `+` add menu, a
kebab view menu, drag-reorder, keyboard nav, and copy chips —
everything visible. The store (built by `createNogginListStore`)
owns the *list* of entries plus selection, plus a small lifecycle
bridge: hosts call `store.observe(uri, noggin)` when a noggin
opens, and the store subscribes to `onDidChange`, projects item
counts + active key + active title into the matching entry, and
fires its own change event so the component re-renders. Prefs
live separately as plain controlled state (a `NogginListPrefs`
object + a host-supplied setter). Persistence is the host's
problem — the store fires `onStateChange` callbacks; hosts wire
them to whatever store they have. A pure helper
`applyListPrefs(entries, prefs, providers)` projects raw entries
into the filtered/sorted view the component renders, exported so
hosts and tests can validate the projection logic outside React.

## Public surface

Four files under `ui/src/`:

```
ui/src/
  NogginList.tsx                # the component
  nogginListStore.ts            # createNogginListStore + types
  nogginProviderRegistry.ts     # registry + types
  applyListPrefs.ts             # pure projection helper
```

Re-exported from `ui/src/index.ts` alongside `NogginTree` etc.
Filenames follow repo convention: components are `PascalCase.tsx`;
non-components are `camelCase.ts`.

### Provider registry — `nogginProviderRegistry.ts`

The registry stands alone because three pieces of UI already want
it (NogginList, the Providers Info dialog, the future
configure-providers page) and a fourth (extension-contributed
provider types) likely will too. Two interfaces — readers see a
narrow contract, hosts that allow runtime mutation see a wider
one.

```ts
export interface NogginProviderType {
  /** URI scheme the provider handles. `'file'`, `'https'`, etc. */
  readonly scheme: string;
  readonly label: string;
  readonly badgeLabel: string;
  readonly badgeTone: 'neutral' | 'accent' | 'muted' | 'warning';
  readonly icon: string;
  readonly pickers?: readonly NogginProviderPicker[];
  readonly readOnly?: boolean;
}

export interface NogginProviderPicker {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly hint?: string;
  readonly onSelect: () => void | Promise<void>;
}

/** Read-only view. NogginList and the Providers dialog take this. */
export interface NogginProviderTypeReader {
  readonly types: readonly NogginProviderType[];
  /** Resolve a provider by URI scheme. Returns null for unknown. */
  get(scheme: string): NogginProviderType | null;
  /** Resolve the provider for a full URI (extracts scheme first). */
  forUri(uri: string): NogginProviderType | null;
  onDidChange(cb: () => void): { dispose: () => void };
}

/** Mutable side. Hosts that allow runtime registration use this. */
export interface NogginProviderTypeRegistry extends NogginProviderTypeReader {
  register(type: NogginProviderType): { dispose: () => void };
}

/** Factory. Seed with the host's static catalog; further
 *  registrations are optional. */
export function createNogginProviderRegistry(
  seed?: readonly NogginProviderType[],
): NogginProviderTypeRegistry;

/**
 * Default catalog descriptors for the three providers bundled with
 * `@noggin/engine` (`file`, `https`, `memory`). Hosts call
 * `createNogginProviderRegistry(defaultNogginProviders)` to seed
 * the standard set. This is metadata only — labels, badges, icons
 * — not the engine providers themselves, so importing it does NOT
 * pull engine code into the UI bundle.
 */
export const defaultNogginProviders: readonly NogginProviderType[];
```

### List entries — `nogginListStore.ts`

A `NogginListEntry` is the inert row data. The URI is the
canonical identifier — its scheme determines the provider type,
so there is no separate `providerType` field. The active item's
**key** and **title** are cached (so closed noggins show a
meaningful "last active" hint); path is NOT cached (it's
derivable from key when the noggin is open, and is only visible
under prefs.showPath in that mode).

```ts
export interface NogginListEntry {
  /** Canonical URI. Stable across the entry's lifetime. The URI's
   *  scheme determines which provider applies. */
  readonly uri: string;
  /** Display name. Defaults to a tail-of-URI if absent. */
  readonly label?: string;
  /** Whether the underlying resource is reachable. Default true. */
  readonly exists?: boolean;
  /** Cached snapshot of the noggin's active item. `null` means
   *  "we know there's no active item." Absent means "we've never
   *  observed this noggin." */
  readonly activeKey?: string | null;
  readonly activeTitle?: string | null;
  /** Cached item counts for the gauge. Both `null` = unknown. */
  readonly itemsTotal?: number | null;
  readonly itemsDone?: number | null;
  /** ISO timestamp the entry was last interacted with. Used by
   *  Newest/Oldest sort and by the MRU submenu under `+`. */
  readonly lastOpenedAt?: string;
}
```

### Store — `nogginListStore.ts`

```ts
export interface NogginListStore {
  /** Raw entries in stored order. The component projects these
   *  through `applyListPrefs` for display; non-React callers can
   *  read this directly. */
  readonly entries: readonly NogginListEntry[];

  /** Currently-selected rows. `[]` = nothing selected. v1 ships
   *  single-select UX (max length 1); the array shape makes
   *  multi-select an additive future change. */
  readonly selectedIds: readonly string[];

  /** Fires after any state change. Hosts persist on this. */
  onDidChange(cb: () => void): { dispose: () => void };

  // ── Mutators ────────────────────────────────────────────────
  /** Add an entry. If `uri` already exists, only the supplied
   *  fields in `init` are merged in (no reorder). */
  add(uri: string, init?: Partial<NogginListEntry>): void;

  remove(uri: string): void;

  /** Move `uri` to immediately before `beforeUri`. Pass `null` to
   *  move to the end. No-op if `uri` is missing. */
  reorder(uri: string, beforeUri: string | null): void;

  setSelectedIds(ids: readonly string[]): void;

  // ── Lifecycle bridge ────────────────────────────────────────
  /**
   * Subscribe to a live Noggin and project its state into the
   * matching entry. Reads `noggin.items`, `noggin.active`, and
   * the active item's title; never mutates the noggin.
   *
   * If no entry exists for `uri`, one is added implicitly. Hosts
   * should still call `add()` first if they have a real label or
   * lastOpenedAt to set; the implicit-add path exists only to
   * remove the silent-no-op trap of the previous design.
   *
   * Calling `observe(uri, …)` twice for the same uri WITHOUT
   * disposing the first throws. Hosts that legitimately re-target
   * dispose the previous observation first.
   *
   * The returned `dispose()`:
   *   - unsubscribes from the noggin's onDidChange
   *   - clears the internal observation entry
   *   - removes `uri` from `selectedIds` if present
   */
  observe(uri: string, noggin: Noggin): { dispose: () => void };
}

export interface CreateNogginListStoreOptions {
  /** Initial state to seed the store with. Typically read from
   *  localStorage at construction time. */
  initialEntries?: readonly NogginListEntry[];

  /** Fires after every entries change. Not called for transient
   *  state (`selectedIds`, live observations). Hosts persist
   *  whatever they want from here. */
  onStateChange?: (state: {
    entries: readonly NogginListEntry[];
  }) => void;
}

export function createNogginListStore(
  opts?: CreateNogginListStoreOptions,
): NogginListStore;
```

There is no `useNogginListStore` hook. Hosts call the factory
inside `useMemo` exactly like they call `createNogginActions`.
The factory itself is React-free and testable from plain JS.

### Prefs — `nogginListStore.ts`

Prefs are decoupled from the store because they're a different
concern: "how I want to view the list" vs. "what's in the list."
Two NogginList instances with the same store can render with
different prefs (compact dropdown + expanded sidebar). Hosts
manage prefs as plain React state with their own persistence.

```ts
export interface NogginListPrefs {
  sortMode: 'manual' | 'newest' | 'oldest';
  /** `null` = show all installed types. Otherwise a subset of
   *  provider schemes. */
  typeFilter: readonly string[] | null;
  completionFilter: 'all' | 'complete' | 'incomplete';
  /** Show the active item's title (cached for closed noggins). */
  showTitle: boolean;
  /** Show the active item's key (cached for closed noggins). */
  showKey: boolean;
  /** Show the active item's path. Only renders when the noggin
   *  is open and observable (paths aren't cached for closed
   *  noggins; the value is positional and stale by definition). */
  showPath: boolean;
  showGauge: boolean;
  wrapTitles: boolean;
}

export const defaultNogginListPrefs: NogginListPrefs;
```

### Pure projection helper — `applyListPrefs.ts`

```ts
/**
 * Apply `prefs` to raw entries. Pure; no I/O, no React. Exported
 * so hosts and tests can validate filter/sort/gauge math without
 * rendering the component. The component calls this internally.
 */
export function applyListPrefs(
  entries: readonly NogginListEntry[],
  prefs: NogginListPrefs,
  providers: NogginProviderTypeReader,
): readonly NogginListEntry[];
```

### Component — `NogginList.tsx`

```ts
export interface NogginListProps {
  store: NogginListStore;

  /** Provider catalog. The component reads only — it never
   *  registers anything. */
  providers: NogginProviderTypeReader;

  /** Controlled prefs. Component never mutates these directly;
   *  toggles + radios fire `onPrefsChange` with the next value. */
  prefs: NogginListPrefs;
  onPrefsChange: (next: NogginListPrefs) => void;

  /** Fires when the user clicks (or Enter-activates) a row. The
   *  host should open the noggin and call
   *  `store.setSelectedIds([uri])` if it wants the row highlighted. */
  onActivate: (uri: string) => void;

  /** Wired into the kebab as "Close active noggin" — only shown
   *  when at least one row is selected AND this handler is
   *  present. Named "Entry" to disambiguate from closing the
   *  active *item* inside a noggin (a tree concern). */
  onCloseActiveEntry?: () => void;

  /** Optional extra entries appended to the menu's footer. Hosts
   *  surface app-level commands here (e.g., "Reveal in OS").
   *  Uses the same vocabulary as the tree. */
  extraMenuEntries?: readonly TreeContextMenuEntry[];

  classNames?: NogginListClassNames;
  /** Override the "no entries" copy. */
  emptyState?: ReactNode;
}

/**
 * Per-slot class-name overrides. Each slot listed here is
 * composed with the built-in class via space-separated
 * concatenation — the consumer's class wins on any conflicting
 * property. Slots not listed are not stable override points.
 * Mirrors the {@link NogginTreeClassNames} pattern.
 */
export interface NogginListClassNames {
  /** The outer `<aside>` wrapper. */
  root?: string;
  /** Every row, regardless of state. Composes with rowSelected /
   *  rowMissing when applicable. */
  row?: string;
  /** Added to a row in `selectedIds`. */
  rowSelected?: string;
  /** Added to a row whose entry has `exists === false`. */
  rowMissing?: string;
  /** The label text element. */
  label?: string;
  /** The provider-type badge. */
  badge?: string;
  /** The completion gauge wrapper. */
  gauge?: string;
  /** Each copy-to-clipboard button (URI / key / etc.). */
  copyButton?: string;
  /** The per-row remove (×) button. */
  removeButton?: string;
  /** The list's empty-state container. */
  emptyState?: string;
}

export function NogginList(props: NogginListProps): ReactElement;
```

That's the whole public surface. Ten exported names total
(component + types + factory + helper + registry +
`defaultNogginProviders`).

## UI affordances (the visual contract)

The public component locks the row layout below so every host
renders the same shape. Hosts customise tone via tokens and slot
classes only; they don't override the structure.

### Row shape

```
┌────────────────────────────────────────────────────────────┐
│ ●  Label text                  [BADGE]  ◐ 3h  📋 ×        │  ← row-row
│    /1/3                                            📋     │  ← active-path (prefs.showPath, open noggin only)
│    abc123                                          📋     │  ← active-key   (prefs.showKey)
│    do the budget review                                   │  ← active-title (prefs.showTitle)
└────────────────────────────────────────────────────────────┘
```

Top line, left-to-right:
1. Selection / exists dot (filled when `selectedIds` contains
   this URI; warning glyph when `exists === false`).
2. Label text. Defaults to the URI's filename tail if absent.
3. Provider badge (registry's `badgeLabel` + `badgeTone`).
4. Completion gauge (`prefs.showGauge`).
5. Relative time chip showing `lastOpenedAt`.
6. Hover-revealed copy chip — copies the URI.
7. Hover-revealed remove chip — fires `store.remove(uri)`.

Active-detail lines (each conditional on its `prefs.show*` flag):
- **Path** (`prefs.showPath`) — monospace, muted. Only rendered
  when the noggin is currently observed (the path is derived
  live from the open noggin; we don't cache it). With a copy
  chip on the right.
- **Key** (`prefs.showKey`) — monospace, muted. The cached
  `activeKey` (rendered for closed noggins too). With a copy
  chip on the right.
- **Title** (`prefs.showTitle`) — normal weight. The cached
  `activeTitle`. No copy chip.

`prefs.wrapTitles` switches all text from single-line ellipsis
to multi-line wrap.

### Hover-revealed affordances

The component is internally responsible for the copy chips and
the remove chip. Hosts do not wire them. Behaviour:

- **Copy chips.** Click writes the adjacent text to the
  clipboard via `navigator.clipboard.writeText()`. On success
  the chip flips to a checkmark glyph for ~900 ms then reverts.
  Failure (no clipboard API, permission denied, etc.) is
  silently absorbed; the chip simply doesn't flip. Hosts can
  hide the chip entirely via `classNames.copyButton`.
- **Remove chip.** Click calls `store.remove(uri)` directly. No
  host handler. Hosts that want confirmation wrap the store
  with their own `remove()`.

These chips are CSS-hidden by default, fade in on row hover,
and have a `:focus-visible` style so keyboard users can Tab
through them inside a selected row.

### Selection vs. "open"

`selectedIds` doubles as "the open noggin" for v1. Convention:
the host calls `store.setSelectedIds([uri])` when it opens a
noggin and `store.setSelectedIds([])` when it closes. The
`rowSelected` class therefore reads as both "you have this
selected" and "this is what the rest of the app is showing." If
a future feature wants click-to-preview without opening, it can
introduce a second highlight state then.

### Drag-reorder

- Owned by the component. The component listens for native HTML5
  drag events on rows and calls `store.reorder(uri, beforeUri)`
  on drop. No host handler.
- Enabled only when `prefs.sortMode === 'manual'`. In `newest`
  / `oldest` modes the rows render with `draggable=false` and a
  tooltip on the row hover area explains why ("Reordering only
  works in Manual sort mode").
- Visual: a 2px accent-coloured line above the row about to be
  inserted-before, and a `dragging` class on the row in flight
  (lower opacity).

### Empty state

The `<ul>` renders a single `emptyState`-class `<li>`:
- If `store.entries` is empty: render `props.emptyState` if
  provided, otherwise a default "No entries. Click + to add
  one." string.
- If `store.entries` is non-empty but `applyListPrefs` returns
  empty: render "No entries match the current filters. Adjust
  them from the ⋮ menu."

Keyboard nav with zero rendered rows is a no-op (Enter / Delete
have no target).

### MRU submenu under `+`

The `+` menu's first section (when at least one entry has a
`lastOpenedAt`) is a "Recent ▸" submenu showing up to 5 entries
sorted by `lastOpenedAt` descending. Edge cases:

- Fewer than 5 entries with `lastOpenedAt` → show however many
  there are.
- Zero entries with `lastOpenedAt` → hide the submenu and the
  preceding section header.
- The MRU reads from `store.entries` (not the projected list),
  so it's independent of the current filter and sort. The user
  can always reach a recent regardless of whether the main list
  is hiding it.

## How the controller actually works

### Internal state

```ts
interface StoreState {
  entries: NogginListEntry[];       // stored order
  selectedIds: readonly string[];
  observations: Map<string, {
    noggin: Noggin;
    sub: { dispose(): void };
  }>;
}
```

### The bridge

`observe(uri, noggin)`:

1. Upsert the entry. If absent, insert at the top with the URI
   only (label defaults to URI tail at render time).
2. Snapshot `noggin.items.length`, `noggin.items.filter(done).length`,
   `noggin.active?.key`, `noggin.active?.title` into the entry.
3. Subscribe to `noggin.onDidChange`. On each fire, re-snapshot.
4. Return `{ dispose }` that unsubscribes, clears the observation
   map entry, and removes `uri` from `selectedIds` if present.

Snapshots compare against the previous projection field by field.
If nothing material changed (counts equal, active key + title
equal), the store skips the change event so React doesn't
spuriously rerender.

### Filter, sort, projection

`applyListPrefs(entries, prefs, providers)` is the pure helper.
The component memoizes its result on `(entries, prefs, providers)`
and passes the projected list to the row renderer. The same
helper drives:

- The main rendered list.
- The MRU submenu under `+` (sorts a slice of `entries` by
  `lastOpenedAt`; takes 5; independent of `prefs.sortMode`).
- Tests (no component required).

#### Type-filter collapse semantics

`prefs.typeFilter` is either `null` ("show every provider") or
an explicit `readonly string[]` of allowed schemes. Both forms
are valid input to `applyListPrefs`; the helper treats a
fully-populated array (every registered scheme present) and
`null` identically.

The collapse to `null` is the **menu interaction layer's** job,
not the helper's. When the kebab menu's type-filter checkbox
row flips the last unchecked scheme back on, the component
emits `onPrefsChange({ ...prefs, typeFilter: null })` instead
of an array containing every scheme. This keeps the persisted
prefs tidy across catalog evolution: if a new provider type is
added later, hosts that previously "showed all" still see it,
because `null` means "all" forever rather than "these N
specific schemes I knew about at the time I unchecked."

### Keyboard navigation

`NogginList` ships keyboard nav in v1. The container has
`tabindex=0` and listens for:

| Key                 | Action                                                |
| ---                 | ---                                                   |
| ↑ / ↓               | Move single-row selection by 1 (wraps at boundaries). |
| Home / End          | Jump to first / last row.                             |
| Enter               | Fire `onActivate(selectedUri)`.                       |
| Delete / Backspace  | Call `store.remove(selectedUri)` (no host handler).   |
| Esc                 | Clear selection (`setSelectedIds([])`).               |

Space is **reserved** in v1 — unbound. It's the natural future
binding for "toggle the selected entry's active item done" once
we have a story for that, but we don't ship it now. Hosts that
want a different binding can hook their own `onKeyDown` on a
wrapper.

Drag-reorder is mouse-only in v1. Adding Alt+↑/↓ later is
additive.

Selection visuals match the row's hover styling so the focused
row reads consistently whether the user got there by click or
keyboard.

### Persistence

Hosts wire two lines:

```ts
const store = useMemo(() => createNogginListStore({
  initialEntries: loadEntries('noggin:list:v1'),
  onStateChange: ({ entries }) => saveEntries('noggin:list:v1', entries),
}), []);
```

`loadEntries` / `saveEntries` are host-owned helpers (typically
a `JSON.parse(localStorage.getItem(...))` pair). Prefs persist
separately on the host's existing settings channel — they're not
mixed into the entries write.

### Why this is the right shape (condensed rationale)

- **Factory + no hook**: matches `createNogginActions`; usable
  from non-React callers (tests, CLI, MCP); hosts wrap in
  `useMemo` when they want memoisation.
- **Callbacks not a pluggable persistence interface**: collapses
  the abstract `load()`/`save()` shape into two function options.
  Hosts control debounce, error handling, and where the bits
  actually live. The deferred cross-surface backend slots in as
  an `onStateChange` adapter, not a new interface.
- **Provider registry separated from list**: same descriptors
  drive multiple UIs (list rows, providers dialog, future
  configure page). Registry has a read-only base interface so
  consumers that don't mutate stay narrow.
- **Prefs decoupled from store**: different concerns. Two
  NogginList instances can share a store with different prefs.
  Hosts persist them on their own settings channel without
  bumping a list schema version on every show-toggle.
- **URI is the canonical identifier**: scheme tells you the
  provider type; no `providerType` field; one less source of
  drift.
- **`observe()` upserts + auto-clears selection**: removes the
  two biggest discoverability traps from the previous draft
  (silent no-op on order; forgot-setSelected in cleanup).
- **`selectedIds: readonly string[]` from day one**: future
  multi-select is additive, not a breaking change.

### Considered and rejected

- **Pluggable `NogginListPersistence` interface.** Adds an
  abstract object for what's two function refs. Replaced by
  `initialEntries` + `onStateChange`.
- **`useNogginListStore` hook export.** Diverges from
  `createNogginActions`. `useMemo(() => createNogginListStore(...))`
  is one extra line per host and matches every other factory.
- **Cached `activePath` on entries.** Stale by definition (paths
  shift under structural changes); the title carries the user's
  mental model better. `prefs.showPath` only renders when the
  noggin is open and a live path can be derived.
- **Hardcoding localStorage.** Tempting on simplicity grounds,
  but hosts need control over write timing (debounce, batch with
  other settings, cold-start race avoidance). Callbacks give
  them that.
- **Static `providerTypes` prop instead of a registry.** Works
  for v1 but blocks runtime registration if/when an extension
  contributes a new provider type. The registry's mutable side
  is opt-in; hosts that don't need it just call
  `createNogginProviderRegistry(PROVIDERS)` once at module
  scope.

## Host code: before / after

### Today's desktop sidebar wiring

- `useRecents(currentLocation)` manages list state, MRU, bumping.
- `useSidebarPrefs()` manages view prefs.
- A `useEffect` on `(noggin, activeKey, activePath, nodes)` calls
  `recents.setActive(...)` and `recents.setCompletion(...)`.
- `<Sidebar>` takes 12 props.

### With this plan

```tsx
// One-time at module scope (or memoized per-render).
const providers = useMemo(
  () => createNogginProviderRegistry(PROVIDERS),
  [],
);

// Store: persisted entries only.
const store = useMemo(() => createNogginListStore({
  initialEntries: loadEntries('noggin:list:v1'),
  onStateChange: ({ entries }) => saveEntries('noggin:list:v1', entries),
}), []);

// Prefs: ordinary React state, persisted on the host's existing
// settings channel. Merge with defaults on load so a prefs blob
// persisted before a newer key existed still parses.
const [prefs, setPrefs] = useState<NogginListPrefs>(
  () => ({ ...defaultNogginListPrefs, ...(loadPrefs('noggin:list-prefs:v1') ?? {}) }),
);
useEffect(() => { savePrefs('noggin:list-prefs:v1', prefs); }, [prefs]);

// The single coordination effect.
useEffect(() => {
  if (!noggin || !openState.location) return;
  store.add(openState.location, { lastOpenedAt: new Date().toISOString() });
  store.setSelectedIds([openState.location]);
  return store.observe(openState.location, noggin).dispose;
}, [noggin, openState.location, store]);

return (
  <NogginList
    store={store}
    providers={providers}
    prefs={prefs}
    onPrefsChange={setPrefs}
    onActivate={openNoggin}
    onCloseActiveEntry={doClose}
  />
);
```

One effect, ~14 lines total of host glue. The store's `observe()`
covers item count / active key / active title automatically; the
host just says "when a noggin opens, tell the store."

## Edge cases worth noting up front

- **`observe()` before `add()`.** Implicit upsert: the store
  inserts the URI with no label/lastOpenedAt. Hosts should still
  call `add()` first if they have those values, but the trap is
  closed.
- **Two observers for the same URI.** Throws. Hosts that
  legitimately re-target (hot reload, multi-window dev) dispose
  first.
- **Stale selection on entry removal.** Removing a URI that's in
  `selectedIds` drops it from the array. Disposing an observer
  whose URI is selected also drops it. No surprise selection.
- **Reorder to current position.** `reorder(uri, beforeUri)`
  where `beforeUri` resolves to `uri`'s current successor is a
  silent no-op. `onDidChange` does not fire. Same for
  `reorder(lastUri, null)` when the URI is already last.
- **All entries filtered out.** Component renders the
  "no entries match the current filters" empty state. Keyboard
  Enter / Delete with no selected row are no-ops.
- **Selection that no longer matches the filter.** A row in
  `selectedIds` that's been filtered out is still selected (the
  store doesn't know about prefs). When the filter is removed,
  the row reappears with its selection intact. Hosts that want
  to auto-clear stale selections wire it themselves via a
  `useEffect` watching `(prefs, selectedIds)`. The component
  itself does not auto-clear.
- **Unknown provider scheme.** If an entry's URI scheme isn't in
  the registry, the row still renders but with a fallback badge
  (`?` glyph + neutral tone). The Providers dialog shows the
  registered types; the user can add to the registry or remove
  the orphan entry.
- **Persistence write failures.** Hosts own `onStateChange`. If
  the host throws, the store re-throws on the *next* state
  change with the original error attached. The store itself
  always completes the in-memory mutation; the error reporting
  is opportunistic. Hosts that want silent failure wrap their
  save in `try/catch`.
- **Persistence schema migration.** Hosts merge loaded prefs
  with `defaultNogginListPrefs` so a stored prefs object from a
  prior version (missing a newer key like `wrapTitles`) still
  parses cleanly: `{ ...defaultNogginListPrefs, ...loaded }`.
  Same pattern for entries: an entry persisted before a new
  optional field existed just has that field undefined.
- **`navigator.clipboard` unavailable.** The copy chips silently
  no-op if the API isn't present (file://, sandboxed contexts).
  We don't surface this; the user clicks again or copies
  manually. A v2 host-supplied clipboard helper would let the
  desktop fall back to Electron's clipboard module.

## Migration

- **Phase 1:** Land
  `NogginList` + `createNogginListStore` + `createNogginProviderRegistry`
  + `applyListPrefs` in `@noggin/ui`. Don't touch the desktop yet.
- **Phase 2:** Rewrite `desktop/src/renderer/src/Sidebar.tsx` to
  wrap `<NogginList>` with the host glue above. Delete
  `desktop/src/renderer/src/recents.ts`,
  `sidebar-prefs.ts`,
  `CompletionGauge.tsx`. The desktop's `providers.ts` constant
  becomes the seed for `createNogginProviderRegistry`. The
  Help → Installed Providers dialog flips to consume the same
  registry (it currently reads the constant directly — small
  refactor).
- **Phase 3:** Optional. The extension's webview adopts
  NogginList if/when it grows a multi-noggin pane.

## Tests

- `ui/src/__tests__/nogginListStore.test.ts` — pure-JS unit
  coverage. Drive add/remove/reorder/observe/setSelectedIds
  permutations against an in-memory noggin
  (`openMemoryNoggin()`). Asserts: snapshot equality, double-
  observe throws, dispose clears selection, change events fire
  only on material updates, reorder-to-current-position is a
  silent no-op.
- `ui/src/__tests__/applyListPrefs.test.ts` — pure-function
  coverage of the projection helper. Filter-by-type
  independence (the bug the original sidebar had), MRU sort,
  completion-filter semantics on unknown-count entries, the
  `typeFilter` `null` ≡ `[every-scheme]` equivalence.
- `ui/src/__tests__/nogginProviderRegistry.test.ts` — registry
  semantics: read-after-register, dispose unregisters,
  onDidChange fires, `forUri('https://x')` resolves via scheme.
- `ui/src/__tests__/ct/NogginList.*.ct.tsx` — Chromium CT
  against a real in-memory noggin. Coverage:
  - **Row rendering**: badge, gauge, copy chip, remove chip,
    active-detail lines under each `show*` pref.
  - **Keyboard nav**: ↑/↓ with wrap, Home/End, Enter activates,
    Delete removes, Esc clears.
  - **Type filter**: unchecking schemes hides matching rows;
    last-uncheck-flips-to-null collapse round-trips correctly.
  - **MRU submenu**: 0 / 1–4 / 5+ entries; renders independent
    of current filter.
  - **Drag-reorder**: enabled in manual mode, disabled in
    newest/oldest with a hover hint.
  - **Copy chips**: click writes to clipboard, glyph flips,
    reverts after ~900ms. Skipped gracefully when
    `navigator.clipboard` is unavailable.
  - **Live gauge**: completion percentage updates after the
    observed noggin's `onDidChange` fires.
  - **Empty state**: zero entries vs. all-filtered-out branches.
  - **Stale selection**: a row in `selectedIds` filtered out by
    a pref change still renders selected when the filter is
    relaxed (no auto-clear).

## Acceptance criteria

v1 is shippable when:

1. The four files (`NogginList.tsx`, `nogginListStore.ts`,
   `nogginProviderRegistry.ts`, `applyListPrefs.ts`) exist under
   `ui/src/` and are re-exported from `ui/src/index.ts`.
2. Every test file listed above is green.
3. The desktop renderer's `Sidebar.tsx` is rewritten to wrap
   `<NogginList>` with ~15 lines of host glue; the deleted
   files (`recents.ts`, `sidebar-prefs.ts`, `CompletionGauge.tsx`,
   `providers.ts`) are gone. The Help → Installed Providers
   dialog consumes the same registry.
4. The kebab menu's view toggles, filter, and sort all persist
   across app restarts.
5. `desktop/test/end-to-end.test.ts` continues to pass
   unchanged.
6. `cd ui && npm run typecheck && npm test` is green.
7. `cd desktop && npm run typecheck && npm test` is green.
8. A user can: add a noggin via `+`, drag-reorder it, filter by
   type via ⋮, copy its URI via hover, remove it via Delete,
   and observe its completion gauge update live as items in
   the open noggin are marked done.
9. The component imports only TYPES from `@noggin/engine`. No
   runtime engine import; `ui/`'s bundle graph is unchanged for
   browser consumers.
10. The plan's frontmatter status flips from `proposed` to
    `implemented` with commit hashes filled in.

## Open questions

1. **Per-row right-click menu.** Today none; only Delete-key
   removes and Enter / click activates. `extraMenuEntries`
   covers app-level actions. Per-row custom actions —
   `renderRowMenu` à la `NogginTree.renderContextMenu` — would be
   a future-add, not v1.
2. **Theming.** Inherit from `@noggin/ui/tokens.css` like every
   other component. No new tokens introduced; the badge tones
   and gauge colours all already exist.
3. **i18n.** Strings hard-coded for now. We don't have an i18n
   layer; adding one for this component would be the first.
