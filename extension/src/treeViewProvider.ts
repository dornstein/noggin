// WebviewViewProvider for the noggin tree.
//
// Replaces the old vscode.TreeView<Item> based view. Owns:
//   - the React/arborist webview bundle (out/webview/treeView.js)
//   - the snapshot push pipeline (NogginHandle changes → postMessage)
//   - intent handling (webview clicks → VS Code commands / handle.move)

import * as path from 'node:path';
import * as os from 'node:os';
import * as vscode from 'vscode';
import type { Item } from '../skills/noggin/noggin-api.mjs';
import { NogginHandle } from './noggin.js';
import type { HostMessage, TreeNodeData, TreeSnapshot, WebviewMessage } from './treeBridge.js';

export class NogginTreeWebviewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'nogginTree';

  private view: vscode.WebviewView | null = null;
  private get webview(): vscode.Webview | null { return this.view?.webview ?? null; }
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly handle: NogginHandle,
    private readonly output: vscode.OutputChannel,
  ) {
    this.disposables.push(handle.onDidChange(() => {
      this.pushSnapshot();
      this.updateHeader();
    }));
  }

  dispose(): void { for (const d of this.disposables) d.dispose(); }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview')],
    };
    view.webview.html = this.renderHtml(view.webview);
    view.webview.onDidReceiveMessage((m: WebviewMessage) => this.onMessage(m));
    view.onDidDispose(() => { this.view = null; });
    this.updateHeader();
    // The webview posts 'ready' once mounted; we push the initial snapshot then.
  }

  /** Push a fresh snapshot to the webview. Cheap if nothing's listening. */
  private pushSnapshot(): void {
    if (!this.webview) return;
    const msg: HostMessage = { type: 'snapshot', snapshot: this.buildSnapshot() };
    this.webview.postMessage(msg);
  }

  /**
   * Update the section header ("NOGGIN" — file) with a friendly file label
   * when one is open. The static name in package.json acts as the title;
   * the description sits next to it in smaller, dimmed text.
   */
  private updateHeader(): void {
    if (!this.view) return;
    const file = this.handle.file;
    this.view.description = file ? friendlyFileLabel(file) : undefined;
  }

  private buildSnapshot(): TreeSnapshot {
    if (!this.handle.isOpen) {
      return { isOpen: false, activePath: null, fileId: null, roots: [] };
    }
    const active = this.handle.active;
    const activePath = active ? this.handle.pathOf(active) : null;
    const roots = this.handle.roots.map((r) => this.itemToNode(r));
    return {
      isOpen: true,
      activePath,
      fileId: this.handle.file,
      roots,
    };
  }

  private itemToNode(item: Item): TreeNodeData {
    return {
      id: item.key,
      path: this.handle.pathOf(item) ?? '?',
      title: item.title || '',
      done: item.done,
      noteCount: Array.isArray(item.notes) ? item.notes.length : 0,
      children: this.handle.childrenOf(item.key).map((c) => this.itemToNode(c)),
    };
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    if (msg.type === 'ready') { this.pushSnapshot(); return; }

    if (msg.type === 'invoke') {
      // Path-bearing commands go through the existing command handlers with
      // the corresponding Item as the argument (matches the tree-view shape).
      const item = msg.path ? this.itemByPath(msg.path) : undefined;
      try {
        await vscode.commands.executeCommand(msg.command, item);
      } catch (err) {
        this.output.appendLine(`[${new Date().toISOString()}] tree: ${msg.command} failed: ${(err as Error).message}`);
      }
      return;
    }

    if (msg.type === 'move') {
      await this.handleMove(msg.fromPath, msg.kind, msg.anchorPath);
      return;
    }
  }

  private itemByPath(path: string): Item | undefined {
    return this.handle.tryResolvePath(path) ?? undefined;
  }

  /**
   * Apply the move. The webview already resolved the arborist intent
   * against the snapshot it had at drop time (single-item drags only —
   * arborist is in disableMultiSelection mode). Stale-path races are
   * possible but rare; the engine throws a descriptive error if so.
   */
  private async handleMove(
    fromPath: string,
    kind: 'before' | 'after' | 'into',
    anchorPath: string,
  ): Promise<void> {
    try {
      await this.handle.move({ path: fromPath, placement: { kind, anchor: anchorPath } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Noggin: ${msg}`);
      this.output.appendLine(`[${new Date().toISOString()}] tree move failed: ${msg}`);
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'treeView.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'treeView.css'),
    );
    const nonce = makeNonce();
    const cspSource = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource}; font-src ${cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <style>${HOST_CSS}</style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  let out = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

/** Compact label for the view header: workspace-relative, ~ for home, else basename. */
function friendlyFileLabel(file: string): string {
  const folders = vscode.workspace.workspaceFolders;
  if (folders) {
    for (const f of folders) {
      const root = f.uri.fsPath;
      if (file === path.join(root, '.noggin.yaml')) return 'workspace';
      if (file.startsWith(root + path.sep)) return path.relative(root, file).replace(/\\/g, '/');
    }
  }
  const home = os.homedir();
  if (file.startsWith(home + path.sep)) return '~/' + path.relative(home, file).replace(/\\/g, '/');
  return path.basename(file);
}

/**
 * Host overrides for the @noggin/ui base stylesheet. We alias the lib's
 * --noggin-* design tokens to VS Code theme tokens so the tree adopts the
 * active color theme, and we add styles for the welcome-state buttons
 * (those aren't part of @noggin/ui).
 */
const HOST_CSS = `
  :root {
    --noggin-bg: var(--vscode-sideBar-background, transparent);
    --noggin-bg-sidebar: var(--vscode-sideBar-background, transparent);
    --noggin-bg-hover: var(--vscode-list-hoverBackground);
    --noggin-bg-elev: var(--vscode-editorWidget-background);
    --noggin-input-bg: var(--vscode-input-background);
    --noggin-row-bg: transparent;
    --noggin-fg: var(--vscode-foreground);
    --noggin-fg-dim: var(--vscode-descriptionForeground);
    --noggin-fg-muted: var(--vscode-disabledForeground, var(--vscode-descriptionForeground));
    --noggin-fg-active: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
    --noggin-border: var(--vscode-panel-border, transparent);
    --noggin-border-soft: var(--vscode-panel-border, transparent);
    --noggin-border-focus: var(--vscode-focusBorder);
    --noggin-accent: var(--vscode-focusBorder);
    --noggin-accent-bg: var(--vscode-list-activeSelectionBackground);
    --noggin-accent-bg-soft: var(--vscode-list-inactiveSelectionBackground);
    --noggin-done: var(--vscode-charts-green);
    --noggin-warning: var(--vscode-editorWarning-foreground);
    --noggin-danger: var(--vscode-errorForeground);
    --noggin-font: var(--vscode-font-family);
    --noggin-fs: var(--vscode-font-size);
  }

  html, body, #root { height: 100%; margin: 0; padding: 0; background: var(--vscode-sideBar-background, transparent); color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); overflow: hidden; }

  .noggin-empty { padding: 16px 12px; display: flex; flex-direction: column; gap: 6px; color: var(--vscode-descriptionForeground); font-size: 0.95em; }
  .noggin-empty p { margin: 0 0 4px 0; }
  .noggin-empty button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 4px 8px; border-radius: 2px; cursor: pointer; text-align: left; font: inherit; }
  .noggin-empty button:hover { background: var(--vscode-button-secondaryHoverBackground); }

  /* Row active state uses the list-selection theme tokens too. */
  .noggin-row.active { background: var(--vscode-list-inactiveSelectionBackground); }
  .noggin-row.active:hover { background: var(--vscode-list-hoverBackground); }
  .noggin-row.drop-into { background: var(--vscode-list-dropBackground, var(--vscode-list-activeSelectionBackground)); outline: 2px solid var(--vscode-focusBorder); outline-offset: -2px; }
`;
