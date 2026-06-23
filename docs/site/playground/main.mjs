// Browser entry for the docs-site noggin playground.
//
// Wires a localStorage-backed noggin into the same `runCommand`
// dispatcher used by the node CLI, then mounts the tree-view tab
// against the same noggin instance so the two panels stay in sync.
//
// Bundled into dist/playground/playground.js by docs/site/build.mjs.

import { runCommand } from '../../../cli/noggin.mjs';
import { verbs } from '../../../cli/noggin-api.mjs';
import { LocalStorageNoggin, DEFAULT_STORAGE_KEY } from './localStorageNoggin.mjs';
import { tokenize } from './tokenize.mjs';
import { mountTree } from './tree.mjs';
import { SAMPLE_DOC } from './sampleData.mjs';
import { VERBS } from './verbDocs.mjs';

const noggin = new LocalStorageNoggin(DEFAULT_STORAGE_KEY, globalThis.localStorage);

// ── CLI tab wiring ──────────────────────────────────────────────────

const scrollback = document.getElementById('cli-scrollback');
const input = document.getElementById('cli-input');
const promptEl = document.getElementById('cli-prompt');
const storageInfo = document.getElementById('pg-storage-info');
const loadSampleBtn = document.getElementById('pg-load-sample');
const resetBtn = document.getElementById('pg-reset');

const history = [];
let historyCursor = 0;
let pendingDraft = '';

if (promptEl) promptEl.textContent = '$ noggin';

function appendBlock(text, kind) {
  if (!text) return;
  const pre = document.createElement('pre');
  pre.className = `cli-line cli-${kind}`;
  pre.textContent = text.replace(/\n$/, '');
  scrollback.appendChild(pre);
  scrollback.scrollTop = scrollback.scrollHeight;
}

function appendEcho(line) {
  const div = document.createElement('div');
  div.className = 'cli-echo';
  const p = document.createElement('span');
  p.className = 'cli-echo-prompt';
  p.textContent = '$ noggin ';
  const c = document.createElement('span');
  c.className = 'cli-echo-cmd';
  c.textContent = line;
  div.append(p, c);
  scrollback.appendChild(div);
  scrollback.scrollTop = scrollback.scrollHeight;
}

async function runLine(rawLine) {
  const line = rawLine.trim();
  if (!line) return;
  appendEcho(line);
  history.push(line);
  historyCursor = history.length;

  let argv;
  try { argv = tokenize(line); }
  catch (e) {
    appendBlock(`noggin: ${e.message}\n`, 'err');
    return;
  }

  if (argv[0] === 'noggin') argv = argv.slice(1);

  let stdoutBuf = '';
  let stderrBuf = '';
  await runCommand(argv, {
    io: {
      stdout: (s) => { stdoutBuf += s; },
      stderr: (s) => { stderrBuf += s; },
    },
    openNoggin: () => noggin,
    describeSource: () => 'localStorage (browser playground)',
    defaultLocationLabel: 'localStorage (browser playground)',
  });
  if (stdoutBuf) appendBlock(stdoutBuf, 'out');
  if (stderrBuf) appendBlock(stderrBuf, 'err');
}

input.addEventListener('keydown', async (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    const line = input.value;
    input.value = '';
    pendingDraft = '';
    try { await runLine(line); }
    catch (e) { appendBlock(`internal error: ${e.message || e}\n`, 'err'); }
    renderHelp('');
    input.focus();
    return;
  }
  if (ev.key === 'ArrowUp') {
    if (history.length === 0) return;
    ev.preventDefault();
    if (historyCursor === history.length) pendingDraft = input.value;
    historyCursor = Math.max(0, historyCursor - 1);
    input.value = history[historyCursor] || '';
    renderHelp(input.value);
    return;
  }
  if (ev.key === 'ArrowDown') {
    if (history.length === 0) return;
    ev.preventDefault();
    historyCursor = Math.min(history.length, historyCursor + 1);
    input.value = historyCursor === history.length ? pendingDraft : history[historyCursor];
    renderHelp(input.value);
  }
});

// ── CLI context help (updates as the user types) ────────────────────

