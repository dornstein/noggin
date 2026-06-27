// Generate the MCP reference page from mcp/noggin-mcp.mjs. We import the
// module's `TOOLS` array directly so the generated page can never drift
// from the running server. The server's stdio transport is guarded behind
// a main-only check, so this import does not spawn anything.

import { esc } from '../template.mjs';
import { TOOLS } from '../../../mcp/noggin-mcp.mjs';

export function buildMcpPage() {
  const intro = `
<h1>MCP server</h1>
<p class="lead">noggin ships a <a href="https://modelcontextprotocol.io/">Model
Context Protocol</a> server (<code>noggin-mcp</code>) that exposes the
same verbs the VS Code extension's language-model tools do. Hosts that
can't see in-process LM tools — GitHub Copilot CLI, Claude Code, OpenAI
Codex — spawn this stdio server to get a complete noggin toolset for the
agent.</p>

<h2>What it is</h2>

<p>A single Node 20+ binary, <code>noggin-mcp</code>, that:</p>
<ul>
  <li>Speaks MCP over stdio (one request per line of JSON, MCP framing).</li>
  <li>Routes every tool call to the noggin named in the call's required
    <code>noggin</code> parameter (a canonical location string like
    <code>~/.noggin.yaml</code>, <code>./.noggin.yaml</code>, or
    <code>file:///abs/path.yaml</code>). One server can drive multiple
    noggins in a single session; there is no server-wide default.</li>
  <li>Embeds the same <code>@noggin/engine</code> the CLI, VS Code
    extension, and desktop app use, so it shares the file watcher, the
    per-process verb queue, and the cross-process advisory file lock.</li>
  <li>Wraps every result in the canonical
    <a href="../envelope/">response envelope</a> — the same shape the CLI
    emits under <code>--json</code> and the same shape the VS Code LM
    tools return.</li>
</ul>

<p>It ships three ways:</p>
<ul>
  <li>As a dedicated <strong>npm package</strong>,
    <a href="https://www.npmjs.com/package/noggin-mcp"><code>noggin-mcp</code></a>,
    that exposes a single bin of the same name. The usual
    <code>npx -y noggin-mcp@latest</code> idiom just works.</li>
  <li>Bundled inside the <strong>agent plugin</strong>
    (<code>plugin/skills/noggin/noggin-mcp.bundle.mjs</code>) for hosts
    that load plugins without running <code>npm install</code> (OpenAI
    Codex).</li>
  <li>Bundled inside the <strong>VS Code extension</strong>
    (<code>extension/skills/noggin/noggin-mcp.bundle.mjs</code>), where
    the extension itself prefers in-process LM tools but the bundled
    server is available for external clients in the same workspace.</li>
</ul>

<h2>Choosing the right surface</h2>

<table>
  <thead><tr><th>Host</th><th>Use</th></tr></thead>
  <tbody>
    <tr><td>VS Code (with the noggin extension)</td>
        <td>In-process language-model tools — no MCP needed.</td></tr>
    <tr><td>GitHub Copilot CLI (<code>copilot</code>)</td>
        <td>MCP server, configured under <code>mcpServers</code>.</td></tr>
    <tr><td>Claude Code</td>
        <td>MCP server, configured in the host's MCP config.</td></tr>
    <tr><td>OpenAI Codex CLI / app</td>
        <td>MCP server, auto-launched by the agent plugin.</td></tr>
    <tr><td>VS Code without the noggin extension</td>
        <td>MCP server, declared in <code>.vscode/mcp.json</code>.</td></tr>
  </tbody>
</table>

<h2>Wire it up</h2>

<p>Most hosts share the same <code>mcpServers</code> shape. The
recommended form pulls the latest release straight from npm — no clone,
no install:</p>

<pre><code class="language-jsonc">{
  "mcpServers": {
    "noggin": {
      "command": "npx",
      "args": ["-y", "noggin-mcp@latest"]
    }
  }
}</code></pre>

<p>The <code>noggin-mcp</code> npm package ships a single bin of the
same name, so <code>npx -y noggin-mcp@latest</code> resolves to the
right executable with no extra hints.</p>

<p>File locations vary by host:</p>
<ul>
  <li><strong>GitHub Copilot CLI</strong> — <code>~/.copilot/mcp-config.json</code>
    (or your platform's equivalent under <code>$XDG_CONFIG_HOME</code>).</li>
  <li><strong>Claude Code</strong> — <code>~/.config/claude/claude_desktop_config.json</code>
    on macOS/Linux,
    <code>%APPDATA%\\Claude\\claude_desktop_config.json</code> on Windows.</li>
  <li><strong>OpenAI Codex CLI</strong> — an <code>[mcp_servers.noggin]</code>
    block in <code>~/.codex/config.toml</code>. The
    <a href="../install/">noggin plugin</a> wires this for you when
    installed through the marketplace.</li>
  <li><strong>VS Code</strong> (without the noggin extension) —
    <code>.vscode/mcp.json</code> in the workspace, with the
    <code>servers</code> top-level key.</li>
</ul>

<h3>Local install (no npm)</h3>

<p>If you've cloned this repo to hack on it, point the host at the file
directly:</p>

<pre><code class="language-jsonc">{
  "mcpServers": {
    "noggin": {
      "command": "node",
      "args": ["/absolute/path/to/noggin/mcp/noggin-mcp.mjs"]
    }
  }
}</code></pre>

<p>Run <code>npm install</code> once inside <code>mcp/</code> first, to
pull in the MCP SDK and the workspace-linked <code>@noggin/engine</code>.</p>

<h2>Tools</h2>

<p>The server exposes ${TOOLS.length} tools. Each one mirrors a CLI verb
and returns the same <a href="../envelope/">response envelope</a>; the
agent sees a single canonical JSON shape regardless of which tool it
calls.</p>
`;

  const toolList = TOOLS.map(renderTool).join('\n');

  const footer = `
<h2>Response shape</h2>

<p>Every tool returns the canonical <a href="../envelope/">response
envelope</a> as the text content of its MCP result. On success:</p>

<pre><code class="language-jsonc">{
  "status": "ok",
  "envelopeVersion": 3,
  "verb": "push",
  "data": { /* CurrentTreeView, DeleteResult, ... */ }
}</code></pre>

<p>On failure the MCP result is marked <code>isError: true</code> and the
text content carries an error envelope with a stable
<a href="../api/#type-nogginerrorcode"><code>error.code</code></a>.</p>

<h2>Related</h2>

<ul>
  <li><a href="../cli/">CLI reference</a> — same verbs, different surface.</li>
  <li><a href="../envelope/">Response envelope</a> — the JSON wrapper every tool returns.</li>
  <li><a href="../api/">JavaScript API</a> — the in-process engine the server uses.</li>
  <li><a href="https://github.com/dornstein/noggin/blob/main/engine/SKILL.md">Skill spec</a> —
    what the agent reads to decide when to call these tools.</li></li>
</ul>
`;

  return intro + toolList + footer;
}

