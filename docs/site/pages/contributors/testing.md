---
title: Testing strategy
slug: "contributors/testing/"
---

# Testing strategy

noggin uses **four** independent test tiers. Each catches a distinct
class of bugs; together they cover the system end to end without any
one tier collapsing under load. New contributors: the most common
question is *"where does my test go?"*, and the answer is whichever
tier matches the smallest scope that still exercises the bug class
you care about. The table at the bottom of this page makes that
explicit.

## The four tiers

| Tier | Tool | Where | What it catches |
|---|---|---|---|
| **1. Engine / verb** | `node:test` | [`engine/test/`](https://github.com/dornstein/noggin/tree/main/engine/test) | Verb semantics, persistence, schema invariants, event firing |
| **2. Component (jsdom)** | `vitest` + `@testing-library/react` | [`ui/src/__tests__/`](https://github.com/dornstein/noggin/tree/main/ui/src/__tests__) | Props → DOM, handler wiring, keyboard gestures, controlled-state plumbing |
| **3. Component (real browser)** | `@playwright/experimental-ct-react` | [`ui/src/__tests__/ct/`](https://github.com/dornstein/noggin/tree/main/ui/src/__tests__/ct) | Layout, sizing, virtualization, `ResizeObserver`, `display:none` semantics, HTML5 drag-and-drop, real focus model, CSS |
| **4. App-level E2E** | `@playwright/test` | [`docs/site/tests/`](https://github.com/dornstein/noggin/tree/main/docs/site/tests) (today) | Tab switching, persistence, two panes staying in sync, multi-component flows, the actual product surfaces |

The tiers exist because **each one is blind to the bug class
immediately above it**. Tier 1 doesn't render anything. Tier 2
renders in jsdom, which has no layout engine — every measurement is
`0`, `display:none` is meaningless, drag events don't fire. Tier 3
mounts a single component in a real browser page and gets all of
that, but it doesn't load the actual app. Tier 4 loads the actual
app but is the slowest and flakiest — keep it small and aimed at
high-value journeys.

## Why this stack

We picked one tool per tier and stop. Adding more tools costs more
than it gains:

- **node:test** for the engine: zero deps, ships with Node, fast.
  The 127-case golden suite ([cli/test/smoke-cli.test.mjs](https://github.com/dornstein/noggin/blob/main/cli/test/smoke-cli.test.mjs))
  was the test bed for the entire engine extraction.
- **vitest + @testing-library/react** for jsdom: the React community
  standard for component tests. Fast, hot-reloading, integrates with
  TypeScript out of the box.
- **Playwright CT** for headed component tests: same `expect`/
  `locator` API as full Playwright, same trace viewer, same debugger.
  Adopting it gives us full Playwright "for free" when we need tier
  4.
- **Playwright** for E2E: works for static sites today, scales to
  the VS Code extension webview (via `@vscode/test-electron`) and
  the desktop renderer (via Playwright's built-in
  `_electron.launch()`) when we get there.

We deliberately *don't* use Cypress (worse multi-window story than
Playwright, slower), Storybook + Chromatic (heavy ceremony plus a
paid tier for the useful part), or Vitest browser mode (newer and
less mature than Playwright CT, and we'd want full Playwright
anyway). Adopting any of those would mean two test runners covering
the same tier.

## What lives where

### Tier 1 — Engine

Anywhere in [`engine/test/`](https://github.com/dornstein/noggin/tree/main/engine/test).
One file per concern (`add.test.mjs`, `move.test.mjs`, etc.). The
suite uses pure in-memory nogginsl no I/O, runs in <1s.

```bash
cd engine && npm test
```

If you add a new verb or change the response envelope, **start here**.
The whole rest of the system trusts these invariants.

### Tier 2 — Component (jsdom)

[`ui/src/__tests__/*.test.tsx`](https://github.com/dornstein/noggin/tree/main/ui/src/__tests__).
Mount a component with explicit `width`/`height` props and drive it
with `@testing-library/react`. Use this tier for:

- A click/keypress dispatches the right handler
- A prop change re-renders the right rows
- A controlled-state plumbing detail (selected path, renaming path)
- Auto-commit-then-dispatch (rename input → add gesture without
  Enter first)

Do **not** use this tier for layout, virtualization, focus model
subtleties, or anything where `clientWidth` matters. jsdom returns
`0` for every measurement; you'll either write fragile mocks or get
false confidence.

```bash
cd ui && npm test
```

### Tier 3 — Component (real browser)

[`ui/src/__tests__/ct/*.ct.tsx`](https://github.com/dornstein/noggin/tree/main/ui/src/__tests__/ct).
Mount a single component in a real Chromium page via Playwright CT.
Use this tier for:

- Anything that depends on `clientWidth` / `clientHeight` /
  `getBoundingClientRect()`
- `ResizeObserver` / `IntersectionObserver` behaviour
- `display: none` and visibility transitions
- HTML5 drag and drop (jsdom doesn't fire native drag events at all)
- Real focus / blur / `focus-visible` behaviour
- Virtualization (react-arborist's actual viewport math)
- CSS variable theme switching producing the right computed colours

```bash
cd ui && npm run test:ct
```

The first time you run it, Playwright downloads the Chromium browser:

```bash
cd ui && npx playwright install --with-deps chromium
```

CT tests are slower than jsdom tests (real browser startup) but
still measured in seconds, not minutes. Keep the suite tight: every
CT test should justify itself by exercising something jsdom
*cannot*.

### Tier 4 — App-level E2E

[`docs/site/tests/*.spec.ts`](https://github.com/dornstein/noggin/tree/main/docs/site/tests)
today. Loads the built docs site in a real browser and drives the
playground end to end (CLI input → tab switch → tree render). Use
this tier for:

- A user journey that touches multiple components in sequence
- A bug that only appears when two views are wired to the same
  noggin
- A regression that was *caused* by the cross-component plumbing
  rather than any one component

```bash
cd docs/site && npm run test:e2e
```

This tier is the slowest and flakiest. **Keep it small** — a handful
of high-value journeys, not a coverage tool. If a behaviour can be
tested in tier 2 or 3, do it there.

## Decision table

When you're unsure where a test belongs, work *down* the table and
stop at the first row that matches:

| If your bug needs… | …it goes in tier |
|---|---|
| A verb to produce a specific document state | **1 — Engine** |
| A handler to fire with the right args | **2 — Component (jsdom)** |
| A prop change to cause a re-render | **2 — Component (jsdom)** |
| Anything to measure non-zero in `clientWidth`/`clientHeight` | **3 — Component (CT)** |
| `display: none` → visible to render correctly | **3 — Component (CT)** |
| Real drag-and-drop events to fire | **3 — Component (CT)** |
| Two components to coordinate via shared state | **4 — App E2E** |
| Persistence (localStorage / file watcher) round-trip | **4 — App E2E** |

## Coverage status (today)

| Tier | Status |
|---|---|
| 1 — Engine | **Mature.** 200+ tests across `engine/test/`, gates every push via CI. |
| 2 — Component (jsdom) | **Mature for the tree/details widgets.** ~60 tests in `ui/src/__tests__/`. |
| 3 — Component (CT) | **Started.** Covers the virtualized-tree auto-sizer under `display:none → visible`. Add more as we touch each component. |
| 4 — App E2E | **Started.** Playground smoke + cross-tab-sync regression. |

## Coverage gaps (next up)

These layers are designed-in but not implemented yet — each is a
sizeable spike on its own and deserves a dedicated PR:

- **VS Code extension webview E2E.** Drive the real extension via
  `@vscode/test-electron`, attach Playwright to the webview's
  DevTools target, exercise a verb round-trip. Catches breakage in
  the postMessage RPC bridge and the React webview boot path.
- **Electron desktop E2E.** Launch via Playwright's
  `_electron.launch()`, open a `file://` noggin, run a verb through
  `RemoteNoggin`, assert the tree updates. Catches breakage in the
  preload bridge, the IPC transport, and the renderer-side optimistic
  adapter.
- **Visual regression.** If we start caring about pixel-level
  consistency across themes, the cheapest add is Playwright's
  built-in `toHaveScreenshot()`. Don't pull in a separate visual-
  diff service until we have a recurring need.

## Writing your first test

### A new tier 2 test

```bash
cd ui
# Open ui/src/__tests__/NogginTree.test.tsx for examples
npm run test:watch
```

The harness in that file is a controlled wrapper — copy it for any
component that has `selected*` / `renaming*` style props.

### A new tier 3 test

```bash
cd ui
# Open ui/src/__tests__/ct/NogginTree.ct.tsx for examples
npm run test:ct -- --ui   # interactive mode, recommended for authoring
```

The CT mount API is the same as Testing Library's `render`, except
the component runs in a real browser. Use `page.locator(...)` and
`await expect(locator).toBeVisible()` instead of `screen.getByText`.

### A new tier 4 test

```bash
cd docs/site
# Open docs/site/tests/playground.spec.ts for examples
npm run test:e2e -- --ui
```

The `webServer` config block in [`playwright.config.ts`](https://github.com/dornstein/noggin/blob/main/docs/site/playwright.config.ts)
builds and serves the docs site on a free port before the suite
runs.

## CI integration

All four tiers run on every push to `main` and every pull request in
[`.github/workflows/ci.yml`](https://github.com/dornstein/noggin/blob/main/.github/workflows/ci.yml).
The matrix is:

| Job | Tier(s) | Approx. time |
|---|---|---|
| `engine` | 1 | ~10s |
| `cli` | 1 | ~30s (includes MCP + CLI bundle smoke) |
| `rpc` | (unit) | ~10s |
| `extension` | (build only) | ~60s |
| `ui` | 2 + 3 | ~90s (CT browser install cached) |
| `playground-e2e` | 4 | ~60s (docs site build + Chromium) |

A red light from any tier blocks the auto-publish workflow. If you
need to land a docs-only change without running the slow tiers, use
`[skip release]` in the commit message — that skips the release
workflow but still runs CI.

## Anti-patterns

A few patterns that tend to cause pain — flag them in review:

- **A tier 2 test that depends on layout.** Mock `clientWidth` and
  you'll hide a real bug, like [the
  one](https://github.com/dornstein/noggin/issues) that motivated
  this whole document. Move the test up to tier 3.
- **A tier 4 test that re-tests a verb.** If you're asserting on
  noggin internals after a verb run, write a tier 1 test instead —
  it'll run 100× faster and have 100× tighter error messages.
- **A "render everything" smoke test.** They pass when the
  component is broken in user-invisible ways (rows have zero
  height, focus is on `<body>`, drag handler never fires). Test
  specific behaviour or skip the test.
- **A test that exists to lift coverage %.** Coverage is a metric,
  not a goal. Each tier has a purpose; tests outside that purpose
  add maintenance cost without buying anything.

## See also

- [CONTRIBUTING.md](https://github.com/dornstein/noggin/blob/main/CONTRIBUTING.md) — overall contributor workflow.
- [Playwright CT docs](https://playwright.dev/docs/test-components)
- [Testing Library docs](https://testing-library.com/docs/react-testing-library/intro)
- [react-arborist source](https://github.com/brimdata/react-arborist) — when virtualization breaks, it's almost always sizing or selection.
