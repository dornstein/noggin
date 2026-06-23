// Generate the playground page: a CLI tab and a tree tab, both backed
// by the same in-browser localStorage noggin. The HTML mounts the UI;
// the bundled JS (built separately by docs/site/build.mjs via esbuild)
// wires it up.

export function buildPlaygroundPage() {
  return `
<style>
  /* ── Layout chrome ──────────────────────────────────────────────── */
  .pg-intro { margin-bottom: 12px; }
  .pg-toolbar {
    display: flex; gap: 8px; align-items: center;
    padding: 8px 0; margin-bottom: 8px;
    font-size: 13px;
  }
  .pg-toolbar .spacer { flex: 1; }
  .pg-toolbar .muted { color: var(--muted, #666); font-size: 12px; }
  .pg-btn {
    font: inherit; padding: 5px 12px;
    background: var(--panel, #f6f8fa); color: var(--fg, #111);
    border: 1px solid var(--border, #ddd); border-radius: 5px; cursor: pointer;
  }
  .pg-btn:hover { background: var(--accent-bg, rgba(0,0,0,0.06)); }
  .pg-btn.primary {
    background: var(--accent, #0969da); color: #fff;
    border-color: var(--accent, #0969da);
  }
  .pg-btn.primary:hover { background: var(--accent, #0969da); filter: brightness(0.92); }

  .pg-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border, #ddd); margin-bottom: 12px; }
  .pg-tab {
    padding: 8px 14px; cursor: pointer; border: none; background: transparent;
    font: inherit; color: var(--muted, #666);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .pg-tab.active { color: var(--fg, #111); border-bottom-color: var(--accent, #0969da); }
  .pg-tab[disabled] { opacity: 0.5; cursor: not-allowed; }
  .pg-panel { display: none; }
  .pg-panel.active { display: block; }
  .pg-note { color: var(--muted, #666); font-size: 13px; margin-top: 10px; }

  /* ── CLI tab ────────────────────────────────────────────────────── */
  .cli-shell {
    background: #0e1116; color: #d7dde4;
    border-radius: 8px; padding: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13.5px; line-height: 1.45;
    display: flex; flex-direction: column;
    min-height: 380px; max-height: 70vh;
  }
  .cli-promptline {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 10px;
    background: #1c222b;
    border: 1px solid #2a2f37;
    border-radius: 6px;
    padding: 6px 10px;
    transition: border-color 0.15s, box-shadow 0.15s;
    flex-shrink: 0;
  }
  .cli-promptline:focus-within {
    border-color: #4a8af4;
    box-shadow: 0 0 0 2px rgba(74, 138, 244, 0.25);
  }
  .cli-promptline .prompt { color: #7bc18d; font-weight: 600; flex-shrink: 0; }
  .cli-promptline input {
    flex: 1; background: transparent; border: none; outline: none;
    color: inherit; font: inherit; padding: 2px 0;
  }
  .cli-promptline input::placeholder { color: #5c6470; }

  /* Inline help area inside the shell, below the prompt. */
  .cli-help {
    margin-bottom: 10px;
    padding: 6px 10px;
    background: #161b22;
    border: 1px solid #2a2f37;
    border-radius: 6px;
    color: #8a93a0;
    font-size: 12.5px;
    line-height: 1.5;
    flex-shrink: 0;
  }
  .cli-help-toggle {
    display: flex; align-items: center; gap: 6px;
    width: 100%;
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    color: #8a93a0;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  .cli-help-toggle:hover { color: #d7dde4; }
  .cli-help-toggle:focus-visible { outline: 1px solid #4a8af4; outline-offset: 2px; border-radius: 3px; }
  .cli-help-chevron {
    display: inline-block;
    width: 0.9em;
    transition: transform 0.15s;
    color: #8a93a0;
  }
  .cli-help-toggle-label {
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #6c7480;
  }
  .cli-help-body {
    margin-top: 4px;
  }
  .cli-help.collapsed { padding-bottom: 4px; }
  .cli-help.collapsed .cli-help-body { display: none; }
  .cli-help.collapsed .cli-help-chevron { transform: rotate(-90deg); }
  .cli-help code {
    font: inherit;
    background: rgba(255,255,255,0.06);
    padding: 1px 5px; border-radius: 3px;
    color: #d7dde4;
  }
  .cli-help-verb { color: #9ecbff; font-weight: 600; }
  .cli-help-desc { color: #d7dde4; }
  .cli-help-syntax {
    display: block;
    margin: 3px 0 0;
    color: #c9d1d9;
  }
  .cli-help-flags { list-style: none; margin: 4px 0 0; padding: 0; }
  .cli-help-flags li { margin: 0; padding: 1px 0; color: #b1bac4; }
  .cli-help-flags code { background: transparent; padding: 0; color: #c9d1d9; }
  .cli-help-bad { color: #ff8a80; }
  .cli-help-lead { margin-bottom: 6px; }
  .cli-help-table {
    border-collapse: collapse;
    width: 100%;
    margin: 2px 0 0;
    display: table;
    overflow: visible;
    font-size: inherit;
  }
  .cli-help-table td {
    padding: 2px 10px 2px 0;
    border: none;
    vertical-align: top;
    color: #b1bac4;
  }
  .cli-help-table td:first-child {
    width: 1%;
    white-space: nowrap;
  }
  .cli-help-table td code {
    background: transparent;
    padding: 0;
    border-radius: 0;
    color: #9ecbff;
    font-weight: 600;
  }

  .cli-scrollback {
    flex: 1; overflow-y: auto; padding-right: 4px;
    white-space: pre-wrap;
  }
  .cli-line { margin: 0 0 6px 0; white-space: pre-wrap; font: inherit; }
  .cli-out { color: #d7dde4; }
  .cli-err { color: #ff8a80; }
  .cli-hint { color: #8a93a0; font-style: italic; }
  .cli-echo { margin: 8px 0 4px 0; color: #9ecbff; }
  .cli-echo-prompt { color: #7bc18d; font-weight: 600; }
  .cli-echo-cmd { color: #d7dde4; }

  /* ── Tree tab ───────────────────────────────────────────────────── */
  .tv-split {
    display: grid;
    grid-template-columns: minmax(280px, 1.2fr) minmax(260px, 1fr);
    gap: 12px;
    min-height: 460px;
  }
  @media (max-width: 760px) {
    .tv-split { grid-template-columns: 1fr; }
  }
  .tv-pane {
    border: 1px solid var(--border, #ddd);
    border-radius: 8px;
    background: var(--bg, #fff);
    display: flex; flex-direction: column;
    min-height: 360px;
    overflow: hidden;
  }
  .tv-pane-header {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border, #eee);
    font-size: 12px;
    font-weight: 600;
    color: var(--muted, #666);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: var(--panel, #f6f8fa);
    display: flex; align-items: center; justify-content: space-between;
  }
  .tv-pane-header .muted { text-transform: none; letter-spacing: 0; font-weight: 400; }
  .tv-pane-body { flex: 1; overflow: auto; padding: 4px 0; }
  .tv-pane-footer {
    padding: 6px 8px;
    border-top: 1px solid var(--border, #eee);
    background: var(--panel, #f6f8fa);
  }

  .tv-empty { padding: 24px; color: var(--muted, #666); text-align: center; font-size: 14px; }
  .tv-tree { list-style: none; margin: 0; padding: 0; }
  .tv-node > .tv-tree { padding-left: 0; }
  .tv-row {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 8px;
    line-height: 1.4;
    cursor: pointer;
    border-left: 2px solid transparent;
    user-select: none;
  }
  .tv-row:hover { background: var(--accent-bg, rgba(0,0,0,0.04)); }
  .tv-row:hover .tv-actions { opacity: 1; }
  .tv-selected > .tv-row {
    background: var(--accent-bg, rgba(9,105,218,0.10));
    border-left-color: var(--accent, #0969da);
  }
  .tv-active > .tv-row .tv-title { font-weight: 600; }
  .tv-done > .tv-row .tv-title { color: var(--muted, #999); text-decoration: line-through; }

  .tv-caret {
    border: none; background: transparent; cursor: pointer;
    padding: 0; width: 16px; height: 16px;
    display: inline-flex; align-items: center; justify-content: center;
    color: var(--muted, #777);
    flex-shrink: 0;
  }
  .tv-caret:hover { color: var(--fg, #111); }
  .tv-caret svg { width: 10px; height: 10px; transition: transform 0.12s; }
  .tv-caret.collapsed svg { transform: rotate(-90deg); }
  .tv-caret.leaf { visibility: hidden; pointer-events: none; }

  .tv-path {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11.5px;
    color: var(--muted, #888);
    flex-shrink: 0;
    min-width: 38px;
  }
  .tv-status {
    width: 14px; flex-shrink: 0;
    display: inline-flex; align-items: center; justify-content: center;
    color: var(--muted, #999);
  }
  .tv-status.done { color: #2ea043; }
  .tv-status svg { width: 12px; height: 12px; }

  .tv-title-wrap {
    flex: 1; min-width: 0;
    display: flex; align-items: center; gap: 4px;
  }
  .tv-title {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--fg, #111);
    font-size: 13.5px;
  }
  .tv-active-pin { color: var(--accent, #0969da); font-size: 11px; flex-shrink: 0; }
  .tv-note-flag { color: var(--muted, #999); font-size: 12px; flex-shrink: 0; }

  .tv-actions {
    display: inline-flex; gap: 1px;
    opacity: 0; transition: opacity 0.1s;
    flex-shrink: 0;
  }
  .tv-icon-btn {
    border: none; background: transparent; cursor: pointer;
    padding: 2px 5px; border-radius: 3px;
    font: inherit; color: var(--muted, #666);
    display: inline-flex; align-items: center; justify-content: center;
  }
  .tv-icon-btn:hover { background: var(--accent-bg, rgba(0,0,0,0.08)); color: var(--fg, #111); }
  .tv-icon-btn svg { width: 13px; height: 13px; }

  /* Details pane */
  .tv-details-empty { padding: 24px; color: var(--muted, #666); font-size: 13px; }
  .tv-details {
    padding: 14px 16px;
    display: flex; flex-direction: column; gap: 12px;
  }
  .tv-details-pathrow {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px; color: var(--muted, #888);
  }
  .tv-details-titlerow {
    display: flex; align-items: flex-start; gap: 8px;
  }
  .tv-details-title { flex: 1; margin: 0; font-size: 17px; font-weight: 600; line-height: 1.3; word-break: break-word; color: var(--fg, #111); }
  .tv-details-title.done { text-decoration: line-through; color: var(--muted, #999); }
  .tv-details-badges { display: flex; gap: 6px; flex-wrap: wrap; }
  .tv-details-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    background: var(--accent-bg, rgba(9, 105, 218, 0.12));
    color: var(--accent, #0969da);
  }
  .tv-details-badge.done {
    background: rgba(46, 160, 67, 0.16);
    color: #2ea043;
  }
  .tv-details-meta {
    font-size: 12px; color: var(--muted, #888);
  }
  .tv-details h4 {
    margin: 6px 0 4px;
    font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.04em; color: var(--muted, #666);
  }
  .tv-details-notes { display: flex; flex-direction: column; gap: 8px; }
  .tv-details-note {
    border-left: 3px solid var(--border, #ddd);
    padding: 4px 10px;
    font-size: 13px;
  }
  .tv-details-note .ts {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px; color: var(--muted, #888);
    margin-bottom: 2px;
  }
  .tv-details-note .text { white-space: pre-wrap; line-height: 1.45; }
  .tv-details-no-notes { color: var(--muted, #999); font-style: italic; font-size: 13px; }
  .tv-details-actions {
    display: flex; gap: 6px; flex-wrap: wrap;
  }
  .tv-details-actions .pg-btn { font-size: 13px; padding: 4px 10px; }
</style>

<div class="pg-intro">
  <p>This is a live noggin running entirely in your browser. State persists in
  <code>localStorage</code> on this device — close the tab, come back, your
  tree is still there. Nothing is sent to a server.</p>
  <p>Both tabs operate on the same noggin: changes in the CLI tab show up in
  the Tree tab and vice versa.</p>
</div>

<div class="pg-toolbar">
  <button id="pg-load-sample" class="pg-btn primary" type="button">Load sample data</button>
  <button id="pg-reset" class="pg-btn" type="button">Reset playground</button>
  <span class="spacer"></span>
  <span class="muted">Stored in <code>localStorage</code> · <span id="pg-storage-info">empty</span></span>
</div>

<div class="pg-tabs" role="tablist">
  <button class="pg-tab active" data-panel="pg-cli" role="tab" aria-selected="true">CLI</button>
  <button class="pg-tab" data-panel="pg-tree" role="tab" aria-selected="false">Tree</button>
</div>

<div id="pg-cli" class="pg-panel active" role="tabpanel">
  <div class="cli-shell">
    <div class="cli-promptline">
      <span id="cli-prompt" class="prompt">$ noggin</span>
      <input id="cli-input" type="text" autocomplete="off" autocapitalize="off"
             spellcheck="false" aria-label="noggin command" placeholder="add &quot;ship v1&quot;">
    </div>
    <div class="cli-help" id="cli-help">
      <button id="cli-help-toggle" class="cli-help-toggle" type="button"
              aria-expanded="true" aria-controls="cli-help-body">
        <span class="cli-help-chevron" aria-hidden="true">▾</span>
        <span class="cli-help-toggle-label">Hint</span>
      </button>
      <div id="cli-help-body" class="cli-help-body" aria-live="polite"></div>
    </div>
    <div id="cli-scrollback" class="cli-scrollback" aria-live="polite"></div>
  </div>
</div>

<div id="pg-tree" class="pg-panel" role="tabpanel">
  <div class="tv-split">
    <div class="tv-pane">
      <div class="tv-pane-header">
        <span>Tree</span>
        <span class="muted" id="tv-summary"></span>
      </div>
      <div id="tv-list" class="tv-pane-body"></div>
      <div class="tv-pane-footer">
        <button id="tv-add-root" class="pg-btn" type="button">+ New root item</button>
      </div>
    </div>
    <div class="tv-pane">
      <div class="tv-pane-header"><span>Details</span></div>
      <div id="tv-details" class="tv-pane-body"></div>
    </div>
  </div>
  <p class="pg-note">
    Click a row to select it; double-click (or use the “Make active” button)
    to <code>goto</code>. Hover a row to reveal quick actions.
  </p>
</div>

<script>
  // Tab toggler (the bundled module handles each panel itself).
  (function () {
    const tabs = document.querySelectorAll('.pg-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        if (tab.disabled) return;
        tabs.forEach((t) => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
        tab.classList.add('active'); tab.setAttribute('aria-selected', 'true');
        document.querySelectorAll('.pg-panel').forEach((p) => p.classList.remove('active'));
        document.getElementById(tab.dataset.panel).classList.add('active');
      });
    });
  })();
</script>
<script type="module" src="./playground.js"></script>
`;
}
