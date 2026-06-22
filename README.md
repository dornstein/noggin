# noggin

A working-memory tree for in-flight work — your second brain for the
stuff you can't fit in your head.

**[Read the docs](https://dornstein.github.io/noggin/)** —
install, quickstart, CLI reference, JavaScript API, document schema,
response envelope, and a [live verb demo](https://dornstein.github.io/noggin/demo/)
showing every verb's human and JSON output side by side.

Items form a tree. There is at most one **active** item; the path from
a root to the active item is your current spine. Other open items are
paused. Done items stay in the tree so you can see what got finished.

```
[1📍] ship v1 of noggin
  [1✅] build a demo script
  [2✅] create a documentation file
  [3] perform final testing
  [4] create a PR
  [5] complete the PR
```

## Quick taste

```bash
$ noggin push "ship v1"
$ noggin add  "write the README"
$ noggin push "wire up tests"        # side-quest under ship v1
$ noggin note "tried jest, going with node:test"
$ noggin pop                         # finish the side-quest, back to ship v1
$ noggin show
[1📍] ship v1
  [1✅] wire up tests ✏️
  [2]   write the README
```

The CLI is the source of truth. Everything else (VS Code extension,
agent plugin, MCP server) wraps the same verbs.

## Where noggin runs

| Environment | Sidebar UI | Agent skill | Agent tools | Bare CLI |
|---|:---:|:---:|:---:|:---:|
| **VS Code** — Marketplace extension | ✓ | ✓ auto | ✓ LM tools (in-process) | ✓ |
| **VS Code** — agent plugin (no extension) | — | ✓ auto | — | ✓ |
| **GitHub Copilot CLI** ([`copilot`](https://github.com/github/copilot-cli), the agentic CLI — not `gh copilot`) | — | ✓ via plugin or manual | ✓ MCP | ✓ |
| **Claude Code** | — | ✓ via plugin or manual | ✓ MCP | ✓ |
| **OpenAI Codex** — CLI + app | — | ✓ via plugin | ✓ MCP | ✓ |
| **Any terminal** | — | — | — | ✓ |

The four experiences:

- **Sidebar UI** — the noggin tree with drag-and-drop, a details pane with inline-editable notes, and a status bar item for the active item. VS Code only.
- **Agent skill** — the behavioral guide ([`SKILL.md`](./cli/SKILL.md)) the LLM reads to decide when to `push`, `add`, `note`, etc. Loaded automatically wherever skills are supported.
- **Agent tools** — the 11 verbs exposed to the LLM as tools so it can invoke them directly. The VS Code extension uses in-process language-model tools; every other host uses the stdio MCP server.
- **Bare CLI** — `noggin push`, `noggin show`, etc., in any terminal. Always available; the YAML file is the source of truth.

## Install

Pick the environment you want.

### VS Code extension

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=davidorn.noggin-vscode).

You get a sidebar tree with drag-and-drop reordering, a details pane
with inline-editable notes, a status bar item showing the active item,
the agent skill loaded into Copilot Chat automatically, and
language-model tools (`#nogginPush`, `#nogginShow`, …) the agent can
call directly. See [`extension/README.md`](./extension/README.md) for the full feature list.

### Agent plugin (VS Code, GitHub Copilot CLI, Claude Code)

Install via the Command Palette:

```
> Chat: Install Plugin From Source
  https://github.com/dornstein/noggin.git
```

You get the agent skill plus the CLI. No UI — install the extension for that.

For hosts that load MCP servers explicitly rather than agent plugins
(GitHub Copilot CLI, Claude Code), see [`plugin/README.md`](./plugin/README.md#mcp-setup-other-hosts) — the recommended setup is `npx -y -p noggin-cli@latest noggin-mcp`.

> "GitHub Copilot CLI" here means the agentic [`copilot`](https://github.com/github/copilot-cli) CLI — not the older `gh copilot` extension to the `gh` command, which is just a shell-command suggester and doesn't load skills or MCP servers.

### OpenAI Codex

```
codex plugin marketplace add dornstein/noggin
```

Then `/plugins` in the Codex CLI (or the Plugins view in the Codex app),
pick **Noggin**, install. Bundles the skill, the CLI, and the MCP server.

### Bare CLI

```bash
npm install -g noggin-cli
noggin help

# or, ad-hoc:
npx -y -p noggin-cli noggin help
```

## Documentation

- [`cli/README.md`](./cli/README.md) — full user reference: mental model, path syntax, command reference, file schema, JSON output, invariants.
- [`cli/SKILL.md`](./cli/SKILL.md) — what the agent sees: when to use noggin, verb-selection table, behavioral protocol.
- [`extension/README.md`](./extension/README.md) — VS Code extension Marketplace listing.
- [`plugin/README.md`](./plugin/README.md) — agent plugin install and MCP setup.

## License

MIT. See [LICENSE](./LICENSE).

---

Working on noggin itself? See [CONTRIBUTING.md](./CONTRIBUTING.md) (build, test, release, architecture), [`CHANGELOG.md`](./CHANGELOG.md), and [`docs/plans/`](./docs/plans/) (historical design proposals).
