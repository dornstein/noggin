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
  /* The Tree tab mounts a React app from @noggin/ui. The library
     ships its own styles + theme via playground.css; everything
     below is just the surrounding chrome (split panes + responsive
     breakpoint) that wraps the components. */
  .pg-tree-app {
    display: grid;
    grid-template-columns: minmax(280px, 1.2fr) minmax(280px, 1fr);
    gap: 12px;
    min-height: 460px;
  }
  @media (max-width: 760px) {
    .pg-tree-app { grid-template-columns: 1fr; }
  }
  .pg-tree-pane,
  .pg-details-pane {
    border: 1px solid var(--noggin-border, var(--border, #ddd));
    border-radius: 8px;
    background: var(--noggin-canvas-bg, var(--bg, #fff));
    color: var(--noggin-canvas-fg, var(--fg, #111));
    display: flex; flex-direction: column;
    min-height: 460px;
    overflow: hidden;
  }
  .pg-tree-pane { padding: 4px 0; }
  /* Let the virtualized tree fill the pane vertically. */
  .pg-tree-pane > * { flex: 1; min-height: 0; }
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
  <div id="tv-root"></div>
  <p class="pg-note">
    Click a row to select it. Use <kbd>Enter</kbd> to add a sibling,
    <kbd>Ctrl+Enter</kbd> to add a child, <kbd>F2</kbd> to rename,
    <kbd>Space</kbd> to toggle done, <kbd>Alt+↑/↓</kbd> to reorder, or
    right-click for a contextual menu. Drag rows to move them.
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
<link rel="stylesheet" href="./playground.css">
`;
}
