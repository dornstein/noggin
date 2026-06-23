# noggin plugin

This folder is noggin's plugin distribution. It carries two manifests
side-by-side so the same skill + CLI can be loaded by two different
plugin ecosystems:

- [`plugin.json`](./plugin.json) — VS Code [agent-plugin](https://code.visualstudio.com/docs/agent-customization/agent-plugins) format. Works in VS Code, GitHub [`copilot`](https://github.com/github/copilot-cli) CLI, and Claude Code.
- [`.codex-plugin/plugin.json`](./.codex-plugin/plugin.json) — [OpenAI Codex](https://developers.openai.com/codex/plugins) plugin format. Works in the Codex CLI and Codex app.

Both manifests point at the same [`skills/noggin/`](./skills/noggin/)
directory, so behaviour is identical across hosts.

If you want VS Code-specific UI (status bar, tree view, language model
tools), install the [VS Code extension](../extension/) instead.

## Install in VS Code, GitHub Copilot CLI, or Claude Code

In VS Code, open the Command Palette and run:

```
Chat: Install Plugin From Source
```

Then enter:

```
https://github.com/dornstein/noggin.git
```

VS Code will clone the repo and load the plugin from this directory.

## Install in OpenAI Codex

Add the repo as a Codex marketplace, then install the plugin from it:

```
codex plugin marketplace add dornstein/noggin
```

Codex resolves that to [`.agents/plugins/marketplace.json`](../.agents/plugins/marketplace.json)
at the repo root, which lists noggin. Open `/plugins` in the Codex CLI
or the Plugins view in the Codex app, pick the **Noggin** marketplace,
and install.

## What you get

- The `noggin` skill, automatically loaded into Copilot Chat when relevant.
- The full CLI under `skills/noggin/noggin.mjs`, runnable directly with Node.
- A stdio **MCP server** (`skills/noggin/noggin-mcp.mjs`) that exposes the
  same verbs as `tools/call` actions. Codex auto-launches it from
  `.codex-plugin/plugin.json` → `.mcp.json`. For Claude Code / GitHub Copilot CLI,
  see [MCP setup](#mcp-setup-other-hosts) below.

The skill teaches the agent when and how to use noggin's `push`, `add`,
`goto`, `done`, `note`, `show`, `move`, and `edit` commands. Full
human reference is in [`skills/noggin/README.md`](./skills/noggin/README.md).

## MCP setup (other hosts)

The MCP server is a stdio process that reads JSON-RPC from stdin and
writes JSON-RPC to stdout. The easiest way to wire it into a host that
isn't a Codex plugin is via npx — no clone, no install, always the
latest version:

```jsonc
{
  "mcpServers": {
    "noggin": {
      "command": "npx",
      "args": ["-y", "-p", "noggin-cli@latest", "noggin-mcp"]
    }
  }
}
```

The `-p noggin-cli@latest` form is required because the `noggin-cli`
package ships two bins (`noggin` and `noggin-mcp`) — npx needs to be
told which package to load before it can run the right one.

Every tool call carries a required `noggin` parameter (a canonical
location string like `~/.noggin.yaml`, `./.noggin.yaml`, or
`file:///abs/path.yaml`) so one MCP server can serve multiple noggins
in the same session. There is no server-wide env-var fallback.

File locations vary by host — e.g. `~/.config/claude/claude_desktop_config.json`
for Claude Code, or `mcpServers` inside `~/.codex/config.toml` for Codex CLI.

### Local install (no npm)

If you'd rather not pull from npm — e.g. you cloned this repo to hack
on it — point the host at the bundled MCP server. The plugin
directory ships **self-contained `.bundle.mjs` files** that have all
dependencies (MCP SDK, `js-yaml`, `noggin-api.mjs`, backends) inlined,
so they run with just Node 20+ and no `npm install`:

```jsonc
{
  "mcpServers": {
    "noggin": {
      "command": "node",
      "args": ["/absolute/path/to/noggin/plugin/skills/noggin/noggin-mcp.bundle.mjs"]
    }
  }
}
```

The sibling [`noggin.bundle.mjs`](./skills/noggin/) is the same idea
for the bare CLI — use it directly:

```
node /absolute/path/to/noggin/plugin/skills/noggin/noggin.bundle.mjs show
```

The unbundled `noggin.mjs` / `noggin-mcp.mjs` are present too but they
import `js-yaml` and the MCP SDK from `node_modules`, which the plugin
folder doesn't ship. Use them only if you `npm install` inside `cli/`
first.

The MCP server exposes the same 11 verbs as the VS Code extension's
language-model tools (`noggin_push`, `noggin_add`, `noggin_show`, …)
and returns the same canonical JSON envelope as the CLI.

## Structure

```
plugin/
├── plugin.json                 # VS Code agent-plugin manifest
├── .codex-plugin/
│   └── plugin.json             # OpenAI Codex plugin manifest
├── .mcp.json                   # MCP server config (consumed by Codex)
└── skills/
    └── noggin/                  # mirrors ../../cli/ — synced at build time
        ├── SKILL.md
        ├── README.md
        ├── noggin.bundle.mjs     # SELF-CONTAINED CLI (this is what plugin hosts run)
        ├── noggin-mcp.bundle.mjs # SELF-CONTAINED MCP server (this is what Codex launches)
        ├── noggin.mjs            # unbundled CLI source (needs npm install in cli/)
        ├── noggin-mcp.mjs        # unbundled MCP server source (needs npm install in cli/)
        ├── noggin-api.mjs        # typed in-process API
        ├── noggin-api.d.mts      # TypeScript declarations for the API
        ├── backends/             # opener registry (file://)
        ├── serializers/          # YAML and JSON document codecs
        └── package.json
```

The `skills/noggin/` directory is a synced copy of [`../cli/`](../cli/) —
the CLI directory is the source of truth. See [CONTRIBUTING.md](../CONTRIBUTING.md)
for how the sync works.
