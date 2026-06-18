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
      this.handleMove(msg.dragKeys, msg.parentKey, msg.index, msg.cursorType);
      return;
    }
  }

  private itemByPath(path: string): Item | undefined {
    return this.handle.tryResolvePath(path) ?? undefined;
  }

  /**
   * Translate the arborist move intent into one or more handle.move calls.
   *
   * Arborist gives us a `(parentId, index)` insertion point computed against
   * the *destination* siblings (excluding the items being dragged). We turn
   * that into noggin's placement language by finding the item at `index` (or
   * before it) among the live siblings:
   *
   *   no siblings   → into(parent)        — first child of an empty parent
   *   index in [0,n) → before(siblings[index])
   *   index === n   → after(siblings[n-1])
   *
   * cursorType is captured by the webview at drop time. Today we trust
   * arborist's intent verbatim and only log the discriminator for debugging
   * — the open-folder-with-children case unavoidably maps drop-below-row to
   * first-child-of-folder in arborist's model, and overriding it broke the
   * common "drop right under the folder header to make a child" gesture.
   *
   * For multi-drag we drop in input order, advancing `after` to the freshly
   * placed item so the dragged group stays contiguous and in source order.
   */
  private handleMove(
    dragKeys: string[],
    parentKey: string | null,
    index: number,
    cursorType: 'line' | 'highlight',
  ): void {
    if (dragKeys.length === 0) return;

    let cursorAnchorPath: string | null = null;
    let cursorKind: 'before' | 'after' | 'into' | null = null;

    for (const dragKey of dragKeys) {
      const drag = this.handle.findByKey(dragKey);
      if (!drag) continue;
      const dragPath = this.handle.pathOf(drag);
      if (!dragPath) continue;

      // Recompute siblings each iteration: previous moves shifted positions.
      const siblings = this.handle.childrenOf(parentKey).filter((c) => !dragKeys.includes(c.key) || c.key === dragKey);

      let kind: 'before' | 'after' | 'into';
      let anchor: string;

      if (cursorAnchorPath && cursorKind) {
        // Already inserted at least one item from this batch — chain after it.
        kind = 'after';
        anchor = cursorAnchorPath;
      } else if (siblings.length === 0 || (siblings.length === 1 && siblings[0]!.key === dragKey)) {
        if (!parentKey) {
          // Nothing to anchor against at the root with no siblings — bail.
          continue;
        }
        const parent = this.handle.findByKey(parentKey);
        const parentPath = parent ? this.handle.pathOf(parent) : null;
        if (!parentPath) continue;
        kind = 'into';
        anchor = parentPath;
      } else {
        // Filter out the dragged item itself so its current index doesn't
        // shift the insertion point.
        const peers = siblings.filter((c) => c.key !== dragKey);
        const clamped = Math.max(0, Math.min(index, peers.length));
        if (clamped < peers.length) {
          const at = peers[clamped]!;
          const atPath = this.handle.pathOf(at);
          if (!atPath) continue;
          kind = 'before';
          anchor = atPath;
        } else {
          const at = peers[peers.length - 1]!;
          const atPath = this.handle.pathOf(at);
          if (!atPath) continue;
          kind = 'after';
          anchor = atPath;
        }
      }

      try {
        this.handle.move({ path: dragPath, placement: { kind, anchor } });
        // Refresh anchor for the next iteration so we drop right after this
        // freshly placed item.
        const movedItem = this.handle.findByKey(dragKey);
        const movedPath = movedItem ? this.handle.pathOf(movedItem) : null;
        if (movedPath) {
          cursorAnchorPath = movedPath;
          cursorKind = 'after';
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Noggin: ${msg}`);
        this.output.appendLine(`[${new Date().toISOString()}] tree move failed: ${msg}`);
      }
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'treeView.js'),
    );
    const nonce = makeNonce();
    const cspSource = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource};">
  <style>${CSS}</style>
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

const CSS = `
  html, body, #root { height: 100%; margin: 0; padding: 0; background: var(--vscode-sideBar-background, transparent); color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); overflow: hidden; }
  .noggin-tree-root { height: 100%; width: 100%; }
  .noggin-empty { padding: 16px 12px; display: flex; flex-direction: column; gap: 6px; color: var(--vscode-descriptionForeground); font-size: 0.95em; }
  .noggin-empty p { margin: 0 0 4px 0; }
  .noggin-empty button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 4px 8px; border-radius: 2px; cursor: pointer; text-align: left; font: inherit; }
  .noggin-empty button:hover { background: var(--vscode-button-secondaryHoverBackground); }

  .noggin-row { display: flex; align-items: center; gap: 4px; height: 100%; padding: 0 6px 0 0; cursor: pointer; user-select: none; min-width: 0; position: relative; }
  .noggin-row:hover { background: var(--vscode-list-hoverBackground); }
  .noggin-row.active { background: var(--vscode-list-inactiveSelectionBackground); }
  .noggin-row.active:hover { background: var(--vscode-list-hoverBackground); }
  .noggin-row.drop-into { background: var(--vscode-list-dropBackground, var(--vscode-list-activeSelectionBackground)); outline: 2px solid var(--vscode-focusBorder); outline-offset: -2px; }

  .twisty { width: 14px; height: 14px; flex: 0 0 14px; display: inline-flex; align-items: center; justify-content: center; background: none; border: none; padding: 0; color: var(--vscode-foreground); opacity: 0.7; cursor: pointer; }
  .twisty:hover { opacity: 1; }
  .twisty.placeholder { cursor: default; }
  .twisty svg { display: block; transition: transform 80ms ease; }

  .done-icon { width: 16px; height: 16px; flex: 0 0 16px; padding: 0; background: none; border: none; cursor: pointer; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; }
  .done-icon svg { pointer-events: none; display: block; }
  .done-icon.done { color: var(--vscode-charts-green); }
  .done-icon.open { color: var(--vscode-foreground); opacity: 0.6; }
  .done-icon:hover { background: var(--vscode-toolbar-hoverBackground); }
  .done-icon:hover.open { opacity: 1; }
  .done-icon:focus-visible { outline: 1px solid var(--vscode-focusBorder); }

  .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .position { flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; font-size: 0.9em; }
  .note-badge { flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-size: 0.8em; }

  /* Textual drop-destination hints */
  .noggin-drop-label { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: var(--vscode-focusBorder); color: var(--vscode-editor-background); padding: 1px 6px; border-radius: 3px; font-size: 0.75em; font-weight: 600; pointer-events: none; white-space: nowrap; box-shadow: 0 1px 3px rgba(0,0,0,0.4); z-index: 11; }
  .noggin-cursor { position: absolute; height: 3px; background: var(--vscode-focusBorder); border-radius: 2px; pointer-events: none; box-shadow: 0 0 0 1px var(--vscode-editor-background); z-index: 10; display: flex; align-items: center; }
  .noggin-cursor-dot { position: absolute; left: -4px; top: -3px; width: 9px; height: 9px; border-radius: 50%; background: var(--vscode-focusBorder); box-shadow: 0 0 0 1px var(--vscode-editor-background); }
  .noggin-cursor-label { position: absolute; right: 0; top: -10px; background: var(--vscode-focusBorder); color: var(--vscode-editor-background); padding: 1px 6px; border-radius: 3px; font-size: 0.75em; font-weight: 600; white-space: nowrap; box-shadow: 0 1px 3px rgba(0,0,0,0.4); }
`;
