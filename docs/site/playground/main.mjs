// Browser entry for the docs-site noggin playground.
//
// Wires a localStorage-backed noggin into the same `runCommand`
// dispatcher used by the node CLI, then mounts the tree-view tab
// against the same noggin instance so the two panels stay in sync.
//
// Bundled into dist/playground/playground.js by docs/site/build.mjs.

import { runCommand } from '../../../cli/noggin.mjs';
import { verbs } from '../../../engine/noggin-api.mjs';
import { LocalStorageNoggin, DEFAULT_STORAGE_KEY } from './localStorageNoggin.mjs';
import { tokenize } from './tokenize.mjs';
import { mountTreeApp } from './tree-app.tsx';
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
  scrollToEnd();
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
  scrollToEnd();
}

function scrollToEnd() {
  if (!scrollback) return;
  // Defer to next frame so layout/reflow completes before we measure.
  requestAnimationFrame(() => {
    scrollback.scrollTop = scrollback.scrollHeight;
  });
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
  scrollToEnd();
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

const helpRoot = document.getElementById('cli-help');
const helpEl = document.getElementById('cli-help-body');
const helpToggle = document.getElementById('cli-help-toggle');
const HELP_COLLAPSED_KEY = 'noggin-playground:help-collapsed';

if (helpRoot && helpToggle) {
  const collapsed = globalThis.localStorage?.getItem(HELP_COLLAPSED_KEY) === '1';
  setHelpCollapsed(collapsed);
  helpToggle.addEventListener('click', () => {
    setHelpCollapsed(!helpRoot.classList.contains('collapsed'));
  });
}

function setHelpCollapsed(collapsed) {
  if (!helpRoot || !helpToggle) return;
  helpRoot.classList.toggle('collapsed', collapsed);
  helpToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  try {
    globalThis.localStorage?.setItem(HELP_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch { /* ignore quota */ }
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const EMPTY_HELP_LEAD =
  `type a verb to get started, or try <code>push "ship v1"</code>:`;

function renderVerbTable(leadHtml) {
  const rows = VERBS
    .map((v) => `<tr><td><code>${escHtml(v.name)}</code></td>` +
                `<td>${escHtml(v.summary || v.description || '')}</td></tr>`)
    .join('');
  return (leadHtml ? `<div class="cli-help-lead">${leadHtml}</div>` : '') +
    `<table class="cli-help-table"><tbody>${rows}</tbody></table>`;
}

function renderHelp(line) {
  if (!helpEl) return;
  const trimmed = (line || '').trim();
  if (!trimmed) {
    helpEl.innerHTML = renderVerbTable(EMPTY_HELP_LEAD);
    return;
  }
  // First whitespace-delimited token is the candidate verb. Cheap and
  // good enough — we don't try to honour quotes here.
  const first = trimmed.split(/\s+/)[0].toLowerCase();
  const v = VERBS.find((x) => x.name === first);
  if (!v) {
    const lead =
      `<span class="cli-help-verb cli-help-bad">${escHtml(first)}</span> ` +
      `is not a verb. Available verbs:`;
    helpEl.innerHTML = renderVerbTable(lead);
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

const tvRoot = document.getElementById('tv-root');
if (tvRoot) {
  mountTreeApp({ root: tvRoot, noggin });
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

input.focus();
