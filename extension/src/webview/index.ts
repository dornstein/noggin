// NogginUiWebviewProvider — Phase 5 single combined webview.
//
// Replaces the two-view tree+details layout with one webview that
// hosts the full @noggin/ui App (same component the desktop renderer
// ships). The host runs a `createNogginRpcServer` per webview; the
// React App drives verbs through a `RemoteNoggin` over the
// postMessage transport.
//
// Why one big webview? Because @noggin/ui already has a combined
// tree-plus-details layout with a splitter. Reusing it here means
// the extension and desktop drift can't open between gestures —
// they're literally the same React component.

import * as path from 'node:path';
import * as os from 'node:os';
import * as vscode from 'vscode';

import '@noggin/engine/providers/file';   // side-effect: registers file://
import '@noggin/engine/providers/memory'; // side-effect: registers memory://
import {
  createNogginRpcServer,
  type NogginRpcServer,
  type RpcMessage,
} from '@noggin/rpc';

import { NogginSession } from '../session.js';
import { createVsCodeHostServices } from '../host-services-vscode.js';
import {
  isRpcFrame,
  type CtxMenuWireItem,
  type HostFrame,
  type WebviewFrame,
} from '../shared-webview-protocol.js';

export class NogginUiWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'nogginTree';

  private view: vscode.WebviewView | null = null;
  private rpc: NogginRpcServer | null = null;
  private rpcSubscriptions: vscode.Disposable[] = [];
  /** Listeners we send rpc frames to. The transport bridge sets these. */
  private rpcListeners: Array<(m: RpcMessage) => void> = [];
  private readonly hostServices = createVsCodeHostServices();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly session: NogginSession,
    private readonly output: vscode.OutputChannel,
  ) {
    this.disposables.push(session.onDidChange(() => this.onSessionChanged()));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.tearDownRpc();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview'),
      ],
    };
    view.webview.html = this.renderHtml(view.webview);
    this.updateHeader();

    this.attachRpcServer(view);

    // Listen for non-rpc frames (session-request from the webview).
    this.disposables.push(view.webview.onDidReceiveMessage((msg: WebviewFrame) => {
      if (!msg || isRpcFrame(msg)) return;  // rpc handled by the transport
      void this.handleWebviewFrame(msg);
    }));

    view.onDidDispose(() => {
      this.tearDownRpc();
      this.view = null;
    });
  }

  /** Push the current session.file as the "open this" location to the webview. */
  private pushSessionLocation(): void {
    if (!this.view) return;
    const frame: HostFrame = {
      kind: 'session',
      location: this.session.file,
    };
    void this.view.webview.postMessage(frame);
  }

  private onSessionChanged(): void {
    this.updateHeader();
    this.pushSessionLocation();
  }

  private updateHeader(): void {
    if (!this.view) return;
    const file = this.session.file;
    this.view.description = file ? friendlyFileLabel(file) : undefined;
  }

  private async handleWebviewFrame(msg: WebviewFrame): Promise<void> {
    if (msg.kind === 'ready') {
      // The webview's React listener is now attached; (re-)send the
      // current session location so it knows what to open.
      this.pushSessionLocation();
      return;
    }
    if (msg.kind === 'ctx-menu-request') {
      await this.showContextMenu(msg.id, msg.items);
      return;
    }
    if (msg.kind !== 'session-request') return;
    try {
      switch (msg.action) {
        case 'openFile':
          await vscode.commands.executeCommand('noggin.openFile');
          return;
        case 'newFile':
          await vscode.commands.executeCommand('noggin.new');
          return;
        case 'openWorkspaceNoggin':
          await vscode.commands.executeCommand('noggin.openWorkspaceNoggin');
          return;
      }
    } catch (err) {
      this.output.appendLine(`[${new Date().toISOString()}] webview ${msg.action} failed: ${(err as Error).message}`);
    }
  }

  /**
   * Show the tree's canonical context menu as a VS Code QuickPick.
   *
   * The webview owns the menu's contents (built inside @noggin/ui from
   * the canonical helper); we just render it via a native API so it
   * matches the user's VS Code theme and respects accessibility
   * settings. Disabled entries are skipped — QuickPick has no native
   * disabled state, and hiding them is less confusing than showing an
   * unresponsive item.
   */
  private async showContextMenu(id: number, items: ReadonlyArray<CtxMenuWireItem>): Promise<void> {
    if (!this.view) return;

    type QpItem = vscode.QuickPickItem & { _key?: string };
    const qpItems: QpItem[] = [];
    for (const entry of items) {
      if (entry.kind === 'separator') {
        qpItems.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        continue;
      }
      if (entry.disabled) continue;
      qpItems.push({
        label: entry.label,
        description: entry.shortcut,
        iconPath: entry.icon ? new vscode.ThemeIcon(entry.icon) : undefined,
        _key: entry.key,
      });
    }

    let pickedKey: string | null = null;
    try {
      const picked = await vscode.window.showQuickPick(qpItems, {
        placeHolder: 'Actions',
        matchOnDescription: false,
        matchOnDetail: false,
      });
      pickedKey = picked && (picked as QpItem)._key ? (picked as QpItem)._key! : null;
    } catch {
      pickedKey = null;
    }

    const frame: HostFrame = { kind: 'ctx-menu-result', id, pickedKey };
    void this.view.webview.postMessage(frame);
  }

  /** Stand up a noggin-rpc server bound to this webview's postMessage channel. */
  private attachRpcServer(view: vscode.WebviewView): void {
    // We build a custom Transport rather than using
    // createPostMessageTransport directly — VS Code's webview channel
    // is single-multiplexed, so we tag-discriminate rpc frames at
    // the wire.

    const onMessageListeners: Array<(m: RpcMessage) => void> = [];
    const onDisconnectListeners: Array<() => void> = [];
    this.rpcListeners = onMessageListeners;

    const transport = {
      send: (message: RpcMessage) => {
        if (!this.view) return;
        const frame: HostFrame = { kind: 'rpc', payload: message };
        void this.view.webview.postMessage(frame);
      },
      onMessage: (handler: (m: RpcMessage) => void) => {
        onMessageListeners.push(handler);
        return { dispose: () => {
          const i = onMessageListeners.indexOf(handler);
          if (i >= 0) onMessageListeners.splice(i, 1);
        } };
      },
      onDisconnect: (handler: () => void) => {
        onDisconnectListeners.push(handler);
        return { dispose: () => {
          const i = onDisconnectListeners.indexOf(handler);
          if (i >= 0) onDisconnectListeners.splice(i, 1);
        } };
      },
      close: () => {
        for (const h of onDisconnectListeners.splice(0)) {
          try { h(); } catch { /* swallow */ }
        }
      },
    };

    // Tap incoming frames: rpc → transport listeners; session-request →
    // handled by the resolveWebviewView listener above.
    this.rpcSubscriptions.push(view.webview.onDidReceiveMessage((msg: WebviewFrame) => {
      if (!isRpcFrame(msg)) return;
      for (const h of onMessageListeners) h(msg.payload);
    }));

    this.rpc = createNogginRpcServer({
      transport,
      hostServices: this.hostServices,
    });

    // The webview posts a 'ready' frame once its React listener is
    // attached; we reply with the session location. (Posting eagerly
    // here is a race — the script may not have run yet, let alone
    // mounted React + attached its listener.)
  }

  private tearDownRpc(): void {
    for (const d of this.rpcSubscriptions.splice(0)) d.dispose();
    this.rpcListeners = [];
    void this.rpc?.dispose();
    this.rpc = null;
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'app.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'app.css'),
    );
    const nonce = makeNonce();
    const cspSource = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource}; font-src ${cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <style>html, body, #root { height: 100%; margin: 0; padding: 0; }</style>
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
