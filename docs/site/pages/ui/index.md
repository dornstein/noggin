---
title: UI components overview
slug: "ui/"
---

# `@noggin/ui` — overview

`@noggin/ui` is the **shared React component library** that powers the
VS Code extension's webview, the Electron desktop renderer, and this
documentation site's playground. The same components render in every
host.

The library is deliberately small. Five top-level components plus a
few utilities are everything a host needs to put a noggin on the
screen:

| Component | What it is |
| --- | --- |
| `NogginTree` | The drag-and-drop tree view (react-arborist under the hood). |
| `NogginDetails` | The right-hand details pane showing notes + metadata. |
| `NogginNoteEditor` | A CodeMirror-backed markdown editor for adding/editing notes. |
| `NogginQuickAdd` | The footer input for quickly pushing/adding items. |
| `NogginContextMenu` | A reusable popover menu primitive. |

The shared components don't know about VS Code, Electron, or
`fetch` — they only know **React props and CSS**. Hosts wire them up
to the engine through `RemoteNoggin` (`@noggin/ui/remote`), an
optimistic adapter that turns gestures into RPC calls.

## Install

```bash
npm install @noggin/ui
```

`@noggin/ui` is published as an internal workspace package and is
consumed via npm workspaces; you don't normally install it directly
from a registry. If you're embedding it elsewhere, follow the pattern
the [extension](https://github.com/dornstein/noggin/tree/main/extension)
and [desktop renderer](https://github.com/dornstein/noggin/tree/main/desktop)
use.

## What you import

```ts
import {
  NogginTree,
  NogginDetails,
  NogginNoteEditor,
  NogginQuickAdd,
  NogginContextMenu,
} from '@noggin/ui';

// One stylesheet for the whole library.
import '@noggin/ui/styles.css';

// One theme. Pick one — see the theming page.
import '@noggin/ui/themes/light.css';   // or dark.css, vscode.css, auto.css
```

Subpath exports the library publishes:

| Subpath | Purpose |
| --- | --- |
| `@noggin/ui` | All React components + types. |
| `@noggin/ui/styles.css` | Component styles. **Required.** |
| `@noggin/ui/tokens.css` | Raw design-token CSS variables (light defaults). Imported automatically by `styles.css`. |
| `@noggin/ui/themes/light.css` | Explicit light theme. |
| `@noggin/ui/themes/dark.css` | Dark theme tuned for desktop hosts. |
| `@noggin/ui/themes/vscode.css` | Adapter that maps `--noggin-*` → `--vscode-*` workbench tokens. |
| `@noggin/ui/themes/auto.css` | `prefers-color-scheme` toggle (light defaults, dark below `(prefers-color-scheme: dark)`). |
| `@noggin/ui/contrast-check` | Dev-only WCAG checker (see theming page). |
| `@noggin/ui/remote` | `RemoteNoggin` — optimistic adapter that wraps a `noggin-rpc` transport. |
| `@noggin/ui/gestures` | `executeGesture(noggin, gesture, item)` — the engine-side gesture dispatcher. |

## Architecture in one paragraph

Everything visual lives behind **two layers of override**:

1. **Design tokens** in `tokens.css` — 27 `--noggin-*` CSS variables
   organised in pairs (every `*-bg` has a matching `*-fg`). Theme
   files (`themes/*.css`) just redefine these variables. Hosts swap
   themes by importing a different file.

2. **`classNames` slot props** on every component — hand a component
   a per-slot map of extra class names and they're merged into the
   built-in ones with a tiny `cn(...)` helper. Use this for one-off
   tweaks (a host-specific banner colour, animations, branding) that
   don't belong in a global theme.

Components never read host theming directly. They only read CSS
custom properties, which means **any host that sets the right CSS
variables can re-skin the entire library** without touching React
code.

## Where to go next

- [Theming](./theming/) — design tokens, the four built-in themes,
  how to write a new one, and the dev-time contrast checker.
- [Component reference](./components/) — props, slots, gotchas for
  each component, with live examples.
- [Playground](../playground/) — try the components in your browser
  with a temporary in-memory noggin.
