---
title: noggin-rpc — unified protocol, host-side providers, optimistic UI
status: proposed
date: 2026-06-25
---

# noggin-rpc — design doc

## Why now

We are about to make two big moves in parallel:

1. **Rebuild the VS Code extension on `@noggin/ui`**, replacing the
   bespoke wire-protocol-driven webview and hand-rolled HTML details
   pane with the same React components the desktop ships.
2. **Open the architecture to richer providers**, including some that
   will need network access, OAuth, OS keychains, and platform APIs
   the webview (a browser context) cannot reach.

If we wire those up ad hoc, we will end up with two architectures: the
desktop's "engine-in-renderer + tiny shell IPC" and a sprawl of
provider-specific IPC bridges in VS Code. Provider authors would have
to think about both. The webview-as-browser constraint would push us
into one-off `postMessage` channels every time a provider needs to do
something Node-only.

This plan unifies all split-process hosts (desktop, VS Code, eventual
web) under a single transport-agnostic RPC protocol called
**noggin-rpc**. The engine and providers always run host-side; the UI
becomes a thin remote client. The cost is that verbs are now async
even in desktop — we pay it back with an optimistic-update layer in
the UI so gestures still feel sync.

The northstar is documented visually at [`docs/architecture.html`](../architecture.html).
This plan describes how we get there from where we are today.

## Goals

- **One transport-agnostic protocol** that desktop electron-ipc and
  VS Code postMessage both speak. A future WebSocket-based web host
  swaps the transport and inherits the rest.
- **Host-side providers** that can do anything Node + the host
  platform can do (file I/O, network, OS keychain, vscode.* APIs).
- **UI components that don't know they're remote** — the React tree
  consumes a `Noggin`-shaped client whose verbs happen to be async.
- **Cross-host symmetry**: writing a provider once works in any
  split-process host the provider's capabilities apply to.
- **Sync-feeling gestures despite async verbs**, via an optimistic
  update layer shared between desktop renderer and VS Code webview.
- **Tightened renderer security**: with engine + node access moved
  back to main, the Electron renderer can run with
  `contextIsolation: true` + `nodeIntegration: false` again.
- **Formal first-class protocol documentation** alongside the engine
  docs, not buried in a plan. `noggin-rpc` becomes a documented
  contract people can build clients and servers against.
- **Clean separation of engine and CLI** as distinct concepts. The
  engine is host-agnostic; the CLI is just one client.

## Non-goals

- **Touching CLI or MCP host's verb semantics.** Both stay
  single-process; they call the engine directly. noggin-rpc exists
  only for split-process hosts.
- **Replacing MCP as the agent transport.** Agents still spawn MCP
  child processes. The VS Code in-process LM-tools path also stays.
- **Building any of the hypothetical providers** (ADO, Planner,
  GitHub, etc.). The plan makes them *possible*; we ship none.
- **Changing the on-disk YAML format**, the engine's verb
  semantics, or the JSON envelope returned by CLI `--json`.
- **A web host.** The protocol is designed so one would be cheap
  later, but we ship no browser-only host in this plan.
- **Multi-noggin in one webview.** One host, one open noggin at a
  time, same as today.

## Vocabulary

We use **provider** for the single concept that today is split across
"factory" (engine-side data plug-in) and "backend" (host-side UX
flows). One word, one thing per scheme. Some providers will be
data-only, some UX-rich, but they register through one API.

We use **engine** for the data model + verbs + change-event machinery.
It is a separable artifact (`@noggin/engine`); the CLI, the MCP
server, and every host all *embed* it. The CLI is a thin client of
the engine, no different in principle from a desktop renderer being
a thin client of the engine over RPC.

## Architecture summary

Two host families:

- **Family A — single-process.** CLI, MCP. Engine lives in the only
  process; verbs are awaited function calls. noggin-rpc not used.
  Unchanged by this plan in spirit (modulo the engine extraction in
  Phase 0).
- **Family B — split-process.** Desktop (Electron) and VS Code. The
  trusted process (main / extension host) owns the engine + provider
  registry + host services. The untrusted process (renderer /
  webview) owns the React UI. They talk noggin-rpc.

The split-process side gets three new shared pieces:

1. **`@noggin/rpc`** — the transport-agnostic protocol, with
   pluggable transport adapters (electron-ipc, postMessage,
   WebSocket-future).
