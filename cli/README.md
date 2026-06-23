# noggin

A working-memory tree for in-flight work — your second brain for
the stuff you can't fit in your head.

Items form a tree. There's at most one **active** item; the path
from a root to the active item is your current spine. Other open
items are paused. Done items stay in the tree under their parent
so you can see what got finished. Lives in `~/.noggin.yaml` by
default; the YAML file is the source of truth.

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

Agent-facing instructions live in [SKILL.md](SKILL.md). The TypeScript
declarations for the in-process API are in [noggin-api.d.mts](noggin-api.d.mts).

## Quick start

```bash
# Install the CLI (and the MCP server bin) globally
npm install -g noggin-cli

# Or run ad-hoc via npx
npx -y noggin-cli noggin push "ship v1"
npx -y noggin-cli noggin show
```

The package ships two bins:

- `noggin` — the working-memory tree CLI
- `noggin-mcp` — a stdio MCP server exposing the same verbs to
  agent hosts (Codex, Claude Code, GitHub Copilot CLI, VS Code MCP)

For MCP wire-up examples and host-specific config paths, see the
[MCP page](https://dornstein.github.io/noggin/mcp/) and the
[plugin distribution README](https://github.com/dornstein/noggin/blob/main/plugin/README.md).

## License

[MIT](LICENSE).
