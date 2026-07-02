// Tiny, single-file Markdown → HTML renderer.
//
// Only supports what the docs site actually uses: headings, paragraphs,
// fenced code blocks, inline code, bold/italic, links, ordered and
// unordered lists, pipe tables, blockquotes, horizontal rules, HTML
// passthrough (raw <div>/<a>/<span> in our content stays as-is).
//
// Hand-written so we don't take a runtime dependency on a markdown lib
// just for a docs site. ~200 lines; covers what we need.

import { esc } from './template.mjs';

export function renderMarkdown(src) {
  const lines = src.split(/\r?\n/);
  const out = [];
  let i = 0;
  let inList = null; // null | 'ul' | 'ol'
  // Pre-assign heading IDs by scanning the whole source for every
  // slug-generating occurrence — both `<a id="foo">` inline HTML
  // anchors (TypeDoc emits these inside its param tables) and
  // markdown headings (`## Foo`). Each unique base slug gets `foo`,
  // `foo-1`, `foo-2`, … assigned in source order.
  //
  // Two motivations:
  //
  //   1. A heading whose text repeats (interface + `const` of the
  //      same name, method overloads) would otherwise collide with
  //      itself and any on-page link to `#foo-1` would 404.
  //
  //   2. TypeDoc emits cross-reference links like `[goto](#goto-4)`
  //      whose target number counts *every* prior occurrence of
  //      `goto` in the module — headings and inline `<a id>` anchors
  //      alike. A running counter that ignored inline anchors would
  //      renumber the headings and break those cross-references.
  const headingIds = precomputeHeadingIds(src, lines);
  let headingCursor = 0;

  function flushList() {
    if (inList) { out.push(`</${inList}>`); inList = null; }
  }

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      flushList();
      const lang = fence[1] || '';
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      const langCls = lang ? ` class="language-${esc(lang)}"` : '';
      out.push(`<pre><code${langCls}>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // Heading.
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushList();
      const level = h[1].length;
      const text = h[2].trim();
      const id = headingIds[headingCursor++] ?? slugify(text);
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushList();
      out.push('<hr>');
      i++;
      continue;
    }

    // Blockquote.
    if (line.startsWith('> ')) {
      flushList();
      const buf = [];
      while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
        buf.push(lines[i].replace(/^> ?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // Pipe table — header row, separator, then body rows.
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      flushList();
      const header = parseTableRow(line);
      i += 2; // skip header + separator
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      out.push(`<table>
<thead><tr>${header.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('\n')}</tbody>
</table>`);
      continue;
    }

    // Lists.
    const ul = line.match(/^[-*]\s+(.*)$/);
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ul || ol) {
      const want = ul ? 'ul' : 'ol';
      if (inList !== want) { flushList(); out.push(`<${want}>`); inList = want; }
      const itemText = (ul ? ul[1] : ol[1]).trim();
      // Continuation lines: subsequent indented lines belong to the same <li>.
      const buf = [itemText];
      i++;
      while (i < lines.length && (/^\s{2,}\S/.test(lines[i]) || lines[i] === '')) {
        if (lines[i] === '' && i + 1 < lines.length && (/^[-*]\s+/.test(lines[i + 1]) || /^\d+\.\s+/.test(lines[i + 1]))) break;
        if (lines[i] === '') { buf.push(''); i++; continue; }
        buf.push(lines[i].replace(/^\s{2}/, ''));
        i++;
      }
      out.push(`<li>${inline(buf.join('\n').trim())}</li>`);
      continue;
    }

    // Raw HTML block (line starts with <).
    if (/^<\w/.test(line)) {
      flushList();
      // Pass through verbatim, including following lines until we hit a
      // blank line. Markdown spec is roughly "raw HTML blocks end at blank line."
      const buf = [line];
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        buf.push(lines[i]);
        i++;
      }
      out.push(buf.join('\n'));
      continue;
    }

    // Blank line.
    if (line.trim() === '') {
      flushList();
      i++;
      continue;
    }

    // Paragraph: accumulate consecutive non-empty, non-special lines.
    flushList();
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' &&
           !/^(#{1,6}\s|```|>\s|---+\s*$|\*\*\*+\s*$|___+\s*$|[-*]\s|\d+\.\s|\|)/.test(lines[i]) &&
           !/^<\w/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }

  flushList();
  return out.join('\n');
}

