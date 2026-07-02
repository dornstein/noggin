---
title: Testing strategy
slug: "contributors/testing/"
---

# Testing strategy

noggin tests along two independent axes:

- **Tier** — *what class of bug* a test can catch, from pure logic up
  to the running product. Four tiers, each a rung of rendering
  fidelity.
- **Package** — *where the code lives* (`engine/`, `ui/`, `desktop/`,
  and the VS Code extension next).

A test's **tier** is decided by the smallest scope that still
reproduces the bug you care about; its **package** is just wherever
that code happens to live. Keeping the two separate is what lets one
strategy cover the engine, the shared React components, and the host
apps — without inventing a bespoke system for each.

> **North star:** pick the *lowest* tier that still reproduces the bug.
> A verb bug goes in tier 1, not tier 4. For the two cross-cutting
> concerns below — **conformance** and **determinism** — "lowest tier"
> means the lowest tier where the *implementation* runs and the *seam*
> exists.

## The four tiers

| Tier | Fidelity · tool | Catches |
|---|---|---|
| **1 — Logic tests** | `node:test` or `vitest`, no DOM | Verb semantics, schema, events, pure functions, and RPC **contract** round-trips over a memory transport |
| **2 — Isolated component** | `vitest` + `@testing-library/react` (jsdom) | Props → DOM, handler + keyboard wiring, controlled-state plumbing |
| **3 — Hosted component** | `@playwright/experimental-ct-react` (real browser) | Layout, sizing, `ResizeObserver`, drag-and-drop, real focus, virtualization, CSS |
| **4 — End-to-end** | `@playwright/test` — web, `_electron.launch()`, `@vscode/test-electron` | Multi-component journeys, persistence, the process boundary — in a real running surface |

Each tier is blind to the bug class immediately above it. **Logic
tests** render nothing. **Isolated component** tests render in jsdom,
which has no layout engine — every measurement is `0`, `display:none`
is meaningless, drag events never fire. **Hosted component** tests mount
one component in a real browser and get all of that, but don't load an
app. **End-to-end** tests load a real running surface but are the
slowest and flakiest — keep them to a few high-value journeys.

## Tiers × packages

Tiers are bug classes; packages are locations. Each package owns only
the tiers its code can actually produce bugs in:

| Package | 1 · logic | 2 · isolated | 3 · hosted | 4 · e2e |
|---|---|---|---|---|
| `engine` | verbs, schema, events | — | — | — |
| `cli` / `mcp` | argv + envelope smoke | — | — | — |
| `rpc` | framework + protocol | — | — | — |
| `ui` | pure helpers | tree / details widgets | sizing · drag · virtualization | — |
| `docs/site` playground | — | — | — | shared-UI journeys |
| `desktop` | RPC contract, host-prompt client, keymap / menu logic | renderer glue (`HostServicesReactImpl`, App gestures) | — | `_electron.launch()` smoke |
| `extension` *(next)* | host services, command logic | webview glue | — | `@vscode/test-electron` webview |

The engine is pure data + verbs, so it lives entirely in tier 1; the
shared UI components stop at tier 3 — a component isn't an app.

**End-to-end runs against a real surface, and we have three:**

- the docs **playground** — the shared `@noggin/ui` wired into a live,
  interactive app on the docs site;
- the **desktop** app (`_electron.launch()`);
- the **extension** webview (`@vscode/test-electron`).

The playground is a first-class end-to-end surface, not scaffolding: it
exercises the same components the host apps ship, so a journey that
passes there is a real regression guard for the shared UI.

## Conformance — one suite, every implementation

Several of noggin's contracts have **more than one implementation**, and
the whole multi-host design rests on them staying interchangeable:

| Contract | Implementations | Runs at |
|---|---|---|
| `Noggin` | in-process engine · `RemoteNoggin` | **1** — both (`RemoteNoggin` over a memory transport) |
| `HostServices` | test stub · Electron · VS Code | **1** with the runtime mocked → **4** for the real dialogs |
| `Transport` | memory · electron-ipc · postMessage | **1** for memory → **4** for the real IPC / postMessage |
| response envelope | CLI · MCP · LM tools | **1** |

