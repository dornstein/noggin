#!/usr/bin/env node
// Generate a side-by-side review page of the noggin CLI's human and JSON
// output across every verb and several error paths. By default writes to
// the OS temp dir and prints the path to stdout, so you can open it in a
// browser to review the output contracts at a glance.
//
//   node scripts/build-demo-html.mjs                # → temp dir (default)
//   node scripts/build-demo-html.mjs --out site/index.html
//   DEMO_OUT=_site/index.html node scripts/build-demo-html.mjs
//
// Used by .github/workflows/pages.yml to publish a live demo to GitHub Pages.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const CLI = path.join(repoRoot, 'cli', 'noggin.mjs');
// js-yaml lives in cli/node_modules — borrow it rather than installing it twice.
const yaml = createRequire(path.join(repoRoot, 'cli/package.json'))('js-yaml');

// ── Scenario harness ────────────────────────────────────────────────────────

/** Each scenario gets a brand-new temp noggin file optionally seeded with `fixture`. */
function makeTemp(fixture) {
  const dir = mkdtempSync(path.join(tmpdir(), 'noggin-demo-'));
  const file = path.join(dir, 'noggin.yaml');
  if (fixture) writeFileSync(file, fixture, 'utf8');
  return { file, dir, cleanup() { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } } };
}