function parseTableRow(line) {
  // Trim leading/trailing pipe, then split on un-escaped pipes.
  const trimmed = line.replace(/^\|/, '').replace(/\|\s*$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

// ── Inline formatting ───────────────────────────────────────────────────────

function inline(s) {
  // Walk char-by-char, handling raw HTML, code spans, links, bold/italic.
  let out = '';
  let i = 0;
  while (i < s.length) {
    // Backslash escape: CommonMark says `\<` etc. emit the literal
    // character. typedoc-plugin-markdown leans on this to keep things
    // like `Promise\<Foo\>` from being mis-parsed as HTML tags.
    if (s[i] === '\\' && i + 1 < s.length && /[\\<>`*_{}\[\]()#+\-.!|~]/.test(s[i + 1])) {
      const ch = s[i + 1];
      out += (ch === '<' || ch === '>' || ch === '&') ? esc(ch) : ch;
      i += 2;
      continue;
    }
    // Raw HTML tags pass through verbatim.
    if (s[i] === '<') {
      const close = s.indexOf('>', i);
      if (close >= 0) {
        out += s.slice(i, close + 1);
        i = close + 1;
        continue;
      }
    }
    // Inline code `...`.
    if (s[i] === '`') {
      const end = s.indexOf('`', i + 1);
      if (end < 0) { out += esc(s.slice(i)); break; }
      out += `<code>${esc(s.slice(i + 1, end))}</code>`;
      i = end + 1;
      continue;
    }
    // Image: ![alt](src)
    if (s[i] === '!' && s[i + 1] === '[') {
      const m = s.slice(i).match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/);
      if (m) {
        const alt = esc(m[1]);
        const src = esc(m[2]);
        const title = m[3] ? ` title="${esc(m[3])}"` : '';
        out += `<img src="${src}" alt="${alt}"${title}>`;
        i += m[0].length;
        continue;
      }
    }
    // Link: [text](href)
    if (s[i] === '[') {
      const m = s.slice(i).match(/^\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/);
      if (m) {
        const text = inline(m[1]);
        const href = esc(m[2]);
        const title = m[3] ? ` title="${esc(m[3])}"` : '';
        out += `<a href="${href}"${title}>${text}</a>`;
        i += m[0].length;
        continue;
      }
    }
    // Bold **...**
    if (s[i] === '*' && s[i + 1] === '*') {
      const end = s.indexOf('**', i + 2);
      if (end >= 0) {
        out += `<strong>${inline(s.slice(i + 2, end))}</strong>`;
        i = end + 2;
        continue;
      }
    }
    // Italic *...* (but not **)
    if (s[i] === '*' && s[i + 1] !== '*' && s[i - 1] !== '*') {
      const end = s.indexOf('*', i + 1);
      if (end >= 0 && s[end + 1] !== '*') {
        out += `<em>${inline(s.slice(i + 1, end))}</em>`;
        i = end + 1;
        continue;
      }
    }
    // Plain character.
    if (s[i] === '&' || s[i] === '<' || s[i] === '>') {
      out += esc(s[i]);
    } else {
      out += s[i];
    }
    i++;
  }
  return out;
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// Walk the source once and assign a unique id to each markdown
// heading, taking any pre-existing `<a id="foo">` and `<a id="foo-N">`
// inline HTML anchors into account.
//
// Returns an array of heading ids in source order. The renderer's
// heading branch increments a cursor into this array to look up
// each heading's assigned id.
//
// The algorithm builds a set of already-claimed ids from inline
// anchors, then walks the source line by line: when a heading is
// encountered it takes `slug`, `slug-1`, `slug-2`, ... — skipping
// any suffix that's already claimed by an inline anchor.
function precomputeHeadingIds(src, lines) {
  const claimed = new Set();
  for (const m of src.matchAll(/id="([a-z0-9-]+)"/gi)) {
    claimed.add(m[1].toLowerCase());
  }
  // Same fenced-code-block awareness as the main renderer — headings
  // inside code fences aren't real headings.
  const ids = [];
  const counters = new Map();
  let inFence = false;
  for (const raw of lines) {
    if (/^```/.test(raw)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (!h) continue;
    const base = slugify(h[2].trim());
    let n = counters.get(base) ?? 0;
    let candidate = n === 0 ? base : `${base}-${n}`;
    while (claimed.has(candidate)) {
      n += 1;
      candidate = `${base}-${n}`;
    }
    counters.set(base, n + 1);
    claimed.add(candidate);
    ids.push(candidate);
  }
  return ids;
}
