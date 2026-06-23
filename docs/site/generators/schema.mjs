// Generate the Document schema page from noggin.schema.json.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { esc } from '../template.mjs';

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..', '..');

export function buildSchemaPage() {
  const schemaPath = path.join(repoRoot, 'noggin.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

  const intro = `
<h1>Document schema</h1>
<p class="lead">A noggin's serialized form — the YAML or JSON payload
that backends read and write. The same JSON Schema validates both
encodings because YAML 1.2 is a JSON superset.</p>

<p>The canonical machine-readable file lives at
<a href="https://dornstein.github.io/noggin/noggin.schema.json">
<code>noggin.schema.json</code></a>. The page below is generated
from it on every build.</p>

<h2>Use it in VS Code</h2>
<p>Install the Red Hat YAML extension and add to your settings:</p>
<pre><code class="language-jsonc">"yaml.schemas": {
  "https://dornstein.github.io/noggin/noggin.schema.json": [
    ".noggin.yaml",
    "**/.noggin/*.yaml"
  ]
}</code></pre>

<h2>Top-level shape</h2>
<p>${esc(schema.description || '')}</p>
${renderObject(schema, { showHeader: false })}

<h2>Definitions</h2>
${Object.entries(schema.$defs || {}).map(([name, def]) => renderDef(name, def)).join('')}

<h2>Invariants beyond the schema</h2>
<p>JSON Schema can describe shapes; it can't express referential
integrity. The engine enforces these additional rules on every save:</p>
<ol>
  <li>Every item has a unique <code>key</code>.</li>
  <li>Every non-null <code>parentKey</code> references an existing item.</li>
  <li><code>active</code>, if non-null, references an existing item.</li>
  <li>Done items remain in the tree (they're not deleted) and can be
  reverted with <code>edit --open</code>.</li>
  <li>A done item may have open descendants only when it was closed
  with <code>--force</code>. The standard close paths
  (<code>done</code>, <code>pop</code>, <code>edit --done</code>
  without flags, or with <code>--close-all</code>) preserve the
  stronger invariant "done items have no open descendants."</li>
</ol>

<h2>Example</h2>
<pre><code class="language-yaml">schemaVersion: 1
active: i-20260616-184644-f04bf5
items:
  - key: i-20260616-184644-f04bf5
    parentKey: null
    title: ship the redesign
    done: false
    createdAt: '2026-06-16T18:46:44.071Z'
    notes:
      - timestamp: '2026-06-16T18:46:45.625Z'
        text: 'found the storage abstraction in tableStorageService'
  - key: i-20260616-185011-300abc
    parentKey: i-20260616-184644-f04bf5
    title: write the spec
    done: true
    createdAt: '2026-06-16T18:50:11.000Z'
    notes:
      - timestamp: '2026-06-16T18:50:11.300Z'
        text: closed</code></pre>
`;

  return intro;
}

function renderObject(obj, opts = {}) {
  const { showHeader = true } = opts;
  const required = new Set(obj.required || []);
  const props = obj.properties || {};
  if (Object.keys(props).length === 0) return '';

  let html = '';
  if (showHeader) {
    html += `<table>
      <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
      <tbody>`;
  } else {
    html = `<table>
      <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
      <tbody>`;
  }
  for (const [name, prop] of Object.entries(props)) {
    const req = required.has(name) ? ' <em>(required)</em>' : '';
    html += `<tr>
      <td><code>${esc(name)}</code>${req}</td>
      <td>${renderType(prop)}</td>
      <td>${esc(prop.description || '')}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  return html;
}

function renderDef(name, def) {
  const heading = `<h3 id="def-${esc(name)}"><code>${esc(name)}</code></h3>`;
  const blurb = def.description ? `<p>${esc(def.description)}</p>` : '';
  if (def.type === 'object') {
    return heading + blurb + renderObject(def);
  }
  // Scalar / aliased type.
  let info = `<p><strong>Type:</strong> ${renderType(def)}</p>`;
  if (def.format) info += `<p><strong>Format:</strong> <code>${esc(def.format)}</code></p>`;
  if (def.pattern) info += `<p><strong>Pattern:</strong> <code>${esc(def.pattern)}</code></p>`;
  if (typeof def.minLength === 'number') {
    info += `<p><strong>Min length:</strong> ${def.minLength}</p>`;
  }
  return heading + blurb + info;
}

function renderType(prop) {
  if (prop.const !== undefined) return `<code>${esc(JSON.stringify(prop.const))}</code> (const)`;
  if (prop.$ref) {
    const name = prop.$ref.replace(/^#\/\$defs\//, '');
    return `<a href="#def-${esc(name)}"><code>${esc(name)}</code></a>`;
  }
  if (prop.oneOf) {
    return prop.oneOf.map(renderType).join(' <span class="muted">|</span> ');
  }
  if (prop.anyOf) {
    return prop.anyOf.map(renderType).join(' <span class="muted">|</span> ');
  }
  if (prop.type === 'array') {
    return `Array&lt;${renderType(prop.items || {})}&gt;`;
  }
  if (prop.type === 'null') return '<code>null</code>';
  if (Array.isArray(prop.type)) {
    return prop.type.map((t) => `<code>${esc(t)}</code>`).join(' | ');
  }
  if (prop.type) return `<code>${esc(prop.type)}</code>`;
  return '<span class="muted">any</span>';
}