Write the behavioural suite **once per contract**, then run it against
**every** implementation — each at the lowest tier it can reach. Most are
tier 1 (pure, or with the runtime mocked); the ones welded to a real
runtime (the real transports, the real OS dialogs) project up to tier 4.
This is what keeps the second and third host honest: a divergence
between the Electron and VS Code `HostServices` — say, one seeds a new
file and the other doesn't — is a *conformance failure*, not a mystery
bug someone hits in production.

The **process boundary** is the marquee case. The `noggin-rpc` bridge —
preload shape, channel names, transport framing, the optimistic
`RemoteNoggin` adapter — gets two guards, cheapest first:

1. **Contract test (tier 1).** Stand up the real `createNogginRpcServer`
   + `RemoteNoggin` over a **memory transport** and drive verbs and host
   services through it. No Electron, milliseconds.
   [`desktop/test/end-to-end.test.ts`](https://github.com/dornstein/noggin/blob/main/desktop/test/end-to-end.test.ts)
   is exactly this; each host gets one as its wiring grows.
2. **Real-process E2E (tier 4).** Launch the actual app
   (`_electron.launch()` for desktop, `@vscode/test-electron` for the
   extension), assert the preload bridges exist and a verb round-trips
   end to end.

The contract test catches almost every wiring regression in
milliseconds; the E2E catches only the last mile a memory transport
can't see — the real preload, OS-level IPC, CSP, the packaged bundle.
Reach for the contract test first.

## Determinism

Time and identity are woven through noggin — `createdAt`, the close-note
timestamp, the MRU's ISO timestamps, newest/oldest sort, relative-time
chips, id generation. None of it is testable without a **seam**, so the
seam is a standing requirement, not a per-test workaround:

- The engine verbs, the MRU, and `RemoteNoggin` accept an injected
  **clock** and **id generator** — tests supply fixed ones, production
  the real ones.
- Test runners pin `TZ` and locale so relative-time and formatting are
  reproducible across machines and CI.

Then *where* you assert follows the north star:

> Assert time/id **values** only at the lowest tier where you can inject
> the seam (tier 1). At higher tiers — especially tier 4, where you
> can't reach into a launched Electron process's clock — assert
> **structure and ordering**, never exact timestamps. ("A close note
> appeared", "sort is newest-first" — not "timestamp === …".)

Build the seams now, even before the tests exist: retrofitting a clock
into a codebase already dense with `new Date()` is a change you only get
to make cheaply once.

## Why this stack

One tool per tier, and we stop there — a second tool covering the same
tier costs more than it buys.

- **node:test** (engine): zero deps, ships with Node, fast.
- **vitest + @testing-library/react** (jsdom): the React community
  standard; TypeScript and watch mode out of the box.
- **Playwright CT** (headed components): same `expect` / `locator` /
  trace-viewer as full Playwright, so we get tier 4 "for free."
- **Playwright** (E2E): one API from the static docs site to the
  Electron renderer (`_electron.launch()`) to the extension webview
  (`@vscode/test-electron`).

Rejected on purpose: **Cypress** (weaker multi-window story, slower),
**Storybook + Chromatic** (heavy ceremony, paid tier for the useful
part), **Vitest browser mode** (younger than Playwright CT, and we'd
want full Playwright anyway). Each would put a second runner on one
tier.

## Where does my test go?

Work down the list; stop at the first match:

| If your bug needs… | Tier |
|---|---|
| A verb to produce a specific document state | **1** |
| A pure function / reducer to return the right value | **1** |
| A second implementation to match the contract | **1** conformance (+ **4** for real-runtime impls) |
| A timestamp / id / ordering to be correct | **1**, with an injected clock / id gen |
| An RPC bridge or channel to be wired correctly | **1** (contract) → **4** (real process) |
| A handler to fire with the right args | **2** |
| A prop change to cause a re-render | **2** |
| Non-zero `clientWidth` / `getBoundingClientRect()` | **3** |
| `display:none` → visible, or real drag-and-drop | **3** |
| Two components coordinating via shared state | **4** |
| Persistence (localStorage / file watcher) round-trip | **4** |

## Coverage today

| Package · tier | Status |
|---|---|
| engine · 1 | **Mature** — 200+ tests, gates every push |
| cli / mcp · 1 | **Mature** — 127-case golden suite + bundle smoke |
| rpc · 1 | **Mature** — framework + protocol |
| ui · 2 | **Mature** — ~60 tests across the tree / details widgets |
| ui · 3 | **Started** — virtualized-tree auto-sizer |
| desktop · 1 | **Started** — RPC contract, host-prompt client, keymap, kebab-menu builder, renderer + Electron host-services, provider flows; `applyChanges` now imports the real module |
| desktop · 2 | **Started** — `HostServicesReactImpl` (jsdom, per-file environment) |
| desktop · 4 | **Started** — `_electron.launch()` smoke: preload bridges, Ctrl+B, kebab entries |
| extension · all | **Planned** |
| playground · 4 | **Started** — CLI → tab-switch → tree render, cross-tab sync |

## Anti-patterns

- **A tier-2 test that depends on layout.** jsdom measures `0`; mocking
  `clientWidth` hides real bugs. Move it to tier 3.
- **A tier-4 test that re-tests a verb.** Assert on noggin internals in
  a tier-1 test — 100× faster, 100× tighter errors.
- **A "render everything" smoke test.** It passes while rows have zero
  height and focus is on `<body>`. Test a specific behaviour.
- **A test that exists to lift coverage %.** Coverage is a metric, not a
  goal; a test outside its tier's purpose is pure maintenance cost.

## CI

Every tier runs on every push and PR in
[`.github/workflows/ci.yml`](https://github.com/dornstein/noggin/blob/main/.github/workflows/ci.yml).
A red light on any tier blocks the auto-publish workflow (`[skip
release]` skips the release, not CI).

| Job | Tier(s) | ~time |
|---|---|---|
| `engine` | 1 | 10s |
| `cli` | 1 (+ MCP / CLI bundle) | 30s |
| `rpc` | 1 | 10s |
| `ui` | 2 + 3 | 90s |
| `desktop` | 1 (2 + 4 as they land) | ~30s |
| `extension` | build (E2E next) | 60s |
| `playground-e2e` | 4 | 60s |

## Writing a test

- **Tier 1 · logic:** drop a file in the package's test dir
  (`engine/test/`, `desktop/test/`) and `npm test`.
- **Tier 2 · isolated component:** copy the controlled wrapper in
  [`ui/src/__tests__/NogginTree.test.tsx`](https://github.com/dornstein/noggin/blob/main/ui/src/__tests__/NogginTree.test.tsx);
  `npm run test:watch`.
- **Tier 3 · hosted component:** copy
  [`ui/src/__tests__/ct/NogginTree.ct.tsx`](https://github.com/dornstein/noggin/tree/main/ui/src/__tests__/ct);
  `npm run test:ct -- --ui`. First run once:
  `npx playwright install --with-deps chromium`.
- **Tier 4 · end-to-end:** copy
  [`docs/site/tests/playground.spec.ts`](https://github.com/dornstein/noggin/blob/main/docs/site/tests/playground.spec.ts);
  `npm run test:e2e -- --ui`.

## See also

- [CONTRIBUTING.md](https://github.com/dornstein/noggin/blob/main/CONTRIBUTING.md) — contributor workflow.
- [Playwright CT](https://playwright.dev/docs/test-components) ·
  [Testing Library](https://testing-library.com/docs/react-testing-library/intro) ·
  [Playwright `_electron`](https://playwright.dev/docs/api/class-electron)
