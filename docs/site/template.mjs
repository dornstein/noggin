// Shared HTML chrome for every docs site page.
//
// Pure ESM helper — no dependencies. The site builder calls
// `renderPage(...)` once per page; the markdown renderer (or dynamic
// generator) supplies the body HTML.

const NAV = [
  { group: 'Get started', items: [
    { slug: '', title: 'Overview' },
    { slug: 'install/', title: 'Install' },
    { slug: 'quickstart/', title: 'Quickstart' },
  ]},
  { group: 'Demos', items: [
    { slug: 'playground/', title: 'Playground' },
    { slug: 'demo/', title: 'Verb demo' },
  ]},
  { group: 'Reference', items: [
    { slug: 'schema/', title: 'Noggin schema' },
    { slug: 'envelope/', title: 'Response envelope' },
    { slug: 'cli/', title: 'CLI reference' },
    { slug: 'api/', title: 'JavaScript API' },
    { slug: 'mcp/', title: 'MCP server' },
  ]},
  { group: 'Project', items: [
    { slug: 'changelog/', title: 'Changelog' },
  ]},
];

const REPO_URL = 'https://github.com/dornstein/noggin';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function navHtml(activeSlug) {
  // activeSlug is the slug of the current page (e.g. '', 'cli/').
  return NAV.map((group) => {
    const items = group.items.map((item) => {
      const href = item.slug === '' ? './' : `${'../'.repeat(depth(activeSlug)) || './'}${item.slug}`;
      const cls = item.slug === activeSlug ? 'active' : '';
      return `<a class="${cls}" href="${esc(rootRel(activeSlug, item.slug))}">${esc(item.title)}</a>`;
    }).join('');
    return `<div class="group">${esc(group.group)}</div>${items}`;
  }).join('');
}

function depth(slug) {
  if (!slug) return 0;
  // 'install/' → depth 1, 'a/b/' → depth 2.
  return slug.replace(/\/$/, '').split('/').filter(Boolean).length;
}

function rootRel(fromSlug, toSlug) {
  // Compute a relative href from one slug to another. Both end in '/'
  // (or are '' for root). Pages live at `<slug>/index.html`.
  const up = '../'.repeat(depth(fromSlug));
  return (up || './') + toSlug;
}

/**
 * Render a complete HTML page.
 *
 * @param {object} opts
 * @param {string} opts.slug      Slug of this page (e.g. '', 'cli/', 'api/').
 * @param {string} opts.title     Page title (used in <title>).
 * @param {string} opts.body      HTML for the main content area.
 * @param {string} [opts.lead]    Optional lead paragraph rendered under h1.
 *                                 If body already includes its own h1, leave blank.
 */
export function renderPage({ slug, title, body }) {
  const cssHref = rootRel(slug, 'assets/style.css');
  const generated = new Date().toISOString();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title === 'noggin' ? title : `${title} — noggin`)}</title>
<link rel="stylesheet" href="${esc(cssHref)}">
</head>
<body>
<div class="layout">
  <aside class="sidebar">
    <a class="brand" href="${esc(rootRel(slug, ''))}">noggin</a>
    <div class="tagline">Working-memory tree for in-flight work.</div>
    <nav>${navHtml(slug)}</nav>
    <div class="meta">
      <p><a href="${REPO_URL}">GitHub repo</a></p>
      <p>Generated ${esc(generated)}</p>
    </div>
  </aside>
  <main class="content">
${body}
    <footer class="page-footer">
      Generated automatically from the source. Found a problem?
      <a href="${REPO_URL}/issues">File an issue</a>.
    </footer>
  </main>
</div>
</body>
</html>`;
}

export { esc, rootRel };
