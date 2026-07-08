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
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as vscode from 'vscode';

import '@noggin/engine/providers/file';   // side-effect: registers file://
import '@noggin/engine/providers/memory'; // side-effect: registers memory://
import '@noggin/engine/providers/vscode-todo'; // side-effect: registers vscode-todo://
import {
  createNogginRpcServer,
  type NogginRpcServer,
  type RpcMessage,
} from '@noggin/rpc';

import { NogginSession } from '../session.js';
import { createVsCodeHostServices } from '../host-services-vscode.js';
import { createVsCodeProviderFlows } from '../provider-flows-vscode.js';
import { isRpcFrame, type HostFrame, type WebviewFrame } from '../shared-webview-protocol.js';

// globalState keys for the NogginList store/prefs/MRU. Persisted in
// the extension host (not webview localStorage, which VS Code webviews
// don't guarantee survives across reloads) and mirrored into the
// webview's in-memory store via `list-init` / `list-state` frames.
const LIST_ENTRIES_KEY = 'noggin.list.entries.v1';
const LIST_PREFS_KEY = 'noggin.list.prefs.v1';
const LIST_MRU_KEY = 'noggin.list.mru.v1';

// globalState key for the Noggin tree's word-wrap preference. Same
// host-owned-persistence pattern as the list prefs above, via
// `tree-prefs-init` / `tree-prefs-state` frames.
const TREE_WORD_WRAP_KEY = 'noggin.tree.wordWrap.v1';

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

  /** Push the current session.location as the "open this" location to the webview.
   *  Bare fs paths get wrapped as `file://` URIs so the webview's
   *  RPC layer always receives a well-formed URI; existing URIs
   *  (`vscode-todo://`, `https://`, …) pass through verbatim. */
  private pushSessionLocation(): void {
    if (!this.view) return;
    const location = this.session.location;
    const frame: HostFrame = {
      kind: 'session',
      location: location ? toWebviewLocation(location) : null,
    };
    void this.view.webview.postMessage(frame);
  }

  /** Push the persisted NogginList entries/prefs/MRU. Sent once per
   *  webview lifetime (on `ready`) — the webview owns the live store
   *  from then on and reports changes back via `list-state`. */
  private pushListInit(): void {
    if (!this.view) return;
    const frame: HostFrame = {
      kind: 'list-init',
      entries: this.context.globalState.get<Record<string, unknown>[]>(LIST_ENTRIES_KEY, []),
      prefs: this.context.globalState.get<Record<string, unknown>>(LIST_PREFS_KEY, {}),
      mru: this.context.globalState.get<Record<string, string>>(LIST_MRU_KEY, {}),
    };
    void this.view.webview.postMessage(frame);
  }

  /** Push the persisted Noggin-tree word-wrap preference. Sent once
   *  per webview lifetime (on `ready`), same pattern as the list's
   *  init/state pair. */
  private pushTreePrefsInit(): void {
    if (!this.view) return;
    const frame: HostFrame = {
      kind: 'tree-prefs-init',
      wordWrap: this.context.globalState.get<boolean>(TREE_WORD_WRAP_KEY, false),
    };
    void this.view.webview.postMessage(frame);
  }

  private onSessionChanged(): void {
    this.updateHeader();
    this.pushSessionLocation();
  }

  private updateHeader(): void {
    if (!this.view) return;
    const location = this.session.location;
    this.view.description = location ? friendlyLocationLabel(location) : undefined;
  }

  private async handleWebviewFrame(msg: WebviewFrame): Promise<void> {
    if (msg.kind === 'ready') {
      // The webview's React listener is now attached; (re-)send the
      // current session location + persisted list/tree state so it
      // knows what to open / what to render.
      this.pushSessionLocation();
      this.pushListInit();
      this.pushTreePrefsInit();
      return;
    }
    if (msg.kind === 'list-state') {
      if (msg.entries) void this.context.globalState.update(LIST_ENTRIES_KEY, msg.entries);
      if (msg.prefs) void this.context.globalState.update(LIST_PREFS_KEY, msg.prefs);
      if (msg.mru) void this.context.globalState.update(LIST_MRU_KEY, msg.mru);
      return;
    }
    if (msg.kind === 'tree-prefs-state') {
      void this.context.globalState.update(TREE_WORD_WRAP_KEY, msg.wordWrap);
      return;
    }
    if (msg.kind !== 'session-request') return;
    try {
      switch (msg.action) {
        case 'openWorkspaceNoggin':
          await vscode.commands.executeCommand('noggin.openWorkspaceNoggin');
          return;
        case 'close':
          await this.session.close();
          return;
        case 'openLocation': {
          // The webview may hand us a `file://` URI or any other
          // scheme (`vscode-todo://`, `https://`, …). The session
          // accepts both — no need to pre-convert.
          await this.session.open(msg.location);
          return;
        }
      }
    } catch (err) {
      this.output.appendLine(`[${new Date().toISOString()}] webview ${msg.action} failed: ${(err as Error).message}`);
    }
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
      providerFlows: createVsCodeProviderFlows(this.context),
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

/** Compact label for the view header: workspace-relative, ~ for home, else basename.
 *  URI locations (non-file schemes) get a scheme-specific rendering. */
function friendlyLocationLabel(location: string): string {
  const asFs = asFsPathIfPossible(location);
  if (asFs !== null) return friendlyFileLabel(asFs);
  const vscodeTodo = /^vscode-todo:\/\/.*#(.+)$/i.exec(location);
  if (vscodeTodo) {
    const sid = vscodeTodo[1];
    const short = sid.length > 8 ? sid.slice(0, 8) : sid;
    return `Copilot todo · ${short}`;
  }
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(location);
  if (!schemeMatch) return location;
  const [, scheme, rest] = schemeMatch;
  const clean = rest.split(/[#?]/, 1)[0];
  const tail = clean.split('/').filter(Boolean).pop() ?? clean;
  return `${scheme}:${tail}`;
}

function asFsPathIfPossible(location: string): string | null {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(location)) return location;
  if (location.toLowerCase().startsWith('file://')) {
    try { return fileURLToPath(location); }
    catch { return null; }
  }
  return null;
}

/** Convert an internal session location (URI or bare fs path) into
 *  the URI form the webview always expects. Bare paths get wrapped
 *  as `file://`; existing URIs pass through verbatim. */
function toWebviewLocation(location: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(location)) return location;
  return pathToFileURL(location).href;
}

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