function runCli(args, file) {
  const env = { ...process.env, NOGGIN_FILE: file };
  // Isolate HOME so default-file resolution can't touch the dev's real noggin.
  const sandbox = mkdtempSync(path.join(tmpdir(), 'noggin-home-'));
  env.HOME = sandbox; env.USERPROFILE = sandbox;
  const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
  try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** Build a deterministic fixture YAML from a tree spec (positions, no random keys). */
function fixture(spec) {
  const items = [];
  let counter = 0;
  let activeKey = null;
  const newKey = () => `i-20260101-000000-${String(++counter).padStart(6, '0')}`;
  function walk(parentKey, kids, prefix) {
    kids.forEach((kid, idx) => {
      const key = newKey();
      const pos = idx + 1;
      const itemPath = prefix ? `${prefix}/${pos}` : String(pos);
      items.push({
        key, parentKey,
        title: kid.title,
        done: Boolean(kid.done),
        createdAt: '2026-01-01T00:00:00.000Z',
        notes: (kid.notes || []).map((text) => ({ timestamp: '2026-01-01T00:00:00.000Z', text })),
      });
      if (spec.active === itemPath) activeKey = key;
      walk(key, kid.children || [], itemPath);
    });
  }
  walk(null, spec.roots || [], '');
  return yaml.dump({ schemaVersion: 1, active: activeKey, items }, { noRefs: true, lineWidth: 100, sortKeys: false });
}

/**
 * One scenario = one CLI invocation, captured three times:
 *   1. Before:  `noggin show` against the seed (skipped when no seed)
 *   2. Human:   the command itself, default output
 *   3. JSON:    the command with --json, against an identical fresh seed
 *
 * Each capture gets its own temp file so the runs never interfere.
 *
 * { section, title, blurb?, args, seed? }
 */
function runScenario(s) {
  const seedYaml = s.seed ? fixture(s.seed) : null;
  const captureOn = (args) => {
    const t = makeTemp(seedYaml);
    try { return runCli(args, t.file); } finally { t.cleanup(); }
  };
  return {
    ...s,
    before: seedYaml ? captureOn(['show']) : null,
    human: captureOn(s.args),
    json: captureOn([...s.args, '--json']),
  };
}

// ── Catalog of scenarios ────────────────────────────────────────────────────

const TREE = {
  active: '1',
  roots: [
    { title: 'ship v1', children: [
      { title: 'spec the API', done: true, notes: ['decided on stateless verbs'] },
      { title: 'wire up tests' },
      { title: 'write docs', children: [{ title: 'README' }, { title: 'SKILL' }] },
    ] },
    { title: 'follow-ups' },
  ],
};

const TREE_DEEP_ACTIVE = {
  active: '1/3/2',
  roots: [
    { title: 'ship v1', children: [
      { title: 'spec the API', done: true },
      { title: 'wire up tests' },
      { title: 'write docs', children: [{ title: 'README' }, { title: 'SKILL' }] },
    ] },
    { title: 'follow-ups' },
  ],
};

const TREE_WITH_NOTES = {
  active: '1',
  roots: [{
    title: 'investigate the bug',
    notes: [
      'repro: it happens on Windows but not macOS',
      'looks like a path-separator issue in tokenizer',
    ],
  }],
};

const scenarios = [
  // ── push ────────────────────────────────────────────────────────────
  {
    section: 'push',
    title: 'push into an empty store',
    blurb: 'No seed file. Creates the first root item and makes it active. Target is path `/1`.',
    args: ['push', 'ship v1'],
  },
  {
    section: 'push',
    title: 'push a child of the active item',
    blurb: 'Active is `/1` (ship v1). The new item is appended as the last child of active and becomes the new active. Path was `/1`, now `/1/4`.',
    args: ['push', 'pause to chase a regression'],
    seed: TREE,
  },

  // ── add ─────────────────────────────────────────────────────────────
  {
    section: 'add',
    title: 'add a child of active (default placement)',
    blurb: 'Active stays at `/1`. The new item is appended as the last child of active (path `/1/4`). Note the 📍 indicator never moves.',
    args: ['add', 'remember to file an ADO bug'],
    seed: TREE,
  },
  {
    section: 'add',
    title: 'add --into <path>',
    blurb: 'Append under an arbitrary anchor. New item becomes the last child of `/1/3` (write docs), so path `/1/3/3`. Active still `/1`.',
    args: ['add', 'CONTRIBUTING', '--into', '/1/3'],
    seed: TREE,
  },
  {
    section: 'add',
    title: 'add --before <path>',
    blurb: 'Insert as a sibling immediately before `/1/3` (write docs). New item takes path `/1/3`; everything from the old `/1/3` onward shifts by one.',
    args: ['add', 'CHANGELOG', '--before', '/1/3'],
    seed: TREE,
  },
  {
    section: 'add',
    title: 'add --after <path>',
    blurb: 'Insert as a sibling immediately after `/1/3`. New item takes path `/1/4`; `follow-ups` stays at root path `/2`.',
    args: ['add', 'LICENSE', '--after', '/1/3'],
    seed: TREE,
  },
  {
    section: 'add',
    title: 'add with --goto',
    blurb: 'Same default placement (last child of active) but `--goto` with no path activates the new item. 📍 moves from `/1` to `/1/4`.',
    args: ['add', 'now i\'m going to do this', '--goto'],
    seed: TREE,
  },

  // ── move ────────────────────────────────────────────────────────────
  {
    section: 'move',
    title: 'move active --into <path>',
    blurb: 'Active is the deep leaf `/1/3/2` (SKILL). Move it under `/2` (follow-ups). Active is preserved by key, so 📍 stays on the same item but its path changes from `/1/3/2` to `/2/1`.',
    args: ['move', '--into', '/2'],
    seed: TREE_DEEP_ACTIVE,
  },
  {
    section: 'move',
    title: 'move <path> --before <anchor>',
    blurb: 'Reorder: move `/1/2` (wire up tests) before `/1/1` (spec the API). Their paths swap; active stays on `/1` (which is a parent and unaffected).',
    args: ['move', '/1/2', '--before', '/1/1'],
    seed: TREE,
  },

  // ── goto ────────────────────────────────────────────────────────────
  {
    section: 'goto',
    title: 'goto absolute path',
    blurb: 'Make `/1/3/1` (README) active. The spine is now deep, so the after-view shows every peer at every depth from root to README.',
    args: ['goto', '/1/3/1'],
    seed: TREE,
  },
  {
    section: 'goto',
    title: 'goto relative (../X)',
    blurb: 'Active was `/1/3/2` (SKILL). `../1` walks up to the parent (`/1/3` write docs) then descends to its first child — landing on `/1/3/1` (README).',
    args: ['goto', '../1'],
    seed: TREE_DEEP_ACTIVE,
  },

  // ── done / pop ──────────────────────────────────────────────────────
  {
    section: 'done',
    title: 'done <path>',
    blurb: 'Mark `/1/2` (wire up tests) done. A system note `closed` is appended to it, and active shifts to its parent `/1`. The ✅ now sits on `/1/2`. (Idempotent — calling `done` again on an already-closed item is a no-op success.)',
    args: ['done', '/1/2'],
    seed: TREE,
  },
  {
    section: 'done',
    title: 'done --close-all (cascade close)',
    blurb: 'Mark `/1/3` (write docs) done along with its open children (README, SKILL). Without `--close-all` this would error — "2 open descendants". With it, every descendant gets its own `closed` system note, then the target is closed.',
    args: ['done', '/1/3', '--close-all'],
    seed: TREE,
  },
  {
    section: 'done',
    title: 'done --force (close anyway, leave kids open)',
    blurb: 'Closes `/1/3` even though its children remain open. Use sparingly — violates the usual "done items have no open descendants" invariant, but sometimes the right escape hatch.',
    args: ['done', '/1/3', '--force'],
    seed: TREE,
  },
  {
    section: 'done',
    title: 'pop (= done on active, shorthand)',
    blurb: 'Active is `/1/1` (a side-quest under `parent`). `pop` closes it and surfaces back to `/1`. Honors `--force` and `--close-all` the same way `done` does.',
    args: ['pop'],
    seed: { active: '1/1', roots: [{ title: 'parent', children: [{ title: 'side-quest' }] }] },
  },

  // ── edit ────────────────────────────────────────────────────────────
  {
    section: 'edit',
    title: 'edit --open (reopen a done item)',
    blurb: 'Active is `/1/1` (spec the API, previously closed in the seed). Reopening clears its done flag but does NOT touch notes — the historical `closed` note stays in the log. Active is unchanged.',
    args: ['edit', '--open'],
    seed: {
      active: '1/1',
      roots: [
        { title: 'ship v1', children: [
          { title: 'spec the API', done: true, notes: ['decided on stateless verbs'] },
          { title: 'wire up tests' },
          { title: 'write docs', children: [{ title: 'README' }, { title: 'SKILL' }] },
        ] },
      ],
    },
  },
  {
    section: 'edit',
    title: 'edit <path> --done (without surfacing)',
    blurb: 'Active is `/1/2`. `edit --done` marks it done in place — the ✅ appears but 📍 stays put. (Compare with `done`, which surfaces to the parent.)',
    args: ['edit', '--done'],
    seed: {
      active: '1/2',
      roots: [
        { title: 'ship v1', children: [
          { title: 'spec the API', done: true, notes: ['decided on stateless verbs'] },
          { title: 'wire up tests' },
          { title: 'write docs', children: [{ title: 'README' }, { title: 'SKILL' }] },
        ] },
      ],
    },
  },
  {
    section: 'edit',
    title: 'edit --title <text> (rename)',
    blurb: 'Active is `/1` (ship v1). Rename it to "ship v1.0". Active and tree shape unchanged — only the label. Before and After both target the same item so you can see exactly what changed.',
    args: ['edit', '--title', 'ship v1.0'],
    seed: TREE,
  },
  {
    section: 'edit',
    title: 'edit --done --title <text> (combined)',
    blurb: 'Active is `/1/2` (wire up tests). One call closes it AND renames it. Either operation on its own is idempotent; combining them lets you do both atomically.',
    args: ['edit', '--done', '--title', 'tests landed'],
    seed: {
      active: '1/2',
      roots: [
        { title: 'ship v1', children: [
          { title: 'spec the API', done: true, notes: ['decided on stateless verbs'] },
          { title: 'wire up tests' },
          { title: 'write docs', children: [{ title: 'README' }, { title: 'SKILL' }] },
        ] },
      ],
    },
  },
  {
    section: 'edit',
    title: 'edit --done is idempotent (no extra close note)',
    blurb: 'Active is `/1/1` (spec the API, already closed in the seed). Calling `edit --done` is a no-op success: no second `closed` note is added, no error returned.',
    args: ['edit', '--done'],
    seed: {
      active: '1/1',
      roots: [
        { title: 'ship v1', children: [
          { title: 'spec the API', done: true, notes: ['decided on stateless verbs'] },
          { title: 'wire up tests' },
          { title: 'write docs', children: [{ title: 'README' }, { title: 'SKILL' }] },
        ] },
      ],
    },
  },
  {
    section: 'edit',
    title: 'edit --done --close-all (cascade close, no surface)',
    blurb: 'Active is `/1/3` (write docs) with open kids. Like `done --close-all` but stays put on the target instead of surfacing. Useful when you\'re inspecting an item, decide it\'s fully done, and don\'t want active to move.',
    args: ['edit', '--done', '--close-all'],
    seed: {
      active: '1/3',
      roots: [
        { title: 'ship v1', children: [
          { title: 'spec the API', done: true, notes: ['decided on stateless verbs'] },
          { title: 'wire up tests' },
          { title: 'write docs', children: [{ title: 'README' }, { title: 'SKILL' }] },
        ] },
      ],
    },
  },

  // ── show ────────────────────────────────────────────────────────────
  {
    section: 'show',
    title: 'show (active by default)',
    blurb: 'Default target is the active item. Full current-tree view: every peer at every depth from root to target, then the target\'s children. (The Before snapshot here is the same command — included for parity with the others.)',
    args: ['show'],
    seed: TREE_DEEP_ACTIVE,
  },
  {
    section: 'show',
    title: 'show <path>',
    blurb: 'Inspect `/1/3` (write docs) without making it active. The spine ends at the requested item; the active 📍 still points to `/1` (where it was).',
    args: ['show', '/1/3'],
    seed: TREE,
  },
  {
    section: 'show',
    title: 'show --no-children',
    blurb: 'Hide first-level children. In JSON the target node simply has no `children` field — same shape as a peer (i.e. a leaf of the view).',
    args: ['show', '--no-children'],
    seed: TREE,
  },
  {
    section: 'show',
    title: 'show --with-siblings',
    blurb: 'Active is `/1/3/2` (SKILL). Default shows the spine root1 → docs → README/SKILL. `--with-siblings` also includes the ancestor siblings — `ship v1`\'s other children (`spec the API`, `wire up tests`) appear as leaves so you can see the wider context.',
    args: ['show', '--with-siblings'],
    seed: TREE_DEEP_ACTIVE,
  },
  {
    section: 'show',
    title: 'show --with-descendants',
    blurb: 'Expand the target\'s subtree recursively. Useful for inspecting a branch in full without walking it node-by-node.',
    args: ['show', '/1', '--with-descendants'],
    seed: TREE,
  },
  {
    section: 'show',
    title: 'show --with-all',
    blurb: 'Shorthand for `--with-siblings --with-descendants`: the full neighborhood around the target.',
    args: ['show', '--with-all'],
    seed: TREE_DEEP_ACTIVE,
  },
  {
    section: 'show',
    title: 'show --with-notes',
    blurb: 'Append note bodies after the tree. (Human only — JSON always carries the notes on the target row in the spine, regardless of this flag.)',
    args: ['show', '--with-notes'],
    seed: TREE_WITH_NOTES,
  },

  // ── note ────────────────────────────────────────────────────────────
  {
    section: 'note',
    title: 'note <text> on active',
    blurb: 'Append a timestamped note to the active item (`/1`). After-view shows ✏️ on that item; the new entry shows up in the target\'s `notes` array (look in the last spine entry).',
    args: ['note', 'remembered to update the changelog'],
    seed: TREE,
  },
  {
    section: 'note',
    title: 'note <path> <text>',
    blurb: 'Annotate an arbitrary item (`/1/2`) without leaving the active spine. Active stays at `/1`.',
    args: ['note', '/1/2', 'blocked on PR #123'],
    seed: TREE,
  },

  // ── (retitle is now `edit --title` — see the edit section above) ───────────────

  // ── delete ──────────────────────────────────────────────────────────
  {
    section: 'delete',
    title: 'delete a leaf',
    blurb: 'Remove `/1/2` (wire up tests). Payload always carries `deleted` (key, path, title) + `descendantCount` + a `view` of what\'s left. Active was `/1` (a parent) so it survives.',
    args: ['delete', '/1/2'],
    seed: TREE,
  },
  {
    section: 'delete',
    title: 'delete --recursive',
    blurb: 'Required when the target has descendants. Removes `/1/3` (write docs) and its two children. `descendantCount` is `2`.',
    args: ['delete', '/1/3', '--recursive'],
    seed: TREE,
  },
  {
    section: 'delete',
    title: 'delete the last item (tree empties)',
    blurb: 'When the only root is removed there\'s nowhere for active to fall back to. `view` is `null` and the human output says so.',
    args: ['delete', '/1', '--recursive'],
    seed: { active: '1', roots: [{ title: 'only thing' }] },
  },

  // ── where ───────────────────────────────────────────────────────────
  {
    section: 'where',
    title: 'where (file resolution)',
    blurb: 'Reports the resolved file, where it came from (`flag` / `env` / `default`), and whether it exists on disk. The Before snapshot is the seed\'s `show` for context.',
    args: ['where'],
    seed: TREE,
  },

  // ── error envelopes ─────────────────────────────────────────────────
  {
    section: 'errors',
    title: 'usage error: title required',
    blurb: 'Usage errors exit 2. Plain mode prints `noggin: <msg>` to stderr; `--json` mode emits a full error envelope to stderr instead.',
    args: ['push'],
  },
  {
    section: 'errors',
    title: 'runtime error: open descendants',
    blurb: 'Refuses to close `/1/3` (write docs) because it has two open children (README, SKILL). Close them first, then retry.',
    args: ['done', '/1/3'],
    seed: TREE,
  },
  {
    section: 'errors',
    title: 'runtime error: cycle on move',
    blurb: 'Cannot move `/1` (ship v1) into its own descendant `/1/3` — would create a cycle.',
    args: ['move', '/1', '--into', '/1/3'],
    seed: TREE,
  },
  {
    section: 'errors',
    title: 'runtime error: delete with descendants without --recursive',
    blurb: 'Safety check. Pass `--recursive` to delete the whole subtree, or close/move the children first.',
    args: ['delete', '/1/3'],
    seed: TREE,
  },
];

// ── HTML rendering ──────────────────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function badge(code) {
  const cls = code === 0 ? 'ok' : code === 1 ? 'warn' : 'err';
  return `<span class="badge ${cls}">exit ${code}</span>`;
}