const helpEl = document.getElementById('cli-help');

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const EMPTY_HELP =
  `type <code>help</code> for verbs, or try: <code>push "ship v1"</code>` +
  ` &middot; <span style="opacity:0.8">\u2191/\u2193 for history &middot;` +
  ` <a href="../cli/">CLI reference</a></span>`;

function renderHelp(line) {
  if (!helpEl) return;
  const trimmed = (line || '').trim();
  if (!trimmed) { helpEl.innerHTML = EMPTY_HELP; return; }
  // First whitespace-delimited token is the candidate verb. Cheap and
  // good enough — we don't try to honour quotes here.
  const first = trimmed.split(/\s+/)[0].toLowerCase();
  const v = VERBS.find((x) => x.name === first);
  if (!v) {
    helpEl.innerHTML =
      `<span class="cli-help-verb">${escHtml(first)}</span> ` +
      `is not a verb &mdash; try <code>help</code>.`;
    return;
  }
  const flagsHtml = v.flags && v.flags.length
    ? `<ul class="cli-help-flags">${v.flags
        .map((f) => `<li><code>${escHtml(f.flag)}</code> &mdash; ${escHtml(f.desc)}</li>`)
        .join('')}</ul>`
    : '';
  helpEl.innerHTML =
    `<span class="cli-help-verb">${escHtml(v.name)}</span> ` +
    `<span class="cli-help-desc">&mdash; ${escHtml(v.description)}</span>` +
    `<code class="cli-help-syntax">${escHtml(v.syntax)}</code>` +
    flagsHtml;
}

renderHelp('');
input.addEventListener('input', () => renderHelp(input.value));

// ── Tree tab wiring ─────────────────────────────────────────────────

const tvList = document.getElementById('tv-list');
const tvDetails = document.getElementById('tv-details');
const tvSummary = document.getElementById('tv-summary');
const tvAddRoot = document.getElementById('tv-add-root');

let tree = null;
if (tvList && tvDetails) {
  tree = mountTree({
    listRoot: tvList,
    detailsRoot: tvDetails,
    summaryEl: tvSummary,
    noggin,
  });
}

if (tvAddRoot) {
  tvAddRoot.addEventListener('click', async () => {
    const title = prompt('Title for the new root item:');
    if (!title || !title.trim()) return;
    const hasRoots = noggin.snapshot().items.some((it) => !it.parentKey);
    if (!hasRoots) {
      await verbs.push(noggin, { title: title.trim() });
    } else {
      const rootCount = noggin.snapshot().items.filter((it) => !it.parentKey).length;
      await verbs.add(noggin, {
        title: title.trim(),
        placement: { kind: 'after', anchor: `/${rootCount}` },
      });
    }
  });
}

// ── Outer toolbar (applies to both tabs) ────────────────────────────

function updateStorageInfo() {
  if (!storageInfo) return;
  const doc = noggin.snapshot();
  if (!doc.items.length) { storageInfo.textContent = 'empty'; return; }
  const total = doc.items.length;
  const done = doc.items.filter((it) => it.done).length;
  storageInfo.textContent = `${total} item${total === 1 ? '' : 's'} · ${done} done`;
}
noggin.onDidChange(updateStorageInfo);
updateStorageInfo();

if (loadSampleBtn) {
  loadSampleBtn.addEventListener('click', () => {
    if (noggin.hasData()) {
      if (!confirm('Load sample data? This will overwrite your current playground noggin.')) return;
    }
    noggin.loadDocument(SAMPLE_DOC);
    appendBlock('(loaded sample data — switch to the Tree tab to explore)\n', 'hint');
    // Auto-switch to the tree tab so the change is obvious.
    const treeTab = Array.from(document.querySelectorAll('.pg-tab'))
      .find((t) => t.textContent.trim() === 'Tree');
    treeTab?.click();
  });
}

if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    if (noggin.hasData()) {
      if (!confirm('Reset the playground? This wipes the in-browser store.')) return;
    }
    noggin.reset();
    scrollback.innerHTML = '';
    appendBlock('(playground reset)\n', 'hint');
    input.focus();
  });
}

// ── Welcome hint ────────────────────────────────────────────────────

appendBlock('type "help" for verbs, or try: push "ship v1"\n', 'hint');
input.focus();
