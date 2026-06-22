---
title: Quickstart
slug: "quickstart/"
---

# Quickstart

Pick the environment you're going to use noggin in. The same noggin
file (and the same items inside it) works across all of them — they're
different *experiences* over the same data, not different products.

<div class="card-grid">
  <a class="card" href="vscode/">
    <h3>VS Code</h3>
    <p>Sidebar tree, drag-and-drop, inline note editor, Copilot Chat integration. The richest experience.</p>
  </a>
  <a class="card" href="agent/">
    <h3>Talk to your agent</h3>
    <p>Use noggin through GitHub Copilot Chat, Claude Code, OpenAI Codex — the agent picks the verbs for you.</p>
  </a>
  <a class="card" href="cli/">
    <h3>Bare CLI</h3>
    <p>Drive noggin from your terminal with <code>noggin push</code>, <code>noggin show</code>, etc.</p>
  </a>
  <a class="card" href="api/">
    <h3>JavaScript / Node</h3>
    <p>Embed noggin in your own tool. <code>fileNoggin()</code>, verb methods, events, serializers.</p>
  </a>
</div>

## What they all have in common

- Items form a **tree**. Each item has a title, a done flag, a
  created-at timestamp, and append-only notes.
- At most one item is **active** — that's your current spine through
  the tree.
- The same on-disk file (YAML by default) backs every experience, so
  you can drive noggin from the sidebar in one window and the CLI in
  another and they'll stay in sync.

If you're not sure which to pick, the [VS Code](vscode/) experience is
the most discoverable; the [agent](agent/) experience is the most
ergonomic if you spend your day in a chat window already.
