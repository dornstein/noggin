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
  { group: 'Providers', items: [
    { slug: 'providers/', title: 'Overview' },
    { slug: 'providers/file/', title: 'File' },
    { slug: 'providers/localstorage/', title: 'LocalStorage' },
    { slug: 'providers/http/', title: 'HTTP(S)' },
    { slug: 'providers/memory/', title: 'Memory' },
  ]},
  { group: 'API', items: [
    { slug: 'api/', title: 'Overview' },
    { subgroup: 'Handles', items: [
      { slug: 'api/handles/', title: 'Overview' },
      { slug: 'api/handles/noggin/', title: 'Noggin' },
      { slug: 'api/handles/noggin-store/', title: 'NogginStore' },
    ]},
    { subgroup: 'Opening a noggin', items: [
      { slug: 'api/opening/', title: 'Overview' },
      { slug: 'api/opening/open-noggin/', title: 'openNoggin' },
      { slug: 'api/opening/provider-registry/', title: 'Provider registry' },
    ]},
    { subgroup: 'Verbs', items: [
      { slug: 'api/verbs/', title: 'Overview' },
      { slug: 'api/verbs/verbs/', title: 'verbs' },
      { slug: 'api/verbs/verb-options/', title: 'Verb options' },
      { slug: 'api/verbs/bind-noggin-verbs/', title: 'bindNogginVerbs' },
      { slug: 'api/verbs/verb-context/', title: 'VerbContext' },
      { slug: 'api/verbs/copy-result/', title: 'CopyResult' },
    ]},
    { subgroup: 'Core data model', items: [
      { slug: 'api/core-data-model/', title: 'Overview' },
      { slug: 'api/core-data-model/noggin-document/', title: 'NogginDocument' },
      { slug: 'api/core-data-model/item/', title: 'Item & Note' },
      { slug: 'api/core-data-model/item-view/', title: 'View shapes' },
      { slug: 'api/core-data-model/placement/', title: 'Placement' },
      { slug: 'api/core-data-model/type-aliases/', title: 'Type aliases' },
    ]},
    { subgroup: 'Atomic ops', items: [
      { slug: 'api/atomic-ops/', title: 'Overview' },
      { slug: 'api/atomic-ops/atomic-op/', title: 'AtomicOp' },
      { slug: 'api/atomic-ops/apply-ops/', title: 'applyOps' },
      { slug: 'api/atomic-ops/document-utilities/', title: 'Document utilities' },
    ]},
    { subgroup: 'Events', items: [
      { slug: 'api/events/', title: 'Overview' },
      { slug: 'api/events/item-change/', title: 'ItemChange & ChangeEvent' },
      { slug: 'api/events/event-disposable/', title: 'Event & Disposable' },
    ]},
    { subgroup: 'Errors', items: [
      { slug: 'api/errors/', title: 'Overview' },
      { slug: 'api/errors/noggin-error/', title: 'NogginError' },
      { slug: 'api/errors/noggin-error-code/', title: 'NogginErrorCode' },
      { slug: 'api/errors/noggin-error-data/', title: 'NogginErrorData' },
    ]},
    { subgroup: 'Response envelope', items: [
      { slug: 'api/response-envelope/', title: 'Overview' },
      { slug: 'api/response-envelope/json-envelope/', title: 'JsonEnvelope' },
      { slug: 'api/response-envelope/envelope-helpers/', title: 'formatSuccess / formatError' },
    ]},
    { slug: 'api/path-utilities/', title: 'Path utilities' },
    { slug: 'api/constants/', title: 'Constants' },
    { subgroup: 'Serializers', items: [
      { slug: 'api/serializers/', title: 'Overview' },
      { slug: 'api/serializers/yaml/', title: 'yaml' },
      { slug: 'api/serializers/json/', title: 'json' },
    ]},
  ]},
  { group: 'Reference', items: [
    { slug: 'schema/', title: 'Noggin schema' },
    { slug: 'envelope/', title: 'Response envelope' },
    { slug: 'cli/', title: 'CLI reference' },
    { slug: 'mcp/', title: 'MCP server' },
    { slug: 'noggin-rpc/', title: 'noggin-rpc protocol' },
  ]},
  { group: 'UI components', items: [
    { slug: 'ui/', title: 'Overview' },
    { slug: 'ui/theming/', title: 'Theming' },
    { slug: 'ui/components/', title: 'Component reference' },
  ]},
  { group: 'Contributors', items: [
    { slug: 'contributors/', title: 'Overview' },
    { slug: 'contributors/testing/', title: 'Testing strategy' },
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
  // Every group and every subgroup is a collapsible .nav-block:
  //
  //   <div class="nav-block ...">
  //     <button class="nav-block-header" aria-expanded="…">
  //       <span class="nav-chevron"></span>
  //       <span class="nav-block-label">Group name</span>
  //     </button>
  //     <div class="nav-block-body"><div class="nav-block-body-inner">
  //       …child items…
  //     </div></div>
  //   </div>
  //
  // The whole header is a single <button> — clicking anywhere on
  // the row toggles collapse. Group headers never navigate.
  // If a group has an overview page, include it as the first child
  // (`Overview`, or `About` in domain-specific cases). Leaf entries
  // that aren't collapsibles (a single detail page with no
  // siblings — Path utilities, Constants) render as plain
  // `<a class="navlink">` links, distinguishable at a glance from
  // the collapsible headers.
  return NAV.map((group) => {
    const navId = navIdOf('g', group.group);
    const containsActive = groupContainsSlug(group.items, activeSlug);
    return renderBlock({
      cls: 'nav-group',
      navId,
      label: group.group,
      items: group.items,
      activeSlug,
      containsActive,
      level: 0,
    });
  }).join('');
}

function renderNavItems(items, activeSlug, level, parentId) {
  return items.map((item) => {
    if (item.subgroup) {
      const navId = navIdOf(parentId, item.subgroup);
      const containsActive = groupContainsSlug(item.items, activeSlug);
      return renderBlock({
        cls: 'nav-subgroup',
        navId,
        label: item.subgroup,
        items: item.items,
        activeSlug,
        containsActive,
        level: level + 1,
      });
    }
    const cls = ['navlink'];
    if (level > 0) cls.push('nested');
    if (item.slug === activeSlug) cls.push('active');
    return `<a class="${cls.join(' ')}" href="${esc(rootRel(activeSlug, item.slug))}">${esc(item.title)}</a>`;
  }).join('');
}

function renderBlock({ cls, navId, label, items, activeSlug, containsActive, level }) {
  const collapsed = containsActive ? 'false' : 'true';
  return `<div class="nav-block ${cls}" data-nav-id="${esc(navId)}" data-collapsed="${collapsed}">`
    + `<button type="button" class="nav-block-header" aria-expanded="${containsActive ? 'true' : 'false'}">`
    + `<span class="nav-chevron" aria-hidden="true"></span>`
    + `<span class="nav-block-label">${esc(label)}</span>`
    + `</button>`
    + `<div class="nav-block-body"><div class="nav-block-body-inner">`
    + renderNavItems(items, activeSlug, level, navId)
    + `</div></div>`
    + `</div>`;
}

function groupContainsSlug(items, activeSlug) {
  for (const item of items) {
    if (item.subgroup) {
      if (groupContainsSlug(item.items, activeSlug)) return true;
    } else if (item.slug === activeSlug) {
      return true;
    }
  }
  return false;
}

function navIdOf(prefix, label) {
  // Stable id used as the localStorage key. Deterministic per-label
  // so state persists across builds even if the group order shifts.
  const slug = String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${prefix}:${slug}`;
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
<noscript><style>
/* No-JS fallback: force every collapsible block open so navigation
   stays usable. The JS above is the only thing that flips the
   data-collapsed attribute after page load; without it, the
   server-rendered defaults would leave most sections closed. */
aside.sidebar nav .nav-block[data-collapsed="true"] > .nav-block-body {
  grid-template-rows: 1fr !important;
}
aside.sidebar nav .nav-block[data-collapsed="true"] > .nav-block-header .nav-chevron::before {
  transform: rotate(90deg) !important;
}
</style></noscript></head>
<body>
<header class="topbar">
  <a class="brand" href="${esc(rootRel(slug, ''))}">noggin</a>
  <button type="button" class="nav-toggle" aria-label="Toggle navigation" aria-controls="site-nav" aria-expanded="false">Menu</button>
</header>
<div class="nav-backdrop" aria-hidden="true"></div>
<div class="layout">
  <aside class="sidebar" id="site-nav">
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
<script>
(function () {
  var btn = document.querySelector('button.nav-toggle');
  var backdrop = document.querySelector('.nav-backdrop');
  if (!btn) return;
  function setOpen(open) {
    document.body.dataset.navOpen = open ? 'true' : 'false';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  btn.addEventListener('click', function () {
    setOpen(document.body.dataset.navOpen !== 'true');
  });
  if (backdrop) backdrop.addEventListener('click', function () { setOpen(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setOpen(false);
  });
  // Close after navigating via the in-drawer links so the user lands on
  // the new page with content visible.
  document.querySelectorAll('aside.sidebar nav a').forEach(function (a) {
    a.addEventListener('click', function () { setOpen(false); });
  });
})();

// ── Collapsible nav groups + persistence ─────────────────────────
//
// State machine:
//
//   * The server renders sensible defaults: blocks that contain the
//     current page are expanded, everything else collapsed. That
//     gives a fresh visitor an in-context view without a flash.
//
//   * The client script layers stored preferences on top. Two
//     cases distinguished via the Navigation Timing API:
//
//       - RELOAD of the current page → stored state wins for every
//         block, even for the ancestors of the active page. The
//         user's explicit collapse is preserved on refresh (matches
//         the "I collapsed this, it should stay collapsed on
//         reload" expectation).
//
//       - NAVIGATION to a different URL (typed URL, in-page link,
//         back/forward) → the ancestor chain of the new active
//         page is force-expanded. Stored entries for those
//         ancestors are cleared so a subsequent collapse+reload
//         works normally against the new page.
//
//     Handles the bfcache case via a pageshow listener — restoring a
//     back/forward-cached page re-runs the same logic.
(function () {
  var STATE_KEY = 'noggin:nav:collapsed';

  function load() {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      if (raw) return JSON.parse(raw) || {};
    } catch (_) { /* corrupt / disabled */ }
    return {};
  }
  function save(state) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); }
    catch (_) { /* quota / disabled — collapse itself still works */ }
  }

  function activeAncestors() {
    var active = document.querySelector('aside.sidebar nav a.navlink.active');
    var ids = new Set();
    if (!active) return ids;
    var el = active.parentElement;
    while (el) {
      if (el.classList && el.classList.contains('nav-block')) {
        ids.add(el.dataset.navId);
      }
      el = el.parentElement;
    }
    return ids;
  }

  function setBlockCollapsed(block, collapsed) {
    block.dataset.collapsed = collapsed ? 'true' : 'false';
    var header = block.querySelector(':scope > .nav-block-header');
    if (header) header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  function apply(isReload) {
    var stored = load();
    var ancestors = activeAncestors();

    if (!isReload && ancestors.size > 0) {
      // New navigation: the user's intent is to see the page they
      // just clicked into. Force-expand the ancestor chain in the
      // DOM (bfcache restores may have carried a collapsed state
      // over from a previous interaction) and clear the matching
      // stored entries so a subsequent collapse+reload works
      // normally against the new page.
      var mutated = false;
      ancestors.forEach(function (id) {
        var block = document.querySelector('.nav-block[data-nav-id="' + cssEscape(id) + '"]');
        if (block) setBlockCollapsed(block, false);
        if (Object.prototype.hasOwnProperty.call(stored, id)) {
          delete stored[id];
          mutated = true;
        }
      });
      if (mutated) save(stored);
    }

    document.querySelectorAll('.nav-block').forEach(function (block) {
      var id = block.dataset.navId;
      if (ancestors.has(id) && !isReload) return; // just handled above
      if (Object.prototype.hasOwnProperty.call(stored, id)) {
        setBlockCollapsed(block, stored[id] === true);
        return;
      }
      // No stored preference → honour the server-rendered default,
      // which the template computed as "expanded iff this block
      // contains the active page." Nothing to do.
    });
  }

  // Minimal CSS-attribute-selector escape for our stable ids
  // (matches [a-z0-9:-]). Handles the ':' separator we use in
  // navIdOf without pulling in the full CSS.escape polyfill.
  function cssEscape(s) {
    return String(s).replace(/([:])/g, '\\\\$1');
  }

  function detectReload() {
    try {
      var nav = performance.getEntriesByType('navigation')[0];
      if (nav) return nav.type === 'reload';
    } catch (_) { /* Safari <13 etc. */ }
    return false;
  }

  // Initial pass.
  apply(detectReload());

  // Back/forward-cache restore: browsers may return to this page
  // without re-parsing the HTML. pageshow fires either way,
  // with e.persisted === true when the page came from bfcache.
  // We treat that as a fresh navigation into the page.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return; // already covered by the initial pass
    apply(false);
  });

  // Toggle handlers. The whole header is a single button; clicking
  // anywhere on the row toggles the block.
  document.querySelectorAll('.nav-block-header').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var block = btn.parentElement;
      if (!block || !block.classList.contains('nav-block')) return;
      var next = block.dataset.collapsed !== 'true';
      setBlockCollapsed(block, next);
      var stored = load();
      stored[block.dataset.navId] = next;
      save(stored);
    });
  });
})();
</script>
</body>
</html>`;
}

export { esc, rootRel };
