// Generate the JavaScript API reference from the hand-written .d.mts
// files. Not a full TypeScript parser — just regex-based extraction
// of top-level declarations and their leading TSDoc comments. That's
// enough because we own the file format: hand-written, top-level
// exports only, no nested namespaces.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { esc } from '../template.mjs';

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..', '..');

const SOURCES = [
  {
    label: 'noggin-api',
    file: path.join(repoRoot, 'cli', 'noggin-api.d.mts'),
    description: 'The engine: data model, pure verb functions, Noggin class, error types, response envelope.',
  },
  {
    label: 'backends/file',
    file: path.join(repoRoot, 'cli', 'backends', 'file.d.mts'),
    description: 'The file backend. <code>fileNoggin()</code> is the canonical way to open a noggin from Node.',
  },
  {
    label: 'serializers/yaml',
    file: path.join(repoRoot, 'cli', 'serializers', 'yaml.d.mts'),
    description: 'Pure YAML &harr; NogginDocument converters.',
  },
  {
    label: 'serializers/json',
    file: path.join(repoRoot, 'cli', 'serializers', 'json.d.mts'),
    description: 'Pure JSON &harr; NogginDocument converters.',
  },
];

const TIER_RANK = { public: 0, experimental: 1, deprecated: 2, internal: 3, untagged: 4 };

export function buildApiPage() {
  const intro = `
<h1>JavaScript API</h1>
<p class="lead">For consumers embedding noggin in a Node process (the
VS Code extension, custom tooling, tests). All public symbols are
tagged with TSDoc release tags so breaking changes can be tracked.</p>

<h2>Tiers</h2>
<table>
  <thead><tr><th>Tag</th><th>What it means</th></tr></thead>
  <tbody>
    <tr><td><span class="pill public">public</span></td>
        <td>Stable contract. Breaking changes require a major bump.</td></tr>
    <tr><td><span class="pill experimental">experimental</span></td>
        <td>Public but the shape may still change.</td></tr>
    <tr><td><span class="pill deprecated">deprecated</span></td>
        <td>Still works; scheduled for removal in a future major.</td></tr>
  </tbody>
</table>
<p class="muted">Symbols tagged <code>@internal</code> exist in the
source but are deliberately hidden from this reference — they're
implementation detail, not contract.</p>

<h2>Quick example</h2>
<pre><code class="language-js">import { openNoggin, verbs } from 'noggin-cli/noggin-api.mjs';
import 'noggin-cli/backends/file.mjs'; // side-effect: registers file://

const noggin = await openNoggin('/path/to/.noggin.yaml', { watch: true });
const view = await verbs.push(noggin, { title: 'go async' });
console.log(noggin.active?.title);
noggin.onDidChange(() =&gt; render(noggin.items));
await noggin.dispose();</code></pre>

<p>Verbs are pure functions over a <code>Noggin</code>: they read state
via the noggin's accessors, compose an <code>AtomicOp[]</code>, and call
<code>noggin.apply(ops)</code> once. The file backend serializes
per-instance calls through an internal queue; cross-process callers
are protected by an advisory file lock.</p>
`;

  const moduleSections = SOURCES.map(renderModule).join('\n');

  return intro + moduleSections;
}

