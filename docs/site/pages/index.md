---
title: noggin
slug: ""
---

<div class="hero">
  <h1>noggin</h1>
  <p>A working-memory tree for in-flight work — your second brain for the stuff you can't fit in your head.</p>
  <a class="cta" href="quickstart/">Get started</a>
</div>

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

The CLI is the source of truth. Everything else — VS Code extension,
agent plugin, MCP server — wraps the same verbs.

## Where noggin runs

| Environment | Sidebar UI | Agent skill | Agent tools | Bare CLI |
|---|:---:|:---:|:---:|:---:|
| **VS Code** — Marketplace extension | <span class="yes">✓</span> | <span class="yes">✓</span> auto | <span class="yes">✓</span> LM tools (in-process) | <span class="yes">✓</span> |
| **Desktop app** — standalone Windows app | <span class="yes">✓</span> | <span class="no">—</span> | <span class="no">—</span> | <span class="yes">✓</span> |
| **VS Code** — agent plugin (no extension) | <span class="no">—</span> | <span class="yes">✓</span> auto | <span class="no">—</span> | <span class="yes">✓</span> |
| **GitHub Copilot CLI** (`copilot`) | <span class="no">—</span> | <span class="yes">✓</span> via plugin or manual | <span class="yes">✓</span> MCP | <span class="yes">✓</span> |
| **Claude Code** | <span class="no">—</span> | <span class="yes">✓</span> via plugin or manual | <span class="yes">✓</span> MCP | <span class="yes">✓</span> |
| **OpenAI Codex** — CLI + app | <span class="no">—</span> | <span class="yes">✓</span> via plugin | <span class="yes">✓</span> MCP | <span class="yes">✓</span> |
| **Any terminal** | <span class="no">—</span> | <span class="no">—</span> | <span class="no">—</span> | <span class="yes">✓</span> |

The four experiences:

- **Sidebar UI** — the noggin tree with drag-and-drop and a details
  pane with inline-editable notes. VS Code adds a status bar item for
  the active item; the [desktop app](quickstart/desktop/) adds a
  sidebar that can list more than one noggin at once. Both share the
  same `@noggin/ui` components, so the interactions are identical.
- **Agent skill** — the behavioral guide
  ([`SKILL.md`](https://github.com/dornstein/noggin/blob/main/engine/SKILL.md))
  the LLM reads to decide when to `push`, `add`, `note`, etc. Loaded
  automatically wherever skills are supported.
- **Agent tools** — the verbs exposed to the LLM as tools so it can
  invoke them directly. The VS Code extension uses in-process
  language-model tools; every other host uses the stdio
  [MCP server](mcp/).
- **Bare CLI** — `noggin push`, `noggin show`, etc., in any terminal.
  Always available; the YAML file is the source of truth.

## Explore

<div class="card-grid">
  <a class="card" href="quickstart/"><h3>Quickstart</h3><p>Pick your environment, install it, and make your first noggin in five minutes.</p></a>
  <a class="card" href="cli/"><h3>CLI reference</h3><p>Every verb, every flag, generated from the binary.</p></a>
  <a class="card" href="demo/"><h3>Verb demo</h3><p>Side-by-side human vs JSON output, real CLI runs.</p></a>
  <a class="card" href="api/"><h3>JavaScript API</h3><p>Embedding noggin in Node — Noggin class, pure functions, serializers.</p></a>
  <a class="card" href="mcp/"><h3>MCP server</h3><p>Tools the agent sees in Copilot CLI, Claude Code, and Codex — the same verbs over stdio.</p></a>
  <a class="card" href="schema/"><h3>Document schema</h3><p>The NogginDocument shape, formal JSON Schema, field semantics.</p></a>
  <a class="card" href="envelope/"><h3>Response envelope</h3><p>JSON wrapper around CLI / MCP / LM tool responses.</p></a>
</div>
