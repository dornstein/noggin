import * as vscode from 'vscode';
import { marked } from 'marked';
import type { Item } from '../skills/noggin/noggin-api.mjs';
import { NogginHandle } from './noggin.js';

marked.setOptions({ gfm: true, breaks: true });

type DetailsTarget = { source: 'selection' | 'active' | 'none'; item: Item | null };

export class NogginDetailsView implements vscode.WebviewViewProvider {
  static readonly viewType = 'nogginDetails';

  private view: vscode.WebviewView | null = null;
  private get webview(): vscode.Webview | null { return this.view?.webview ?? null; }
  private current: Item | null = null;
  private currentSource: DetailsTarget['source'] = 'none';

  constructor(
    private readonly handle: NogginHandle,
    private readonly output: vscode.OutputChannel,
  ) {
    handle.onDidChange(() => this.rerender());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    view.onDidDispose(() => { this.view = null; });
    this.rerender();
  }

  setSelection(items: readonly Item[]): void {
    if (items.length > 0) {
      this.current = items[0]!;
      this.currentSource = 'selection';
    } else {
      this.current = this.handle.active;
      this.currentSource = this.current ? 'active' : 'none';
    }
    this.rerender();
  }

  private resolveTarget(): DetailsTarget {
    if (!this.handle.isOpen) return { source: 'none', item: null };
    // If our cached selection still exists in the store, prefer it.
    if (this.currentSource === 'selection' && this.current) {
      const fresh = this.handle.findByKey(this.current.key);
      if (fresh) return { source: 'selection', item: fresh };
    }
    const active = this.handle.active;
    if (active) return { source: 'active', item: active };
    return { source: 'none', item: null };
  }

  private rerender(): void {
    if (!this.webview) return;
    const target = this.resolveTarget();
    this.current = target.item;
    this.currentSource = target.source;
    this.webview.html = this.renderHtml(target);
    this.updateHeader(target);
  }

  /**
   * Update the section header ("DETAILS — 1.2.3.") so the user can see which
   * item the pane is focused on without scrolling its content. We omit the
   * title here because it already shows large in the pane body.
   */
  private updateHeader(target: DetailsTarget): void {
    if (!this.view) return;
    if (!target.item) { this.view.description = undefined; return; }
    const path = this.handle.pathOf(target.item);
    this.view.description = path ? path.replace(/\//g, '.') + '.' : undefined;
  }

  private onMessage(msg: { type?: string; command?: string; direction?: 'up' | 'down'; title?: string; text?: string; href?: string }): void {
    if (msg?.type === 'invoke' && typeof msg.command === 'string') {
      const item = this.current ?? undefined;
      vscode.commands.executeCommand(msg.command, item);
      return;
    }
    if (msg?.type === 'reorder' && (msg.direction === 'up' || msg.direction === 'down')) {
      this.reorder(msg.direction);
      return;
    }
    if (msg?.type === 'retitle' && typeof msg.title === 'string') {
      this.retitle(msg.title);
      return;
    }
    if (msg?.type === 'addNote' && typeof msg.text === 'string') {
      this.addNote(msg.text);
      return;
    }
    if (msg?.type === 'previewNote' && typeof msg.text === 'string') {
      this.webview?.postMessage({ type: 'notePreview', html: renderMarkdown(msg.text) });
      return;
    }
    if (msg?.type === 'openExternal' && typeof msg.href === 'string') {
      try {
        const uri = vscode.Uri.parse(msg.href, true);
        if (uri.scheme === 'http' || uri.scheme === 'https' || uri.scheme === 'mailto') {
          vscode.env.openExternal(uri);
        }
      } catch { /* ignore malformed urls */ }
      return;
    }
  }

  private siblingNeighbors(item: Item): { prev: Item | null; next: Item | null } {
    const sibs = this.handle.childrenOf(item.parentKey || null);
    const idx = sibs.findIndex((s) => s.key === item.key);
    if (idx < 0) return { prev: null, next: null };
    return {
      prev: idx > 0 ? sibs[idx - 1]! : null,
      next: idx < sibs.length - 1 ? sibs[idx + 1]! : null,
    };
  }

  /** Currently-focused item in the details pane, if any. */
  getCurrent(): Item | null { return this.current; }

  /** Public wrapper for the reorder gesture (used by view/title icons). */
  async reorderPublic(direction: 'up' | 'down'): Promise<void> {
    return this.reorder(direction);
  }

  private async reorder(direction: 'up' | 'down'): Promise<void> {
    const item = this.current;
    if (!item) return;
    const { prev, next } = this.siblingNeighbors(item);
    const anchor = direction === 'up' ? prev : next;
    if (!anchor) return;
    const srcPath = this.handle.pathOf(item);
    const anchorPath = this.handle.pathOf(anchor);
    if (!srcPath || !anchorPath) return;
    const kind = direction === 'up' ? 'before' : 'after';
    try {
      this.handle.move({ path: srcPath, placement: { kind, anchor: anchorPath } });
      this.output.appendLine(`[${new Date().toISOString()}] noggin move ${srcPath} --${kind} ${anchorPath}`);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Noggin: ${m}`);
      this.output.appendLine(`[${new Date().toISOString()}] ERROR: ${m}`);
    }
  }

  private async addNote(rawText: string): Promise<void> {
    const item = this.current;
    if (!item) return;
    const text = rawText.trim();
    if (!text) return;
    const srcPath = this.handle.pathOf(item);
    if (!srcPath) return;
    try {
      this.handle.note({ path: srcPath, text });
      this.output.appendLine(`[${new Date().toISOString()}] noggin note ${srcPath}`);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Noggin: ${m}`);
      this.output.appendLine(`[${new Date().toISOString()}] ERROR: ${m}`);
    }
  }