function renderModule({ label, file, description }) {
  const src = readFileSync(file, 'utf8');
  const allDecls = parseDeclarations(src);
  // Hide @internal and untagged entries from the public docs. They're
  // implementation detail; consumers should rely only on tagged
  // @public / @experimental / @deprecated symbols.
  const decls = allDecls.filter((d) => d.tier === 'public' || d.tier === 'experimental' || d.tier === 'deprecated');
  const hiddenCount = allDecls.length - decls.length;
  decls.sort((a, b) => {
    const t = (TIER_RANK[a.tier] || 99) - (TIER_RANK[b.tier] || 99);
    if (t !== 0) return t;
    return a.name.localeCompare(b.name);
  });

  const kindOrder = ['const', 'class', 'function', 'interface', 'type'];
  const grouped = {};
  for (const k of kindOrder) grouped[k] = [];
  for (const d of decls) {
    (grouped[d.kind] || (grouped[d.kind] = [])).push(d);
  }

  let body = `<h2 id="mod-${esc(slugify(label))}"><code>${esc(label)}</code></h2>`;
  body += `<p>${description}</p>`;
  if (decls.length === 0) {
    body += `<p class="muted">No public exports.</p>`;
    return body;
  }
  for (const kind of kindOrder) {
    if (!grouped[kind] || grouped[kind].length === 0) continue;
    body += `<h3>${kindLabel(kind)}</h3>`;
    body += grouped[kind].map(renderDecl).join('');
  }
  if (hiddenCount > 0) {
    body += `<p class="muted"><em>${hiddenCount} internal symbol${hiddenCount === 1 ? '' : 's'} hidden.</em> Consumers should not depend on internal exports; they may change without notice.</p>`;
  }
  return body;
}

function kindLabel(kind) {
  switch (kind) {
    case 'const': return 'Constants';
    case 'function': return 'Functions';
    case 'class': return 'Classes';
    case 'interface': return 'Interfaces';
    case 'type': return 'Type aliases';
    default: return kind;
  }
}

function renderDecl(d) {
  const id = `${d.kind}-${slugify(d.name)}`;
  const pill = d.tier === 'untagged' ? '' : `<span class="pill ${d.tier}">${d.tier}</span>`;
  const deprecatedNote = d.deprecated ? `<p class="muted"><strong>Deprecated.</strong> ${esc(d.deprecated)}</p>` : '';
  return `
<div class="entry" id="${esc(id)}">
  <div class="meta-row">
    <span class="name">${esc(d.name)}</span>
    ${pill}
  </div>
  <pre class="sig">${esc(d.signature.trim())}</pre>
  ${d.description ? `<div class="desc">${tsdocToHtml(d.description)}</div>` : ''}
  ${deprecatedNote}
</div>`;
}

function slugify(s) {
  return s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

// ── TSDoc / declaration parser ──────────────────────────────────────────────

/**
 * Parse a .d.mts file into a list of top-level export declarations.
 *
 * Each result has:
 *   - name        identifier
 *   - kind        'const' | 'function' | 'class' | 'interface' | 'type'
 *   - signature   the literal declaration text (without leading comments)
 *   - tier        'public' | 'experimental' | 'deprecated' | 'internal' | 'untagged'
 *   - description prose description from the TSDoc (or '')
 *   - deprecated  the @deprecated body, if any
 */
function parseDeclarations(src) {
  const results = [];
  // Greedy walk: find each `export ...` keyword at start of line and
  // grab everything from there to the matching closing brace (for
  // interfaces/classes) or semicolon (for everything else). The
  // preceding TSDoc comment (if any) goes with it.

  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^export (const|function|class|interface|type|abstract class) (\w+)/);
    if (!m) continue;

    // Walk backward for the leading TSDoc block (/** ... */) immediately
    // above this declaration, separated only by whitespace.
    const doc = readTsdocAbove(lines, i);

    // Read the declaration body forward until we hit a balanced
    // closing brace at column 0 (interfaces, classes), or a line
    // ending in `;` at column 0 (const, function, type).
    const { decl, end } = readDeclaration(lines, i, m[1]);
    i = end;

    const kind = m[1] === 'abstract class' ? 'class' : m[1];
    results.push({
      name: m[2],
      kind,
      signature: decl,
      tier: doc.tier,
      description: doc.description,
      deprecated: doc.deprecated,
    });
  }
  return results;
}

function readTsdocAbove(lines, idx) {
  // Walk backward, skipping blank lines, until we find a line ending
  // with `*/`. If found, walk further back to the matching `/**` and
  // parse the body. Otherwise return an empty doc block.
  let i = idx - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0 || !lines[i].trimEnd().endsWith('*/')) {
    return { tier: 'untagged', description: '', deprecated: null };
  }
  const end = i;
  while (i >= 0 && !lines[i].trim().startsWith('/**')) i--;
  if (i < 0) return { tier: 'untagged', description: '', deprecated: null };
  const block = lines.slice(i, end + 1).join('\n');
  return parseTsdocBlock(block);
}