function renderScenario(s, idx) {
  const argLine = ['noggin', ...s.args].map((a) => /\s/.test(a) ? `'${a}'` : a).join(' ');
  const jsonArgLine = ['noggin', ...s.args, '--json'].map((a) => /\s/.test(a) ? `'${a}'` : a).join(' ');

  const humanBody = s.human.stdout || s.human.stderr || '(no output)';
  const jsonStreamLabel = s.json.code !== 0 && !s.json.stdout.trim() ? 'stderr' : 'stdout';
  const jsonBody = s.json.stdout.trim() || s.json.stderr || '(no output)';

  const beforeBody = s.before
    ? (s.before.stdout || s.before.stderr || '(no output)')
    : 'The noggin is empty.';

  return `
<section class="scenario" id="s${idx}">
  <h3>${esc(s.title)}</h3>
  ${s.blurb ? `<p class="blurb">${esc(s.blurb)}</p>` : ''}
  <div class="before">
    <div class="bar before-bar"><span class="label">before</span><code>$ noggin show</code></div>
    <pre>${esc(beforeBody)}</pre>
  </div>
  <div class="after-label">after &darr;</div>
  <div class="cols">
    <div class="col">
      <div class="bar"><code>$ ${esc(argLine)}</code>${badge(s.human.code)}</div>
      <pre>${esc(humanBody)}</pre>
    </div>
    <div class="col">
      <div class="bar"><code>$ ${esc(jsonArgLine)}</code>${badge(s.json.code)}<span class="stream">${jsonStreamLabel}</span></div>
      <pre>${esc(jsonBody)}</pre>
    </div>
  </div>
</section>`;
}