function renderTool(tool) {
  const id = `tool-${slugify(tool.name)}`;
  const propsHtml = renderProperties(tool.inputSchema);
  return `
<div class="entry" id="${esc(id)}">
  <div class="meta-row">
    <span class="name"><code>${esc(tool.name)}</code></span>
  </div>
  <p>${esc(tool.description || '')}</p>
  ${propsHtml}
</div>`;
}

function renderProperties(schema) {
  const props = schema && schema.properties ? schema.properties : {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  const names = Object.keys(props);
  if (names.length === 0) {
    return `<p class="muted"><em>No parameters.</em></p>`;
  }
  const rows = names.map((name) => {
    const p = props[name] || {};
    const type = formatType(p.type);
    const req = required.has(name) ? ' <span class="pill experimental">required</span>' : '';
    const desc = p.description ? esc(p.description) : '';
    const enumNote = Array.isArray(p.enum) && p.enum.length > 0
      ? ` <span class="muted">(one of: ${p.enum.map((v) => `<code>${esc(String(v))}</code>`).join(', ')})</span>`
      : '';
    return `<tr><td><code>${esc(name)}</code>${req}</td><td><code>${esc(type)}</code></td><td>${desc}${enumNote}</td></tr>`;
  }).join('');
  return `
<table class="params">
  <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function formatType(t) {
  if (Array.isArray(t)) return t.join(' | ');
  if (typeof t === 'string') return t;
  return 'any';
}

function slugify(s) {
  return s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}
