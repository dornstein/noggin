# noggin-mcp

A stdio [Model Context Protocol](https://modelcontextprotocol.io/) server
that exposes the [noggin](https://dornstein.github.io/noggin/) working-memory
tree to MCP-capable agent hosts: Claude Code, Codex CLI, GitHub Copilot CLI,
Cursor, and VS Code (via `.vscode/mcp.json`).

The CLI lives in a separate package: [`noggin-cli`](https://www.npmjs.com/package/noggin-cli).

---

## Install

```bash
# Global
npm install -g noggin-mcp

# Or run ad-hoc via npx — recommended for MCP host configs
npx -y noggin-mcp@latest
```

The package ships one bin, `noggin-mcp`, that speaks JSON-RPC over stdio.

## Host wire-up

Every tool call requires a `noggin` parameter — the canonical location of the
noggin to operate on (e.g. `~/.noggin.yaml`, `./.noggin.yaml`,
`file:///abs/path.yaml`). No environment-variable default; agents pass the
location with every call so one session can drive multiple noggins.

### Claude Code / generic `mcpServers` config

```jsonc
{
  "mcpServers": {
    "noggin": {
      "command": "npx",
      "args": ["-y", "noggin-mcp@latest"]
    }
  }
}
```

### VS Code (`.vscode/mcp.json`)

```jsonc
{
  "servers": {
    "noggin": {
      "command": "npx",
      "args": ["-y", "noggin-mcp@latest"]
    }
  }
}
```

### Codex CLI / packaged plugin

The [noggin Codex plugin](https://github.com/dornstein/noggin/tree/main/plugin)
ships a self-contained bundle (`noggin-mcp.bundle.mjs`) so `npx` isn't
required at runtime. See the plugin README for details.

## Tools

The server exposes one MCP tool per noggin verb (`noggin_push`, `noggin_add`,
`noggin_goto`, `noggin_done`, `noggin_pop`, `noggin_edit`, `noggin_note`,
`noggin_move`, `noggin_delete`, `noggin_show`, `noggin_where`, `noggin_copy`,
`noggin_providers`). The generated tool reference, including each tool's
JSON-Schema input shape, lives at
[dornstein.github.io/noggin/mcp/](https://dornstein.github.io/noggin/mcp/).

For the agent-facing protocol — when to invoke which verb, how to read the
response envelope — see the [SKILL.md](https://github.com/dornstein/noggin/blob/main/engine/SKILL.md)
shipped with every noggin distribution.

## License

[MIT](LICENSE).