function renderHtml(rows) {
  const { body, styles } = renderBody(rows);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>noggin CLI — human vs JSON output</title>
<style>${standaloneChromeStyles()}${styles}</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * Render the scenario list as a self-contained HTML fragment plus the
 * scenario-specific CSS needed to display it. Used by the docs site
 * so the demo page can live inside the regular site chrome (sidebar +
 * footer) instead of being a standalone page.
 *
 * Returns `{ body, styles }`. `body` is the inner HTML to drop into
 * the page's <main>; `styles` is the CSS to drop into a <style> tag
 * (no chrome — just the scenario layout and badges).
 */
export function renderBody(rows) {
  const grouped = new Map();
  rows.forEach((r, idx) => {
    if (!grouped.has(r.section)) grouped.set(r.section, []);
    grouped.get(r.section).push({ ...r, idx });
  });

  const sectionNav = [...grouped.entries()]
    .map(([sec, list]) => `<li><a href="#sec-${esc(sec)}">${esc(sec)}</a> <span class="muted">(${list.length})</span></li>`)
    .join('');

  const sections = [...grouped.entries()]
    .map(([sec, list]) => `<h2 id="sec-${esc(sec)}">${esc(sec)}</h2>${list.map((s) => renderScenario(s, s.idx)).join('\n')}`)
    .join('\n');

  return {
    body: `<h1>Verb demo</h1>
<p class="lead">Each scenario seeds a fresh temp noggin, then runs the same command twice —
once for human output, once with <code>--json</code> — so the two columns describe
identical state. Jump to a section:</p>
<ul class="section-jump">${sectionNav}</ul>
${sections}`,
    styles: scenarioStyles(),
  };
}

/** Build the scenario-area CSS (no page chrome). */
function scenarioStyles() {
  return `
  .section-jump { list-style: none; padding: 0; margin: 0 0 24px; display: flex; flex-wrap: wrap; gap: 6px 14px; }
  .section-jump li { padding: 0; }
  .section-jump a { text-transform: capitalize; }
  h2 { text-transform: capitalize; }
  .scenario { margin: 0 0 28px; }
  .scenario h3 { font-size: 16px; margin: 0 0 4px; }
  .blurb { color: var(--muted); margin: 0 0 10px; }
  .before { border: 1px dashed var(--border); border-radius: 6px; overflow: hidden;
            display: flex; flex-direction: column; margin-bottom: 6px; opacity: 0.85; }
  .before-bar .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
                       color: var(--muted); font-weight: 700; margin-right: 8px; }
  .after-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
                 color: var(--muted); font-weight: 700; margin: 4px 0 6px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 1100px) { .cols { grid-template-columns: 1fr; } }
  .col { border: 1px solid var(--border); border-radius: 6px; overflow: hidden;
         display: flex; flex-direction: column; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px;
         background: var(--panel); border-bottom: 1px solid var(--border); font-size: 12px; }
  .bar code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
              background: transparent; padding: 0; flex: 1; border: 0;
              white-space: pre; overflow-x: auto; }
  .badge { font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: 600;
           color: white; white-space: nowrap; }
  .badge.ok   { background: var(--ok); }
  .badge.warn { background: var(--warn); }
  .badge.err  { background: var(--err); }
  .stream { font-size: 11px; color: var(--muted); }
  .scenario pre { margin: 0; padding: 10px 12px; background: #0d1117; color: #e6edf3;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px;
        white-space: pre; overflow-x: auto; border-radius: 0; }
  @media (prefers-color-scheme: dark) {
    .scenario pre { background: #010409; }
  }
`;
}

/** Page-chrome CSS used only when build-demo-html.mjs writes a standalone page. */
function standaloneChromeStyles() {
  return `
  :root {
    --fg: #1f2328; --muted: #6e7781; --bg: #ffffff; --panel: #f6f8fa;
    --border: #d0d7de; --ok: #1a7f37; --warn: #9a6700; --err: #d1242f; --accent: #0969da;
  }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #e6edf3; --muted: #8d96a0; --bg: #0d1117; --panel: #161b22;
            --border: #30363d; --accent: #58a6ff; }
  }
  * { box-sizing: border-box; }
  html, body { background: var(--bg); color: var(--fg); }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         margin: 0; padding: 24px 32px; max-width: 1200px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  h2 { font-size: 18px; margin: 32px 0 12px;
       padding-bottom: 6px; border-bottom: 1px solid var(--border); }
  .lead { color: var(--muted); margin: 0 0 16px; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  ul { padding-left: 20px; }
  code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
         background: var(--panel); padding: 1px 5px; border-radius: 3px;
         border: 1px solid var(--border); }
  .muted { color: var(--muted); }
`;
}

/** Run all scenarios; returns the row array (one entry per scenario). */
export function runAllScenarios() {
  return scenarios.map(runScenario);
}

// ── Main ────────────────────────────────────────────────────────────────────

function resolveOutPath() {
  const argv = process.argv.slice(2);
  let explicit = process.env.DEMO_OUT || null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) { explicit = argv[i + 1]; i++; }
    else if (argv[i].startsWith('--out=')) { explicit = argv[i].slice('--out='.length); }
  }
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);
  return path.join(tmpdir(), `noggin-demo-${Date.now()}.html`);
}

// Only run scenarios + write a file when invoked as a script.
// When imported (e.g. by docs/site/generators/demo.mjs), the consumer
// drives renderBody()/runAllScenarios() directly.
if (import.meta.url === url.pathToFileURL(process.argv[1] ?? '').href) {
  const rows = scenarios.map(runScenario);
  const html = renderHtml(rows);
  const outPath = resolveOutPath();
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, 'utf8');
  process.stdout.write(outPath + '\n');
}