function parseTsdocBlock(block) {
  // Strip `/**`, `*/`, leading `*`.
  const cleaned = block
    .replace(/^\s*\/\*\*\s*/, '')
    .replace(/\s*\*\/\s*$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, ''))
    .join('\n')
    .trim();

  let tier = 'untagged';
  let description = '';
  let deprecated = null;

  // Split on `@tag` boundaries while preserving the content.
  const parts = cleaned.split(/^@(\w+)/m);
  // parts[0] is the prose before any @tag; subsequent entries come in
  // pairs of [tag, body].
  description = parts[0].trim();
  for (let i = 1; i < parts.length; i += 2) {
    const tag = parts[i];
    const body = (parts[i + 1] || '').trim();
    if (tag === 'public') tier = 'public';
    else if (tag === 'internal') tier = 'internal';
    else if (tag === 'experimental') tier = 'experimental';
    else if (tag === 'deprecated') { tier = 'deprecated'; deprecated = body; }
    else if (tag === 'remarks' && body) description += '\n\n' + body;
  }
  return { tier, description, deprecated };
}

function readDeclaration(lines, start, kind) {
  // For block-bodied declarations (interface/class), walk until the
  // matching closing `}` at the start of a line. For one-liners
  // (const/function/type), walk until a line ending in `;`.
  if (kind === 'interface' || kind === 'class' || kind === 'abstract class') {
    let depth = 0;
    let started = false;
    let i = start;
    for (; i < lines.length; i++) {
      const line = lines[i];
      for (const ch of line) {
        if (ch === '{') { depth++; started = true; }
        else if (ch === '}') { depth--; }
      }
      if (started && depth === 0) break;
    }
    return { decl: lines.slice(start, i + 1).join('\n'), end: i };
  }
  // Otherwise: walk until a line ends with `;` at zero brace depth.
  let depth = 0;
  let i = start;
  for (; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0 && line.trimEnd().endsWith(';')) break;
  }
  return { decl: lines.slice(start, i + 1).join('\n'), end: i };
}

// ── Minimal TSDoc → HTML ────────────────────────────────────────────────────

/** Render a TSDoc description string to HTML.
 *  Supports: paragraphs (blank-line separated), inline `code`,
 *  {@link foo} → <code>foo</code> anchored to #-foo-, basic <ul>.
 *  Anything fancier and we lean on the reader to follow links. */
function tsdocToHtml(text) {
  if (!text) return '';
  const paragraphs = text.split(/\n{2,}/);
  return paragraphs.map((p) => {
    p = p.trim();
    if (!p) return '';
    // Bullet block?
    if (/^[-*]\s+/m.test(p) && p.split('\n').every((l) => /^\s*[-*]\s+/.test(l) || l.trim() === '')) {
      const items = p.split('\n').filter((l) => l.trim()).map((l) => l.replace(/^\s*[-*]\s+/, ''));
      return `<ul>${items.map((i) => `<li>${inlineMd(i)}</li>`).join('')}</ul>`;
    }
    return `<p>${inlineMd(p.replace(/\n/g, ' '))}</p>`;
  }).join('\n');
}

function inlineMd(s) {
  // Order matters: code first (so we don't interpret * inside code),
  // then {@link X}, then escape what's left.
  // Walk char-by-char to handle backticks safely.
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '`') {
      const end = s.indexOf('`', i + 1);
      if (end < 0) { out += escSafe(s.slice(i)); break; }
      out += `<code>${escSafe(s.slice(i + 1, end))}</code>`;
      i = end + 1;
      continue;
    }
    if (s.startsWith('{@link ', i)) {
      const end = s.indexOf('}', i);
      if (end < 0) { out += escSafe(s.slice(i)); break; }
      const target = s.slice(i + '{@link '.length, end).trim();
      out += `<code>${escSafe(target)}</code>`;
      i = end + 1;
      continue;
    }
    out += escSafe(s[i]);
    i++;
  }
  return out;
}

function escSafe(s) { return esc(s); }