2. **Remote engine client** — a `Noggin`-shaped object the UI uses,
   whose methods dispatch through `noggin-rpc`. Lives in `@noggin/ui`.
3. **Optimistic update layer** — between the components and the
   remote engine client; applies mutations locally, reconciles when
   the host confirms.

## Method surface

The protocol carries the following families of calls (defined fully
in Phase 2's protocol spec). They are all the things the UI ever asks
the host to do:

- **Lifecycle**: `noggin.open`, `noggin.close`, `noggin.subscribe`,
  `noggin.unsubscribe`.
- **Verbs (mutations)**: `verb.push / add / move / goto / done / pop
  / edit / note / delete / copy` — one per existing engine verb.
- **Reads**: `noggin.snapshot`, `noggin.show`.
- **Streaming events** (server → client): `noggin.changed`,
  `noggin.errored`.
- **Host services**: `host.pickFile / pickNewFile / showInputBox /
  showQuickPick / showConfirm / showError / openExternal`.
- **Providers**: `provider.list / create / open / listInstances /
  describe`.

There are no provider-specific RPC methods. Provider authors register
their flows host-side; the UI invokes them via the generic
`provider.create` etc.

## Decisions worth pinning

- **The same `host.*` methods are callable from both UI and
  providers.** Providers run host-side but call `host.showInputBox`
  via a local-call shim rather than crossing the IPC bus; the
  protocol is the abstraction, the implementation chooses the
  cheapest path.
- **Full document snapshot is sent on `noggin.open`** (and
  re-requested via `noggin.snapshot` after errors). Subsequent
  changes flow as incremental `noggin.changed` events. Projection
  (tree, indents, etc.) is a UI concern and stays in
  `@noggin/ui`.
- **Optimistic UI ships in the first version**, not as a follow-up.
  Without it the round-trip lag on every keystroke would be the
  user-visible regression that justifies skepticism about going
  async. We design the protocol assuming optimistic application.
- **WebSocket transport is in the protocol design but not built.**
  Codegen / signatures are transport-agnostic; we add the WebSocket
  adapter only when there's a concrete web host need.
- **`contextIsolation` flips back to `true` for the desktop
  renderer.** Engine moves out; renderer no longer needs
  `require('node:fs')`. Preload returns to a contextBridge surface.
- **The protocol is a `@public` contract.** Every method and message
  type is documented with TSDoc and rendered into the doc site. New
  methods require a plan-doc-quality discussion before landing.

## Repository layout

Today everything lives under `cli/` because the engine started as the
CLI's implementation detail. Going forward:

```
engine/                  # @noggin/engine — the data model + verbs
  noggin-api.mjs
  noggin-api.d.mts
  providers/             # (renamed from cli/backends/)
    file.mjs
    memory.mjs
  serializers/
    yaml.mjs
    json.mjs
  noggin.schema.json
  test/

cli/                     # @noggin/cli — argv client + MCP server
  noggin.mjs             # argv → engine
  noggin-mcp.mjs         # stdio JSON-RPC → engine
  SKILL.md
  README.md
  test/

rpc/                     # @noggin/rpc — the protocol + transports
  protocol.d.mts         # @public protocol types
  client.mjs
  server.mjs
  transports/
    memory.mjs
    electron-ipc.mjs
    postmessage.mjs
  test/

ui/                      # @noggin/ui — React components (unchanged)
  src/...
  src/remote/            # NEW: remote engine client + optimistic layer

desktop/                 # Electron host (unchanged structure)
extension/               # VS Code extension host (rewritten internally)
plugin/                  # Agent-plugin distribution (unchanged)
```

Synced skill folders (`plugin/skills/noggin/`,
`extension/skills/noggin/`, `desktop/skills/noggin/`,
`ui/skills/noggin/`) mirror the new `engine/` + `cli/` split:

```
skills/noggin/
  engine/                # synced from engine/
  cli/                   # synced from cli/
  SKILL.md               # synced from cli/
  README.md              # synced from cli/
```

`scripts/sync-skill.mjs` updates to copy from both source folders.

## Phases

The work breaks into eight phases. Each phase ends with a runnable
build of all hosts; nothing is left partially migrated across a phase
boundary. Each phase explicitly lists the **tests it adds**, the
**validation gates it must pass** (typecheck + smoke test across
hosts), and any **documentation** that lands with the code.

### Phase 0 — engine extraction + naming cleanup

**Goal:** Reshape the repo so the engine is a distinct concept from
the CLI, and the new "provider" vocabulary is in place everywhere.
Pure rename + relocation, no behavioural change.

Steps:

1. **Engine extraction.** Create `engine/` workspace package
   (`@noggin/engine`). Move from `cli/`:
   - `noggin-api.mjs` + `noggin-api.d.mts`
   - `serializers/yaml.mjs`, `serializers/json.mjs` (+ `.d.mts`)
   - `backends/file.mjs`, `backends/memory.mjs` (+ `.d.mts`)
   - `noggin.schema.json` (from repo root, move into engine/)
   - `test/` directory and its 174 tests
2. **CLI slims down.** `cli/` retains only:
   - `noggin.mjs` (argv → engine)
   - `noggin-mcp.mjs` (MCP stdio server → engine)
   - `SKILL.md`, `README.md`, package.json (deps on `@noggin/engine`)
   - `test/` becomes a tiny smoke-test directory only (engine tests
     stay in `engine/test/`)
3. **Provider rename.** In moved code:
   - Rename `backends/` → `providers/` inside engine/.
   - Rename `register(scheme, factory)` → `registerProvider(scheme, impl)`.
   - Rename `factories` namespace → `providers`.
   - Rename internal `factoryFor(scheme)` → `providerFor(scheme)`.
   - Update every TSDoc and comment that says "backend" or "factory"
     to say "provider".
4. **Sync script update.** `scripts/sync-skill.mjs` learns about
   `engine/` and `cli/` as two source roots; produces the same
   `skills/noggin/` layout described above in each consumer.
5. **Workspace dep wiring.** Update `cli/package.json`,
   `ui/package.json`, `desktop/package.json`, `extension/package.json`,
   `plugin/package.json` to depend on `@noggin/engine` where they
   previously depended on `noggin-cli`. The `noggin-cli` package
   keeps exporting from `@noggin/engine` for one release as a
   transitional shim (deprecated, not load-bearing).
6. **Docs.** Update `CONTRIBUTING.md`, all per-package READMEs,
   `cli/SKILL.md` to reflect the new layout and use "provider"
   uniformly. New top-level prose section in `docs/site/` titled
   "Engine, CLI, and clients" introducing the separation.

**Testing & validation:**

- Engine's 174 existing tests must pass in their new location
  (`engine/test/`). Run via `npm test --workspace=@noggin/engine`.
- A new smoke test in `cli/test/` invokes `node noggin.mjs help` and
  asserts the CLI still bootstraps against the extracted engine.
- A new smoke test in `cli/test/` boots the MCP server, sends a
  `tools/list` request, asserts the verb tools appear.
- Each host runs `npm run typecheck` after import-path fixups.
- Synced `skills/noggin/` folders must rebuild cleanly via
  `node scripts/sync-skill.mjs`; CI's existing sync-drift check
  passes.
- Manual smoke: `noggin push 'hi'` works; desktop opens; extension
  webview activates. All three should be no-ops behaviorally — the
  whole phase is a rename.

**Documentation:**

- `engine/README.md` (new) — what the engine is, the verb model,
  pointers to `cli/README.md` for the JSON envelope spec.
- `cli/README.md` (renamed/clarified) — what the CLI is, its
  argv→verb mapping. Notes that the CLI is one of several clients of
  the engine.
- `docs/site/architecture-overview.md` (new) — short orientation
  page describing engine/CLI/rpc/ui/hosts as separate concerns.
  Links to the architecture HTML.

**Done when:** "factory" and "backend" appear nowhere in `engine/`,
`cli/`, `extension/`, or `desktop/` (except in legacy bundle output,
which gets regenerated). The engine is its own package, importable
without pulling in any CLI code.

### Phase 1 — `@noggin/rpc` package skeleton + protocol spec

**Goal:** Create the new package, define the protocol types, ship
three transport adapters (memory, electron-ipc, postMessage). Land
the formal protocol documentation as `@public` TSDoc and prose.

Steps:

1. New workspace package `rpc/` (`@noggin/rpc`), pure TypeScript,
   no React, no Node-specific imports at the top level.
2. Define `RpcProtocol` types in `rpc/protocol.d.mts`. Tagged
   `@public` per method. Generates the doc-site reference pages.
3. Define `Transport` interface (`send(message)` + `onMessage`).
   Provide three implementations:
   - `MemoryTransport` (in-process, for tests).
   - `ElectronIpcTransport` (server uses `ipcMain`; client uses
     `ipcRenderer`).
   - `PostMessageTransport` (server uses `webview.onDidReceiveMessage`;
     client uses `window.postMessage`).
4. Define `RpcClient` and `RpcServer` classes. Client correlates
   requests with responses; both sides manage long-lived
   subscription IDs and stream messages. Both implement liveness
   heartbeat + auto-unsubscribe on transport disconnect.
5. Method surface defined as TypeScript types only at this phase
   — no engine wiring yet. Method names from the "Method surface"
   section above.

**Testing & validation:**

- Unit tests in `rpc/test/`:
  - Round-trip a single request through `MemoryTransport`.
  - Multiple pending requests with correlation IDs; results land
    against the right caller.
  - Subscription lifecycle: subscribe, receive 3 messages, unsubscribe;
    confirm no more messages arrive.
  - Error envelope round-trip: server throws, client catches a
    typed `NogginRpcError`.
  - Transport disconnect: pending requests reject; subscriptions
    auto-cancel; client reports disconnected state.
  - Heartbeat: idle connection issues pings; missing pings detected
    as disconnect.
- Integration test: `MemoryTransport` with two endpoints exercises
  every method-shape (request/response/notification/subscription)
  end-to-end against a fake server.
- Typecheck: `npm run typecheck --workspace=@noggin/rpc` passes.
- Docs build: `docs/site/` build succeeds with the new
  `noggin-rpc.md` page rendered from the TSDoc on
  `protocol.d.mts`.

**Documentation:**

- `rpc/README.md` (new) — what the package is, how to use it from
  client and server sides, transport-author guide for adding new
  transports later.
- `docs/site/noggin-rpc.md` (new, **load-bearing**) — formal
  protocol reference. Method-by-method spec: request shape,
  response shape, error codes, ordering semantics, subscription
  semantics. This is the document any third party would build a
  noggin-rpc client/server against.
- `docs/architecture.html` — verify the existing rpc tab matches
  what we shipped; reconcile if not.

**Done when:** `cd rpc && npm test` passes. The package exports a
client and server that can talk through `MemoryTransport` without
any engine involvement. The protocol spec is published on the doc
site.

### Phase 2 — host-side engine wrapper + RPC server

**Goal:** Wire the engine + provider registry + `HostServices`
implementations to the `RpcServer` so a transport with no clients
attached has a usable noggin running behind it.

Steps:

1. New `@noggin/rpc-server` sub-module:
   `createNogginRpcServer({ engine, providers, hostServices,
   transport })`. Wires every RPC method to in-process calls.
2. Stream `ChangeEvent`s as `noggin.changed` notifications to all
   subscribed clients.
3. Define `HostServices` interface in `@noggin/rpc` (matches the
   provider design from `docs/architecture.html`).
4. Provide reference `HostServices` implementations:
   - `rpc/test/host-services-test.mjs` — for unit tests (records
     calls, returns scripted values).
   - `desktop/main/host-services-electron.ts` — stub in this phase
     (real implementation lands in Phase 4).
   - `extension/host-services-vscode.ts` — stub in this phase
     (real implementation lands in Phase 5).

**Testing & validation:**

- Integration tests in `rpc/test/`:
  - Open a memory noggin via `noggin.open`; verify snapshot is
    delivered.
  - Subscribe to changes, perform `verb.add`, verify a
    `noggin.changed` event arrives.
  - Verb error (e.g. invalid path) returns a typed `NogginError`
    envelope.
  - `provider.list` returns registered providers; `provider.create`
    on the memory provider produces a working noggin.
  - `host.showInputBox` (using the test impl) returns the scripted
    value.
- Engine tests continue to pass — Phase 2 must not require any
  engine changes.
- Typecheck across `engine/`, `cli/`, `rpc/`, `ui/`, hosts.

**Documentation:**

- `docs/site/noggin-rpc.md` gains a "server adapter" section:
  how a host wires Engine + providers + host services to expose
  a noggin over noggin-rpc.
- TSDoc on `createNogginRpcServer` and `HostServices`.

**Done when:** the `RpcServer` is feature-complete against a
running engine: every verb, every host service, every provider
operation, every change-event subscription works through the
protocol. A memory-transport client can drive a memory-noggin
end-to-end.

### Phase 3 — remote engine client + optimistic layer

**Goal:** Build the UI-side adapter that makes the remote engine
look local enough for the existing components.

Steps:

1. New module `ui/src/remote/RemoteNoggin.ts` — implements the
   subset of the `Noggin` interface the UI components actually
   use, dispatching through an `RpcClient`. Async by signature;
   readers cached from streamed snapshot.
2. Optimistic-update layer `ui/src/remote/optimistic.ts`. On verb
   dispatch:
   - Predict the resulting `NogginDocument` mutation locally.
   - Update the cached snapshot immediately.
   - Send the RPC. On `noggin.changed` confirmation, reconcile
     (no-op if predicted correctly); on error, roll back to the
     last confirmed snapshot and surface the error.
3. Re-target `@noggin/ui` components to consume `RemoteNoggin`
   instead of the in-process `Noggin`. The interface they see is
   the same; the methods become `Promise`-returning.
4. `executeGesture` and friends update to await the remote
   client. The existing `addingRow` swallow window generalizes
   into the optimistic layer (no longer special-cased).

**Testing & validation:**

- Unit tests in `ui/src/__tests__/RemoteNoggin.test.ts`:
  - Verb call dispatches a correct RPC request.
  - Predicted snapshot applies immediately to local cache.
  - Reconciliation: confirmed `noggin.changed` matching prediction
    leaves cache unchanged.
  - Reconciliation: confirmed event differing from prediction
    re-projects to the server's truth.
  - Rollback: server returns error → predicted change is
    reverted; cache returns to last confirmed snapshot.
  - Multiple in-flight: dispatch three verbs; confirmations arrive
    out of order; final state matches the server's serialised order.
- Unit tests in `ui/src/__tests__/optimistic.test.ts`:
  - The optimistic layer's prediction function for each verb
    (push, add, move, edit, done, delete) matches the engine's
    actual result (golden test against the engine in-process,
    verifying that prediction is a faithful local model).
- Existing component tests (`NogginTree.test.tsx`,
  `NogginDetails.test.tsx`) continue to pass after re-targeting:
  the test harness now constructs a `RemoteNoggin` connected to
  a memory-transport server backed by a real engine + memory
  provider.
- New component test: `optimistic-ui-flow.test.tsx` exercises a
  full "type → Enter → see row appear → type next" chord under
  simulated 50ms transport latency, confirms no UI lag is
  user-visible because optimistic application precedes confirmation.

**Documentation:**

- `ui/src/remote/README.md` (new) — architecture of the optimistic
  layer; mental model for readers; what can go wrong.
- TSDoc on `RemoteNoggin` and the optimistic layer's public API.
- `docs/site/noggin-rpc.md` gains a "client-side optimistic
  application" section.

**Done when:** every existing UI test passes against a memory-
transport remote engine. The optimistic layer is exercised under
test (predict + confirm; predict + rollback; multiple inflight
predictions reconciling in order). A 50ms artificial latency does
not visibly slow gesture chords in the new component test.

### Phase 4 — desktop migration

**Goal:** Switch desktop from "engine in renderer" to "engine in
main, UI talks RPC". This is the first real consumer of the new
stack, end to end.

Steps:

1. Move engine instantiation from
   `desktop/src/renderer/src/noggin.ts` to a new
   `desktop/src/main/engine.ts`. Main process owns the live
   `Noggin` instance and the `RpcServer`.
2. Implement `desktop/src/main/host-services-electron.ts`.
   `pickFile` / `pickNewFile` / `showError` / `openExternal` /
   `setMenuState` stay as-is. New: `showInputBox`,
   `showQuickPick`, `showConfirm` — these need a React modal to
   render in the renderer; main posts a modal-request via a
   dedicated IPC channel, renderer mounts the modal, posts the
   reply back. (This is the one place where a noggin-rpc method
   needs to round-trip the renderer to fulfill, because the modal
   UI lives there.)
3. Wire the `RpcServer` to `ElectronIpcTransport` in main.
4. In the renderer, replace direct engine imports with the new
   `RpcClient` + `RemoteNoggin`. The `useNogginState` hook now
   creates a `RemoteNoggin` instead of opening the engine
   directly.
5. Tighten security: `BrowserWindow` webPreferences flip back to
   `contextIsolation: true`, `nodeIntegration: false`,
   `sandbox: true` (we no longer need Node in the renderer). The
   preload script's `window.shell` becomes a properly
   contextBridge-exposed interface again.
6. Drop the dev-only `nodeBuiltinsAsRuntimeRequire` Vite plugin
   from `desktop/electron.vite.config.ts` — no longer needed
   since the renderer doesn't import `node:*` builtins.
7. Remove dead code: the renderer's engine loader, the file
   provider's renderer-side import (moves to main), the
   `applyChanges` parity assertion stays useful but operates on
   the optimistic layer instead.

**Testing & validation:**

- Desktop's existing component tests run against the same
  `RemoteNoggin` harness used by `@noggin/ui`'s tests.
- New `desktop/test/end-to-end.test.mjs`:
  - Boots a main-process engine + RpcServer in the test process.
  - Mounts the renderer App against an in-test `RpcClient`.
  - Exercises open-file → add-item → close-noggin.
  - Asserts on rendered DOM after each step.
- New `desktop/test/host-services.test.mjs`: validate the
  modal-round-trip pattern for `showInputBox` works correctly with
  a stubbed renderer side.
- Manual smoke matrix (documented in `CONTRIBUTING.md`):
  - Open existing file noggin.
  - Create new noggin.
  - Rapid keystroke chord (Enter Enter Ctrl+Enter Tab) feels
    instant.
  - Close noggin.
  - Switch noggins from recents list.
  - External edit detected and projected.
- Typecheck across all workspaces; ui tests pass; engine tests
  pass; rpc tests pass.

**Documentation:**

- `desktop/README.md` updated: new architecture, where engine
  lives, how to extend host services.
- TSDoc on the modal-request IPC contract (separate from
  noggin-rpc) so future authors know it's a renderer-internal
  feature.

**Done when:** every desktop user gesture round-trips through
noggin-rpc and the UI still feels instant. The desktop binary
ships with the tightened renderer security. Manual smoke matrix
passes.

### Phase 5 — VS Code extension rewrite

**Goal:** Replace the bespoke webview + hand-rolled details HTML
with the same React App the desktop ships, talking the same
`noggin-rpc` over postMessage.

Steps:

1. Delete the wire-protocol bridge files
   (`extension/src/treeBridge.ts`,
   `extension/src/treeViewProvider.ts`) and the hand-rolled
   `extension/src/detailsView.ts`. These get replaced.
2. New `extension/src/webview/index.ts` — registers one
   `WebviewViewProvider` that mounts the full `@noggin/ui` React
   App in its webview. The previous two-view layout (tree + details
   in separate webviews) collapses into one webview that itself
   contains the splitter — same as desktop.
3. Wire the `RpcServer` to a new
   `extension/src/webview/postmessage-transport.ts`.
4. Implement `extension/src/host-services-vscode.ts`:
   - `pickFile` / `pickNewFile` → `vscode.window.showOpenDialog`,
     `showSaveDialog`.
   - `showInputBox` → `vscode.window.showInputBox`.
   - `showQuickPick` → `vscode.window.showQuickPick`.
   - `showConfirm` → `vscode.window.showInformationMessage` with
     two buttons.
   - `showError` → `vscode.window.showErrorMessage`.
   - `openExternal` → `vscode.env.openExternal`.
5. Update `extension/src/tools.ts` (language-model tools) to
   operate on the live engine instance owned by the extension
   host (it already does, just clean up the references).
6. Verify existing VS Code command-palette commands still work
   by routing them as `verb.*` RPC calls server-side (no UI
   change needed for the command-palette path).

**Testing & validation:**

- New `extension/test/webview-integration.test.mjs`:
  - Boots the extension host in test mode.
  - Activates the webview view provider.
  - Stubbed webview-side `RpcClient` exercises open-file +
    add-item.
  - Confirms a snapshot stream and a `noggin.changed` event.
- Existing extension command-palette tests continue to pass.
- Manual smoke matrix:
  - Open a noggin via the command palette.
  - See the tree + details in the activity-bar view.
  - Rapid gesture chord feels instant.
  - Copilot Chat tools (`@noggin push 'thing'`) drive the live
    UI.
- Typecheck across all workspaces; `extension/` build still
  produces a valid `.vsix`.

**Documentation:**

- `extension/README.md` updated: new internal architecture; how
  the webview talks to the host via noggin-rpc; how host services
  map to vscode APIs.
- `docs/site/extension-architecture.md` (optional, if there's
  enough material) — pointer page for extension authors who want
  to understand the model.

**Done when:** the extension's tree + details look and behave like
desktop (modulo the missing noggins sidebar). All existing
extension commands continue to work. Engine, providers, and host
services all live in the extension host.

### Phase 6 — provider model formalisation + workspace provider

**Goal:** The provider concept is now load-bearing in the protocol
(`provider.list / create / open / describe`). Make the registration
ergonomic, document the interface formally, and ship the first
host-injected provider.

Steps:

1. Define the `NogginProvider` interface in `@noggin/rpc` as
   `@public`. Fields: `id`, `scheme`, `displayName`, `description`,
   `icon`, `capabilities`, async methods.
2. Refactor `engine/providers/file.mjs` + `engine/providers/memory.mjs`
   to be full providers (currently they're only the data side).
   `file.create()` calls `host.pickNewFile({...})` then inits an
   empty noggin file. `file.open()` calls `host.pickFile(...)`.
3. Refactor desktop's "+ New noggin" and "Open noggin" sidebar
   actions to drive through `provider.list` → quickpick →
   `provider.create / open`.
4. Refactor VS Code's command-palette "Noggin: New" / "Noggin:
   Open" to drive through the same provider RPC.
5. New `extension/src/providers/workspace.ts`:
   - `id: 'workspace'`, registers `workspace://` scheme.
   - `open()`: `workspace.findFiles('**/*.noggin.yaml')` →
     `host.showQuickPick`.
   - `create()`: `host.showInputBox` for filename → write
     under workspace root.
6. Sidebar (desktop) and recents list rendering switch to
   provider-driven labels and icons via `provider.describe(location)`.

**Testing & validation:**

- New unit tests in `engine/test/providers.test.mjs`:
  - `provider.list` returns all registered providers.
  - `provider.list` filtered by capability (only providers with
    `capabilities.create`).
  - `file.create` flow returns a usable noggin.
  - `memory.create` returns an in-process noggin.
- New integration test in `extension/test/workspace-provider.test.mjs`:
  - Mock a workspace with two `.noggin.yaml` files.
  - `workspace.open()` shows a QuickPick with both files.
  - User selection produces a working noggin.
- Existing desktop and extension tests pass after the refactor.
- Manual smoke:
  - "+ New noggin" in desktop offers file provider.
  - "+ New noggin" in VS Code offers file + workspace providers.
  - Provider icons render correctly in the recents list.

**Documentation:**

- `docs/site/providers.md` (new, **load-bearing**) — formal
  provider authoring guide. How to define `NogginProvider`, how to
  register, capability flags, host services available, examples
  using the file provider and the workspace provider as
  reference implementations.
- TSDoc on `NogginProvider` interface and `registerProvider` API.

**Done when:** adding a provider is a 100% additive operation
that hosts opt in by importing and registering. No core changes
needed. The provider authoring guide is published.

### Phase 7 — agents tie-in + final integration

**Goal:** Confirm both agent paths (MCP child + vscode.lm tools)
work correctly against the new architecture without changes, and
land the final round of integration documentation.

Steps:

1. Smoke-test MCP server: unchanged because it's single-process,
   but confirms the Phase 0 engine extraction didn't break the
   bundled MCP build.
2. Smoke-test VS Code LM tools: they now go directly to the
   in-process engine on the extension host side, and the webview
   sees the changes via the same `noggin.changed` event stream.
3. Final docs sweep:
   - `cli/SKILL.md` updated to mention noggin-rpc once (relevant
     for agent authors writing direct noggin-rpc clients).
   - `cli/README.md` and `engine/README.md` cross-reference each
     other clearly.
   - `docs/architecture.html` updated to reflect any deltas from
     what we actually shipped.

**Testing & validation:**

- MCP server end-to-end test: spawn the bundled server, send a
  `tools/list`, send a `tools/call` for `noggin.push`, verify
  result.
- VS Code LM tools: existing extension tests already exercise
  this; re-run.
- Agent integration smoke (manual): in Claude Desktop with the
  MCP server configured, drive a noggin from the agent and watch
  the desktop UI react via `fs.watch` + noggin-rpc.
- Full test sweep: every workspace's tests run green; CI passes.

**Documentation:**

- `docs/site/agents.md` (new) — how agents (MCP child or VS Code
  LM tools) interact with noggin's runtime architecture. Pointers
  to the protocol spec and the architecture overview.
- Index updates in `docs/plans/README.md` to mark this plan
  `status: implemented` with phase commit SHAs.

**Done when:** running the noggin skill in a fresh agent (Claude
desktop with the MCP server config; Copilot Chat in VS Code)
drives the live UI in both desktop and VS Code without any
UI-side adaptation. Doc site has a coherent reference set
covering engine, CLI, noggin-rpc protocol, providers, and agents.

## Risks and mitigations

- **Optimistic layer correctness.** The hardest piece of new code.
  Wrong-direction reconciliation could corrupt local state. Mitigate
  with extensive `RemoteNoggin.test.ts` and `optimistic.test.ts`
  coverage (predict-only, predict-and-confirm, predict-and-rollback,
  multiple-in-flight, out-of-order confirmations). The engine's
  `diffDocuments` gives us the equality oracle. Phase 3 includes
  a golden test that compares each predictor against the engine's
  actual result.
- **Latency regression in desktop.** The desktop currently feels
  instant because verbs are in-process. Going async + electron-ipc
  is single-digit-ms typically but could spike under load. Mitigate
  with the optimistic layer absorbing the round-trip from the user's
  perspective. The Phase 3 latency-injection test is the gate.
- **Webview round-trips for host modals.** Showing a React modal in
  the renderer to fulfill `host.showInputBox` from main is a
  renderer → main → renderer round-trip. Acceptable for the
  one-shot UX cases; not in the hot path of any gesture.
- **Subscription lifecycle leaks.** Long-lived subscriptions over
  postMessage with no client liveness signal could leak. Mitigate
  with a heartbeat / auto-unsubscribe on transport disconnect
  built into Phase 1.
- **`@noggin/rpc` becomes a foot-gun.** If we ever need a method
  that doesn't fit the request/response/subscription model, we'll
  be tempted to add it ad-hoc. Mitigate by keeping the protocol
  surface explicit and reviewed — every new method is a one-line
  type addition with discussion, documented in
  `docs/site/noggin-rpc.md`.
- **Engine extraction breaks bundled MCP / CLI builds.** Mitigate
  by treating Phase 0 as its own deliverable: don't start Phase 1
  until the engine extraction is solid across CLI, MCP, and all
  synced skill folders.

## Sequencing notes

Phases 0–3 are foundational and could ship one at a time to `main`
without breaking any host (they only add new infrastructure
alongside the existing in-process path). Phase 4 is the first
breaking change — desktop's engine moves. After Phase 4 lands, the
existing extension still uses the bespoke wire protocol; Phase 5
brings it onto the new model. Phases 6 and 7 are mostly
additive after that.

Estimated relative effort (no time estimates, just relative size):

- Phase 0: medium (rename + extraction touches every package).
- Phase 1: medium (new package, but no business logic).
- Phase 2: medium (engine wiring, mostly straightforward).
- Phase 3: **large** (the optimistic layer is the hard one).
- Phase 4: large (desktop migration + security tightening).
- Phase 5: large (extension rewrite, deletes a lot of code).
- Phase 6: medium (provider refactor + workspace provider).
- Phase 7: small (smoke tests + docs).

## Open questions settled

1. **Snapshot delivery vs. incremental-only.** `noggin.open` returns
   a full snapshot. Re-litigate if size becomes a problem.
2. **`provider.describe` async cache.** Provider returns a sync
   `label()` for immediate paint, async `describe()` for the rich
   row info. Host caches `describe()` results.
3. **Where does the in-app modal for `host.showInputBox` actually
   render** in desktop? A small `<HostModalHost>` React component
   near the App root, subscribed to a modal-request IPC channel.
   One modal at a time; queue subsequent requests.
4. **Should desktop ship a `WebSocket` transport for remote use
   (e.g. a sidecar UI)?** Not in this plan. Designed for, not
   shipped.
