---
title: Theming
slug: "ui/theming/"
---

# Theming `@noggin/ui`

Every color in `@noggin/ui` flows through one of 27 CSS custom
properties. Hosts re-skin the entire library by overriding those
properties — no React code changes, no component re-builds.

## How it works

`@noggin/ui/styles.css` references **only tokens**. The tokens
themselves are defined in `@noggin/ui/tokens.css`, which `styles.css`
imports automatically. The tokens ship with **light-theme defaults
baked in**, so importing only `styles.css` already gives you a usable
component.

A theme is just a stylesheet that overrides the same tokens. The
library ships four:

| Import | When to use |
| --- | --- |
| `@noggin/ui/themes/light.css` | Force the light theme, regardless of OS preference. |
| `@noggin/ui/themes/dark.css` | Force the dark theme. Tuned for desktop hosts (VS Code Dark+ palette). |
| `@noggin/ui/themes/vscode.css` | Adapter — maps every `--noggin-*` token to a `--vscode-*` workbench token so the components blend into the user's VS Code theme. |
| `@noggin/ui/themes/auto.css` | `prefers-color-scheme: dark` toggle (light defaults, dark when the OS prefers dark). |

```ts
// Pick exactly one:
import '@noggin/ui/themes/light.css';
import '@noggin/ui/themes/dark.css';
import '@noggin/ui/themes/vscode.css';
import '@noggin/ui/themes/auto.css';
```

## The paired-token contract

Tokens are organised into **pairs**. Every background that carries
text has a matching foreground guaranteed to clear WCAG AA contrast.
This is enforced as a library-wide rule:

> A CSS rule that sets `background-color` MUST also set `color` to
> the matching pair. A host that overrides one half but not the
> other gets an obviously-broken row instead of a subtle
> gray-on-gray contrast bug.

If you write a theme that overrides, say, `--noggin-row-selected-bg`
without also overriding `--noggin-row-selected-fg`, your selected
rows may become unreadable. The dev-time contrast checker (below)
will flag this in the browser console.

## Token tiers

Tokens fall into five tiers:

### Tier 1 — Surface (canvas)

The page itself.

| Token | Role |
| --- | --- |
| `--noggin-canvas-bg` | Main background. |
| `--noggin-canvas-fg` | Default text on canvas. |
| `--noggin-canvas-fg-strong` | Headings / emphasized text. |
| `--noggin-canvas-fg-muted` | Captions, paths, hints. |
| `--noggin-canvas-fg-disabled` | Inert text. |

### Tier 2 — Row interactive states

Tree rows, list rows. Foregrounds are paired with their own
background — a hovered row gets `row-hover-fg`, not `canvas-fg`.

| Token pair | Role |
| --- | --- |
| `--noggin-row-hover-bg` / `-fg` | Pointer hover. |
| `--noggin-row-selected-bg` / `-fg` | Multi-select / focused row. |
| `--noggin-row-active-bg` / `-fg` / `-fg-muted` | Engine-active item (the item the agent is "in"). |
| `--noggin-row-done-fg` | Done state on canvas (strikethrough + muted). |

### Tier 3 — Containers

Surfaces that float above the canvas.

| Token pair | Role |
| --- | --- |
| `--noggin-elevated-bg` / `-fg` / `-fg-muted` | Popovers, menus, the details pane. |
| `--noggin-sunken-bg` / `-fg` / `-fg-muted` | Note backgrounds, code blocks. |
| `--noggin-input-bg` / `-fg` / `--noggin-input-placeholder-fg` | Text inputs and the markdown editor. |

### Tier 4 — Semantic action colours

For buttons and inline feedback.

| Token pair | Role |
| --- | --- |
| `--noggin-accent-bg` / `-bg-hover` / `-fg` | Primary buttons, focus ring on inputs. |
| `--noggin-danger-bg` / `-bg-hover` / `-fg` | Destructive buttons. |
| `--noggin-error-bg` / `-fg` / `-border` | Error banners. |
| `--noggin-warning-bg` / `-fg` / `-border` | Warning banners. |
| `--noggin-success-fg` | Done-state icon. |

### Tier 5 — Standalone

Layout primitives.

| Token | Role |
| --- | --- |
| `--noggin-border` / `--noggin-border-strong` | Dividers, frames. |
| `--noggin-focus-ring` | Keyboard focus outline. |
| `--noggin-radius-sm` / `--noggin-radius` / `--noggin-radius-lg` | Corner radii. |
| `--noggin-shadow-popover` | Drop shadow on popovers. |
| `--noggin-font-family` / `--noggin-font-family-mono` | Body and mono fonts. |
| `--noggin-font-size` / `-sm` / `-xs` | Font sizes. |

## What each host should do

### VS Code extension

Import the VS Code adapter **after** `styles.css`:

```ts
import '@noggin/ui/styles.css';
import '@noggin/ui/themes/vscode.css';
```

The adapter aliases every `--noggin-*` token to a corresponding
`--vscode-*` workbench token (`--vscode-list-activeSelectionBackground`,
`--vscode-input-placeholderForeground`, etc.), with sane fallbacks if
the host happens not to set one. A small number of tokens are
intentionally **not** aliased to VS Code equivalents because the
upstream values fail WCAG AA (notably
`--noggin-input-placeholder-fg`, which falls back to
`--noggin-canvas-fg-muted` instead of VS Code's 2.34-ratio
placeholder). Those are documented inline in
[`themes/vscode.css`](https://github.com/dornstein/noggin/blob/main/ui/src/themes/vscode.css).

### Electron desktop

The desktop renderer ships with the dark theme baked in:

```ts
import '@noggin/ui/styles.css';
import '@noggin/ui/themes/dark.css';
```

If you want to follow OS theme instead, swap `dark.css` for
`auto.css`.

### Standalone web app / docs site

Pick whichever single theme you want, or load `auto.css` for
`prefers-color-scheme` switching.

## Writing a custom theme

A theme is a single CSS file that re-declares the tokens. Copy
[`themes/dark.css`](https://github.com/dornstein/noggin/blob/main/ui/src/themes/dark.css)
as a starting point. Override only the tokens you want to change.

```css
/* my-brand.css */
:root {
  --noggin-accent-bg:        #ff4a85;
  --noggin-accent-bg-hover:  #e63977;
  --noggin-accent-fg:        #ffffff;

  --noggin-focus-ring:       #ff4a85;
  --noggin-radius:           6px;
}
```

Remember the paired-token contract: if you change a `*-bg`, change
its matching `*-fg`.

## Dev-time contrast checker

`@noggin/ui/contrast-check` is a tiny WCAG checker that walks the
17 canonical token pairs, composites translucent backgrounds over
the canvas, computes contrast ratios, and `console.warn`s any pair
that fails AA (4.5:1 normal / 3:1 large text).

Wire it up in your renderer's entry point, gated to dev:

```ts
if (process.env.NODE_ENV !== 'production') {
  void import('@noggin/ui/contrast-check').then((m) => m.checkTokenContrast());
}
```

You'll get output like:

```
[noggin-ui] contrast pass  row.selected  4.92  #0d1117 on #dbeafe
[noggin-ui] contrast FAIL  input.placeholder  2.34  #555 on #1e1e1e
[noggin-ui] contrast skip  row.active  (color-mix() not parsed)
```

The checker is dead code in production builds — bundlers tree-shake
the `if` branch away.
