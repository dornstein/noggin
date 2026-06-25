# Contributing to noggin

Thanks for poking at noggin. This file is for people **working on**
noggin (any of the three distributions). If you just want to **use**
noggin, start at the root [README.md](README.md) instead.

## Repo layout

| Folder | Purpose |
|---|---|
| [`engine/`](engine/) | `@noggin/engine` — the engine source of truth. Data model + verbs (`noggin-api.mjs`), the file/memory providers, the YAML/JSON serializers, and the JSON schema. Host-agnostic; no CLI argv, no host UI. |
| [`cli/`](cli/) | The `noggin` CLI and the `noggin-mcp` MCP server. Thin clients of `@noggin/engine`. Houses the agent skill (`SKILL.md`) and human reference (`README.md`). Published to npm as `noggin-cli` (bundled bins in `dist/` produced at `prepack`). |
| [`plugin/`](plugin/) | The plugin distribution. Carries two manifests side-by-side: `plugin.json` for the VS Code agent-plugin loader (works in VS Code, GitHub Copilot CLI, Claude Code) and `.codex-plugin/plugin.json` for OpenAI Codex. Both point at the same synced copy of `engine/` + `cli/`. |
| [`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json) | The Codex marketplace manifest. Lets `codex plugin marketplace add dornstein/noggin` resolve to this repo and surface the plugin in the Codex plugin directory. |
| [`extension/`](extension/) | The VS Code extension. TypeScript host + React webview, plus a synced copy of `engine/` + `cli/`. Webview UI is built from `@noggin/ui`. |
| [`desktop/`](desktop/) | Standalone Electron + React desktop app. Imports the engine in-process via `desktop/skills/noggin/` (synced from `engine/`); no MCP / RPC. Renderer UI is built from `@noggin/ui`. Windows-first. |
| [`ui/`](ui/) | `@noggin/ui` — a workspace package of React components (Tree, Details, NoteEditor, QuickAdd, ContextMenu, Icon) shared by the extension webview and the desktop app. Pure presentation with handler props — no host APIs. Consumed via `file:` deps. |
| [`docs/`](docs/) | Documentation about the project itself. See [`docs/plans/`](docs/plans/) for historical design proposals. |
| [`scripts/sync-skill.mjs`](scripts/sync-skill.mjs) | Copies `engine/*` + `cli/*` into the consumer skill folders. Run after editing anything under `engine/` or `cli/`. CI rejects merges where the copies have drifted. |

## How the synced skill bundle works

`engine/` (engine source) and `cli/` (CLI + MCP source) are the source
of truth. The four consumer packages (`extension/skills/noggin/`,
`plugin/skills/noggin/`, `desktop/skills/noggin/`, and
`ui/skills/noggin/`) are **byte-identical** flat copies of those two
source roots, refreshed by [`scripts/sync-skill.mjs`](scripts/sync-skill.mjs).

The sync also produces two **self-contained `.bundle.mjs` files** in each
destination via esbuild:

- `noggin.bundle.mjs` — bundled CLI (entry: `cli/noggin.mjs`).
- `noggin-mcp.bundle.mjs` — bundled MCP server (entry: `cli/noggin-mcp.mjs`).

Each bundle inlines the MCP SDK, `js-yaml`, and the engine
(`noggin-api.mjs` + providers + serializers), so it runs with just
Node 20+ and no `npm install`. The plugin distribution
(`plugin/skills/noggin/`) ships those bundles to Codex and any other
host that loads the plugin folder as-is.

Workflow:

1. Edit something under `engine/` or `cli/` (e.g. add a verb, tweak
   the skill, fix a doc).
2. Run `node scripts/sync-skill.mjs` from the repo root.
3. Commit the changes (both the source edits and the synced copies).

The release pipeline and the CI workflow both run the sync script and
fail the build if the working tree shows drift after running it. So
even if you forget step 2 locally, you'll catch it before merging.

The synced files all start with an `<!-- AUTO-SYNCED FROM engine/… -->`
or `// AUTO-SYNCED FROM cli/…` banner. **Don't edit them directly** —
your edits will be overwritten the next time anyone runs the sync
script.

## Building

### CLI

```bash
cd cli
npm install
npm test            # node --check + 127-case golden suite
```

The CLI has zero build step — it's plain JS modules.

### Extension

```bash
cd extension
npm install
npm run build       # tsc (host) + esbuild (tree webview bundle)
npm run watch       # tsc watch mode for host changes
npm run watch:webview  # esbuild watch for tree-webview changes
npm run package     # syncs skills/, builds, runs vsce package → .vsix
```

The extension is a fully ESM VS Code extension (`"type": "module"`,
`moduleResolution: "Node16"`). The React tree view is bundled
separately by esbuild because tsc on its own can't bundle for a
browser-ish runtime.

To try a local change without publishing, build the .vsix and install
it with `code --install-extension extension/noggin-vscode-*.vsix`.

### Plugin

No build step. The plugin is the synced `skills/noggin/` directory
plus two manifests:

- `plugin/plugin.json` — VS Code agent-plugin format. Install via the
  Command Palette with `Chat: Install Plugin From Source` pointing at
  the repo.
- `plugin/.codex-plugin/plugin.json` — OpenAI Codex plugin format.
  Surfaced via [`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json)
  at the repo root; users install with
  `codex plugin marketplace add dornstein/noggin`.

Both manifests are hand-maintained — they're not generated. If you
change one (version bump, new `interface` field, etc.), consider
whether the other needs the same edit.

## Testing

```bash
cd cli
npm test            # 127 golden CLI tests, hits every verb + flag combo
```

The golden suite spawns the CLI as a subprocess and asserts on its
JSON / stderr / exit code. It's the safety net for refactors of the
underlying `noggin-api.mjs`; the API extraction (commits b57ceef →
a5ae7e7) was done test-first against this suite.

Extension changes don't have a runtime test suite. Smoke-test manually:

1. `npm run build` in `extension/`
2. Launch the extension via VS Code's F5 (the workspace ships
   [.vscode/launch.json](.vscode/launch.json) for this).
3. In the extension-host window, open a noggin and exercise tree DnD,
   the state-toggle icon, the details pane, and the cascade-close
   confirm.

## Architecture in one paragraph

`engine/noggin-api.mjs` is the source of truth for noggin's behaviour.
It exports stateless verb functions (`apiPush`, `apiAdd`, …) and a
`Noggin` class (cached store + file watcher + events). `cli/noggin.mjs`
is a thin CLI wrapper around `@noggin/engine`; `cli/noggin-mcp.mjs`
is the MCP server. The extension imports the same `noggin-api.mjs`
**in-process** (no child_process spawn) and exposes its verbs through
a `NogginHandle` that the tree webview, details webview, status bar,
and language model tools all read from. One code path; three surfaces.

For the detailed pre-implementation design, see
[`docs/plans/2026-06-api-extraction.md`](docs/plans/2026-06-api-extraction.md).

## Releasing

Releases are **unified and fully automated**. One source-of-truth
version lives in `cli/package.json`. Every push to `main` may bump
that version and publish **everything** at once: the VS Code
extension, the `noggin-cli` npm package, and a GitHub Release
tagged `v<X.Y.Z>` with the `.vsix` attached.

### The workflow

[`.github/workflows/release.yml`](.github/workflows/release.yml)
runs on every push to `main` and decides whether to release using
the rules below. When it does release:

1. Runs `node scripts/bump-version.mjs <kind>` to bump the unified
   version in `cli/package.json` and propagate it to
   `extension/package.json`, `plugin/plugin.json`,
   `plugin/.codex-plugin/plugin.json`, and both `package-lock.json`s.
2. Runs `node scripts/sync-skill.mjs` so the synced copies under
   `plugin/skills/noggin/` and `extension/skills/noggin/` and the
   `.bundle.mjs` artifacts all pick up the new version.
3. Smoke-tests both bundles.
4. Commits the bump (with `[skip release]` to break the loop), tags
   it `v<X.Y.Z>`, pushes both.
5. Builds + packages the `.vsix`, publishes to the VS Code Marketplace.
6. Publishes `noggin-cli` to npm (via OIDC Trusted Publishing — no
   token needed; the trust relationship is configured on npm against
   the workflow filename `release.yml`).
7. Creates a GitHub Release with the `.vsix` attached and links to
   both registries in the body.

### When does it actually release?

Whether a push triggers a release is decided in priority order:

1. **Loop guard.** Skip if the head commit is from `github-actions[bot]`
   (the workflow's own bump commit).
2. **Explicit opt-out.** Skip if the commit message contains
   `[skip release]`.
3. **Explicit opt-in.** Release if the commit message contains
   `[force release]` (overrides the path-allowlist check below).
4. **Path allowlist.** Skip if every changed file is in the
   non-shipping set; otherwise release.

The non-shipping set:

- `docs/**`, `memories/**`
- `README.md` (repo root)
- `CONTRIBUTING.md`
- `LICENSE`
- `CHANGELOG.md` *(deliberately non-shipping — release notes are
  edited as part of the same commit that bumps the version, not as
  standalone pushes)*
- `.github/**`, `.vscode/**`
- `.gitignore`, `.gitattributes`, `.editorconfig`, `.npmrc`,
  `.prettierrc*`, `.eslintrc*`

Anything outside that set — `cli/**`, `extension/**`, `plugin/**`,
`desktop/**`, `scripts/**` — is shipping and triggers a release.

### Why `main` is unprotected

The release workflow uses the default `GITHUB_TOKEN` (with
`permissions.contents: write`) to push its version-bump commit
directly to `main`. That means **the `main` branch ruleset must
not contain a `pull_request` or `required_status_checks` rule** —
both would reject the bot's push. The current ruleset on `main`
only enforces `deletion` and `non_fast_forward` (no force-push, no
branch deletion). CI still runs on every push and surfaces failures,
but it doesn't gate the push.

If you ever want PR-gated `main`, you'll need to swap the workflow
over to a fine-grained PAT stored as a secret (e.g. `RELEASE_PAT`)
and add that PAT's owner to the ruleset bypass list. The default
`GITHUB_TOKEN` can't be added as a bypass actor on a personal repo.

### Controlling the bump

Default behaviour is a **patch** bump. Override per commit by
including a marker in the commit message:

| Marker | Effect |
|---|---|
| `[minor]` | Bump the minor version (`0.4.x` → `0.5.0`) |
| `[major]` | Bump the major version (`0.x.y` → `1.0.0`) |
| `[release X.Y.Z]` | Set the version explicitly (e.g. `[release 1.0.0]`) |
| `[skip release]` | Don't release at all (use even when shipping paths changed but you don't want to publish) |
| `[force release]` | Release even if only non-shipping paths changed |

The bump-commit the workflow creates back-references itself with
`[skip release]` so it never re-triggers the workflow. GitHub Actions
also won't re-trigger workflows on commits authored by `GITHUB_TOKEN`,
so the loop is doubly guarded.

### Bumping the version locally (without releasing)

```bash
node scripts/bump-version.mjs                # print current
node scripts/bump-version.mjs patch          # 0.4.0 -> 0.4.1
node scripts/bump-version.mjs minor          # 0.4.0 -> 0.5.0
node scripts/bump-version.mjs 1.0.0          # explicit
node scripts/sync-skill.mjs                  # propagate to synced copies + bundles
```

Useful when you want to commit a manual version change inside a
larger commit, or to dry-run what the workflow would do.

### Typical flow

```bash
# Working on main directly
git add .
git commit -m "Polish details pane spacing"
git push origin main      # → workflow bumps patch, publishes everything
```

```bash
# Docs-only change — no release
git commit -m "Tighten README intro"
git push origin main      # → workflow skips (README is non-shipping)
```

```bash
# Big change worth a minor bump
git commit -m "Add `archive` verb [minor]"
git push origin main      # → workflow bumps 0.4.x -> 0.5.0
```

```bash
# Bigger change: minor bump
git commit -m "Add inline rename to tree rows [minor]"
git push origin main      # → 0.x.0 release
```

```bash
# Docs-only edit; don't burn a version
git commit -m "Fix typo in CHANGELOG [skip release]"
git push origin main
```

### Required secret

The release pipeline needs a repo secret named **`VSCE_PAT`** —
an Azure DevOps Personal Access Token with:

- Organization: **All accessible organizations** (Marketplace lives
  outside any single org)
- Scope: **Marketplace > Manage**

See https://aka.ms/vscodepat for the click path. Tokens expire on a
schedule you choose; when one does, regenerate and update the secret
at `Settings → Secrets and variables → Actions → VSCE_PAT`.

### From `vsce publish` to a user's update

- `vsce publish` returns in ~15s → the Marketplace has **accepted**
  the upload.
- Listing page CDN refreshes in **2-10 minutes** (sometimes 20-30).
- Users on auto-update pick up the new version within ~1 hour of the
  CDN refresh.

So worst case from `git push` to a user seeing the update is roughly
one hour.

### Things that can go wrong

- **Marketplace says "already exists".** You bumped to a version
  that's already published. Bump again.
- **PAT expired.** `vsce publish` fails with "Access Denied". Generate
  a new globally-scoped PAT and update the `VSCE_PAT` secret.
- **Ingestion delay.** Sometimes the publish succeeds but the new
  version doesn't appear in the gallery for 10-30 minutes. Wait it
  out — there's nothing to do.
- **Sync drift.** CI fails with "plugin/skills or extension/skills is
  out of sync". Run `node scripts/sync-skill.mjs` and commit.

## Releasing the CLI to npm

The `noggin-cli` npm package (the bare CLI plus the MCP server) ships
on a **manual** schedule — we don't want every doc edit to burn a
version. Trigger a release from the Actions tab.

### Triggering a release

1. Open the [`release-cli`](.github/workflows/release-cli.yml) workflow
   in the GitHub Actions UI.
2. Click **Run workflow**, pick `patch` / `minor` / `major`, and run.
3. The workflow runs the golden test suite, bumps `cli/package.json`,
   commits with `[skip release]` (so the extension pipeline doesn't
   also bump), tags `cli-vX.Y.Z`, pushes, and publishes to npm.
4. A GitHub Release is created with install instructions.

### Authentication: npm Trusted Publishing (OIDC)

There is **no `NPM_TOKEN` secret**. The workflow authenticates to npm
via OIDC: GitHub Actions mints a short-lived token at publish time,
npm validates it against a trust relationship configured on the
package itself. Benefits over a long-lived token:

- Nothing to rotate.
- Nothing to leak.
- npm auto-generates provenance attestations for each publish.

The trust relationship is configured at
[npmjs.com → noggin-cli → Settings → Trusted Publishers](https://www.npmjs.com/package/noggin-cli/access)
with the GitHub repo `dornstein/noggin` and workflow filename
`release-cli.yml`. **If the workflow file is ever renamed, the npm-side
config must be updated to match** — otherwise the publish step fails
with `ENEEDAUTH`.

The extension and CLI release workflows share a `release-any`
concurrency group, so they queue rather than race when both fire.

## Commit conventions

No strict convention. Reasonable advice:

- One concern per commit (refactor vs feature vs docs).
- First line a complete sentence, capitalised. Imperative tense
  preferred ("Add inline rename" not "Added inline rename").
- Body wraps at ~72 columns. Explain *why*, not what — the diff shows
  what.
- Use the `[minor]` / `[major]` / `[skip release]` markers (above) when
  you want non-default release behaviour.

## License

MIT. See [LICENSE](LICENSE). By contributing you agree that your
contributions are licensed under the same terms.