  private async retitle(rawTitle: string): Promise<void> {
    const item = this.current;
    if (!item) return;
    const title = rawTitle.trim();
    if (!title || title === item.title) {
      this.rerender();
      return;
    }
    const srcPath = this.handle.pathOf(item);
    if (!srcPath) return;
    try {
      this.handle.retitle({ path: srcPath, title });
      this.output.appendLine(`[${new Date().toISOString()}] noggin retitle ${srcPath} --title ${title}`);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Noggin: ${m}`);
      this.output.appendLine(`[${new Date().toISOString()}] ERROR: ${m}`);
      this.rerender();
    }
  }

  private renderHtml(target: DetailsTarget): string {
    const css = `
      body { padding: 8px 12px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); font-size: var(--vscode-font-size); }
      .title-row { display: flex; align-items: center; gap: 6px; margin: 0 0 12px 0; }
      .title-row .state-icon { flex: 0 0 18px; width: 18px; height: 18px; padding: 0; background: none; border: none; cursor: pointer; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; }
      .title-row .state-icon svg { width: 16px; height: 16px; display: block; pointer-events: none; }
      .title-row .state-icon.done { color: var(--vscode-charts-green); }
      .title-row .state-icon.open { color: var(--vscode-foreground); opacity: 0.7; }
      .title-row .state-icon:hover { background: var(--vscode-list-hoverBackground); }
      .title-row .state-icon:hover.open { opacity: 1; }
      .title-row .state-icon:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
      .title-row .title-path { flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; font-size: 1.05em; font-weight: 600; }
      h2 { margin: 0; font-size: 1.05em; font-weight: 600; flex: 1; cursor: text; padding: 2px 4px; border-radius: 2px; }
      h2:hover:not(.editing) { background: var(--vscode-list-hoverBackground); outline: 1px dashed var(--vscode-input-border); }
      h2.editing { background: var(--vscode-input-background); color: var(--vscode-input-foreground); outline: 1px solid var(--vscode-focusBorder); }
      .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
      .meta { font-size: 0.9em; color: var(--vscode-descriptionForeground); margin-bottom: 12px; }
      .meta .row { display: flex; gap: 6px; align-items: baseline; }
      .meta .label { min-width: 60px; }
      .meta code { background: var(--vscode-textBlockQuote-background); padding: 0 4px; border-radius: 2px; font-size: 0.95em; }
      .actions { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 12px; }
      .actions button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 3px 8px; border-radius: 2px; cursor: pointer; font-size: 0.9em; }
      .actions button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
      .actions button:disabled { opacity: 0.4; cursor: default; }
      h3 { font-size: 0.95em; font-weight: 600; margin: 16px 0 6px 0; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 2px; }
      .note { margin-bottom: 10px; padding: 6px 8px; background: var(--vscode-textBlockQuote-background); border-left: 2px solid var(--vscode-textBlockQuote-border); border-radius: 0 2px 2px 0; }
      .note .ts { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-bottom: 2px; }
      .note .body { font-size: 0.9em; }
      .note .body > *:first-child { margin-top: 0; }
      .note .body > *:last-child { margin-bottom: 0; }
      .note .body p { margin: 0 0 6px 0; }
      .note .body h1, .note .body h2, .note .body h3, .note .body h4 { margin: 8px 0 4px 0; font-size: 1em; font-weight: 600; }
      .note .body ul, .note .body ol { margin: 4px 0; padding-left: 20px; }
      .note .body li { margin-bottom: 2px; }
      .note .body code { background: var(--vscode-textCodeBlock-background); padding: 0 4px; border-radius: 2px; font-family: var(--vscode-editor-font-family); font-size: 0.95em; }
      .note .body pre { background: var(--vscode-textCodeBlock-background); padding: 6px 8px; border-radius: 2px; overflow-x: auto; margin: 6px 0; }
      .note .body pre code { background: transparent; padding: 0; font-size: 0.9em; }
      .note .body blockquote { margin: 4px 0; padding-left: 8px; border-left: 2px solid var(--vscode-textBlockQuote-border); color: var(--vscode-descriptionForeground); }
      .note .body a { color: var(--vscode-textLink-foreground); text-decoration: none; }
      .note .body a:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
      .note .body table { border-collapse: collapse; margin: 6px 0; }
      .note .body th, .note .body td { border: 1px solid var(--vscode-panel-border); padding: 2px 6px; }
      .note .body hr { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 8px 0; }
      .note .body img { max-width: 100%; }
      .no-notes { color: var(--vscode-descriptionForeground); font-style: italic; font-size: 0.9em; margin: 6px 0 0 0; }
      .add-note { margin: 4px 0 10px 0; }
      .add-note.collapsed { color: var(--vscode-descriptionForeground); font-size: 0.9em; cursor: text; padding: 4px 6px; border: 1px dashed var(--vscode-input-border); border-radius: 2px; }
      .add-note.collapsed:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
      .add-note.expanded textarea { display: block; width: 100%; box-sizing: border-box; min-height: 64px; resize: vertical; font-family: var(--vscode-font-family); font-size: 0.9em; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-focusBorder)); border-radius: 2px; padding: 4px 6px; }
      .add-note.expanded textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
      .add-note .controls { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
      .add-note .controls button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 3px 10px; border-radius: 2px; cursor: pointer; font-size: 0.9em; }
      .add-note .controls button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
      .add-note .controls button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
      .add-note .controls button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
      .add-note .controls button:disabled { opacity: 0.4; cursor: default; }
      .add-note .hint { color: var(--vscode-descriptionForeground); font-size: 0.8em; }
      .add-note .preview-wrap[hidden] { display: none; }
      .add-note .preview-label { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin: 8px 0 4px 0; text-transform: uppercase; letter-spacing: 0.04em; }
      .add-note .preview { padding: 6px 8px; background: var(--vscode-textBlockQuote-background); border-left: 2px solid var(--vscode-textBlockQuote-border); border-radius: 0 2px 2px 0; font-size: 0.9em; }
      .add-note .preview > *:first-child { margin-top: 0; }
      .add-note .preview > *:last-child { margin-bottom: 0; }
      .add-note .preview p { margin: 0 0 6px 0; }
      .add-note .preview h1, .add-note .preview h2, .add-note .preview h3, .add-note .preview h4 { margin: 8px 0 4px 0; font-size: 1em; font-weight: 600; }
      .add-note .preview ul, .add-note .preview ol { margin: 4px 0; padding-left: 20px; }
      .add-note .preview li { margin-bottom: 2px; }
      .add-note .preview code { background: var(--vscode-textCodeBlock-background); padding: 0 4px; border-radius: 2px; font-family: var(--vscode-editor-font-family); font-size: 0.95em; }
      .add-note .preview pre { background: var(--vscode-textCodeBlock-background); padding: 6px 8px; border-radius: 2px; overflow-x: auto; margin: 6px 0; }
      .add-note .preview pre code { background: transparent; padding: 0; font-size: 0.9em; }
      .add-note .preview blockquote { margin: 4px 0; padding-left: 8px; border-left: 2px solid var(--vscode-textBlockQuote-border); color: var(--vscode-descriptionForeground); }
      .add-note .preview a { color: var(--vscode-textLink-foreground); text-decoration: none; }
      .add-note .preview a:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
      .add-note .preview table { border-collapse: collapse; margin: 6px 0; }
      .add-note .preview th, .add-note .preview td { border: 1px solid var(--vscode-panel-border); padding: 2px 6px; }
      .add-note .preview hr { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 8px 0; }
      .add-note .preview img { max-width: 100%; }
    `;

    if (!this.handle.isOpen) {
      return this.shell(css, `<p class="empty">No noggin is open.</p>`);
    }
    if (target.source === 'none' || !target.item) {
      return this.shell(css, `<p class="empty">No item selected.</p><p class="empty">Select an item in the tree above to see its details.</p>`);
    }

    const item = target.item;
    const path = this.handle.pathOf(item) ?? '';

    const stateIcon = renderStateIcon(item.done);

    const addNoteAffordance = `
      <div id="add-note" class="add-note collapsed" tabindex="0" role="button" aria-label="Add note">+ Add note…</div>
    `;

    const notes = item.notes ?? [];
    const notesList = notes.length === 0
      ? ''
      : notes.slice().reverse().map((n) => `
          <div class="note">
            <div class="ts">${esc(n.timestamp ?? '')}</div>
            <div class="body">${renderMarkdown(n.text ?? '')}</div>
          </div>
        `).join('');

    const rawTitle = item.title || '';
    const titleDisplay = rawTitle || '(untitled)';
    const dottedPath = path.replace(/\//g, '.') + '.';
    const body = `
      <div class="title-row">
        ${stateIcon}
        <span class="title-path">${esc(dottedPath)}</span>
        <h2 id="title" tabindex="0" title="Click to edit" data-original="${esc(rawTitle)}">${esc(titleDisplay)}</h2>
      </div>
      <h3>Notes (${notes.length})</h3>
      ${addNoteAffordance}
      ${notesList}
    `;

    return this.shell(css, body);
  }

  private shell(css: string, body: string): string {
    const nonce = makeNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>${css}</style>
</head>
<body>
${body}
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.querySelectorAll('button[data-cmd]').forEach((b) => {
    b.addEventListener('click', () => {
      vscode.postMessage({ type: 'invoke', command: b.getAttribute('data-cmd') });
    });
  });
  document.querySelectorAll('button[data-reorder]').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      vscode.postMessage({ type: 'reorder', direction: b.getAttribute('data-reorder') });
    });
  });
  const stateToggle = document.getElementById('state-toggle');
  if (stateToggle) {
    stateToggle.addEventListener('click', () => {
      const cmd = stateToggle.getAttribute('data-done') === '1' ? 'noggin.undone' : 'noggin.done';
      vscode.postMessage({ type: 'invoke', command: cmd });
    });
  }
  const titleEl = document.getElementById('title');
  if (titleEl) {
    let editing = false;
    const original = titleEl.getAttribute('data-original') || '';
    const beginEdit = () => {
      if (editing) return;
      editing = true;
      titleEl.classList.add('editing');
      titleEl.setAttribute('contenteditable', 'plaintext-only');
      titleEl.textContent = original;
      titleEl.focus();
      const range = document.createRange();
      range.selectNodeContents(titleEl);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    };
    const cancelEdit = () => {
      if (!editing) return;
      editing = false;
      titleEl.removeAttribute('contenteditable');
      titleEl.classList.remove('editing');
      titleEl.textContent = original || '(untitled)';
      titleEl.blur();
    };
    const commitEdit = () => {
      if (!editing) return;
      editing = false;
      titleEl.removeAttribute('contenteditable');
      titleEl.classList.remove('editing');
      const newTitle = (titleEl.textContent || '').trim();
      vscode.postMessage({ type: 'retitle', title: newTitle });
    };
    titleEl.addEventListener('click', beginEdit);
    titleEl.addEventListener('keydown', (e) => {
      if (!editing) {
        if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); beginEdit(); }
        return;
      }
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    });
    titleEl.addEventListener('blur', () => { if (editing) commitEdit(); });
  }
  const addNote = document.getElementById('add-note');
  if (addNote) {
    let expanded = false;
    let previewTimer = null;
    const schedulePreview = () => {
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        const taLive = document.getElementById('add-note-text');
        if (!taLive) return;
        const text = (taLive.value || '').trim();
        const wrap = document.getElementById('add-note-preview-wrap');
        const pv = document.getElementById('add-note-preview');
        if (!text) {
          if (wrap) wrap.hidden = true;
          if (pv) pv.innerHTML = '';
          return;
        }
        vscode.postMessage({ type: 'previewNote', text });
      }, 250);
    };
    const expand = () => {
      if (expanded) return;
      expanded = true;
      addNote.classList.remove('collapsed');
      addNote.classList.add('expanded');
      addNote.removeAttribute('tabindex');
      addNote.removeAttribute('role');
      addNote.innerHTML = '<textarea id="add-note-text" placeholder="Write a note (Markdown supported). Ctrl+Enter to save, Esc to cancel."></textarea><div class="controls"><button id="add-note-save" disabled>Save</button><button id="add-note-cancel" class="secondary">Cancel</button><span class="hint">Ctrl+Enter saves</span></div><div id="add-note-preview-wrap" class="preview-wrap" hidden><div class="preview-label">Preview</div><div id="add-note-preview" class="preview"></div></div>';
      const ta = document.getElementById('add-note-text');
      const saveBtn = document.getElementById('add-note-save');
      const cancelBtn = document.getElementById('add-note-cancel');
      const refreshSave = () => { saveBtn.disabled = !((ta.value || '').trim()); };
      const commit = () => {
        const text = (ta.value || '').trim();
        if (!text) return;
        vscode.postMessage({ type: 'addNote', text });
      };
      const collapse = () => {
        expanded = false;
        if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
        addNote.classList.remove('expanded');
        addNote.classList.add('collapsed');
        addNote.setAttribute('tabindex', '0');
        addNote.setAttribute('role', 'button');
        addNote.textContent = '+ Add note…';
      };
      ta.addEventListener('input', () => { refreshSave(); schedulePreview(); });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); collapse(); }
      });
      // Stop bubbling: addNote's own click handler re-expands when expanded is false,
      // and collapse() flips expanded before the bubble reaches it.
      saveBtn.addEventListener('click', (e) => { e.stopPropagation(); commit(); });
      cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); collapse(); });
      ta.focus();
    };
    addNote.addEventListener('click', (e) => {
      if (expanded) return;
      expand();
    });
    addNote.addEventListener('keydown', (e) => {
      if (expanded) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expand(); }
    });
    window.addEventListener('message', (e) => {
      const m = e.data;
      if (!m || m.type !== 'notePreview' || typeof m.html !== 'string') return;
      const pv = document.getElementById('add-note-preview');
      const wrap = document.getElementById('add-note-preview-wrap');
      const taLive = document.getElementById('add-note-text');
      if (!pv || !wrap || !taLive) return;
      pv.innerHTML = m.html;
      wrap.hidden = !((taLive.value || '').trim());
    });
  }
  // Open links in the user's browser via the extension host.
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!/^https?:|^mailto:/i.test(href)) return;
    e.preventDefault();
    vscode.postMessage({ type: 'openExternal', href });
  });
</script>
</body>
</html>`;
  }
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;' :
    c === '>' ? '&gt;' :
    c === '"' ? '&quot;' :
    '&#39;'
  ));
}

function renderMarkdown(src: string): string {
  try {
    return marked.parse(src, { async: false }) as string;
  } catch {
    return esc(src);
  }
}

function renderStateIcon(done: boolean): string {
  // Clickable toggle in the title row. data-done lets the script flip
  // between noggin.done and noggin.undone without a re-render.
  const label = done ? 'Mark undone' : 'Mark done';
  if (done) {
    return `<button id="state-toggle" class="state-icon done" data-done="1" title="${label}" aria-label="${label}" aria-pressed="true">`
      + `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
      + `<circle cx="8" cy="8" r="7" fill="currentColor"/>`
      + `<path d="M11.78 5.72a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L4.22 8.78a.75.75 0 1 1 1.06-1.06L7 9.44l3.72-3.72a.75.75 0 0 1 1.06 0Z" fill="var(--vscode-editor-background)"/>`
      + `</svg></button>`;
  }
  return `<button id="state-toggle" class="state-icon open" data-done="0" title="${label}" aria-label="${label}" aria-pressed="false">`
    + `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
    + `<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4" fill="none"/>`
    + `</svg></button>`;
}

function makeNonce(): string {
  let out = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
