# noggin-cli

A working-memory tree for in-flight work — your second brain for
the stuff you can't fit in your head.

Items form a tree. There's at most one **active** item; the path
from a root to the active item is your current spine. Other open
items are paused. Done items stay in the tree under their parent
so you can see what got finished. Lives in `~/.noggin.yaml` by
default; the YAML file is the source of truth.

This package is the **CLI**. The stdio MCP server for agent hosts
lives in a separate package, [`noggin-mcp`](https://www.npmjs.com/package/noggin-mcp).

---

## 📖 Full docs

This README is intentionally short. Everything else lives on the
**[noggin docs site](https://dornstein.github.io/noggin/)**:

- **[Install](https://dornstein.github.io/noggin/install/)** — VS Code extension, agent plugin (Codex / Claude Code / GitHub Copilot CLI), bare CLI
- **[CLI reference](https://dornstein.github.io/noggin/cli/)** — every verb, every flag, generated from the binary
- **[Verb demo](https://dornstein.github.io/noggin/demo/)** — side-by-side human vs JSON output, real CLI runs
- **[MCP server](https://dornstein.github.io/noggin/mcp/)** — tools the agent sees over stdio
- **[Document schema](https://dornstein.github.io/noggin/schema/)** — the `NogginDocument` shape and invariants
- **[Response envelope](https://dornstein.github.io/noggin/envelope/)** — JSON wrapper around every CLI / MCP / LM-tool response
- **[Playground](https://dornstein.github.io/noggin/playground/)** — try noggin in your browser, no install

Agent-facing instructions live in the [SKILL.md](https://github.com/dornstein/noggin/blob/main/engine/SKILL.md)
shipped with every noggin distribution.

## Quick start

```bash
# Install the CLI globally
npm install -g noggin-cli

# Or run ad-hoc via npx
npx -y noggin-cli noggin push "ship v1"
npx -y noggin-cli noggin show
```

The package ships one bin, `noggin`. For the MCP server, install
[`noggin-mcp`](https://www.npmjs.com/package/noggin-mcp) separately.

## License

[MIT](LICENSE).

