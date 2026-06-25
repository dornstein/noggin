import * as vscode from 'vscode';
import { registerCommands } from './commands.js';
import { NogginHandle } from './noggin.js';
import { NogginSession } from './session.js';
import { NogginStatusBar } from './statusBar.js';
import { registerLanguageModelTools } from './tools.js';
import { NogginUiWebviewProvider } from './webview/index.js';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Noggin');
  context.subscriptions.push(output);

  const session = new NogginSession(context);
  context.subscriptions.push(session);

  // NogginHandle still owns an in-process engine bound to the current
  // session file. The command-palette commands, the status bar, and
  // the language-model tools all drive verbs through it directly.
  // The webview runs its OWN engine instance via noggin-rpc; both
  // engines watch the same file and stay in sync via the file
  // provider's watcher. This keeps Phase 5 a pure refactor of the
  // view layer — the existing command + tool surface is unchanged.
  const handle = new NogginHandle(session, output);
  context.subscriptions.push(handle);

  // Phase 5: single combined webview (replaces the old separate tree
  // and details webviews). Drives the full @noggin/ui App via
  // noggin-rpc over postMessage.
  const view = new NogginUiWebviewProvider(context, session, output);
  context.subscriptions.push(
    view,
    vscode.window.registerWebviewViewProvider(NogginUiWebviewProvider.viewType, view),
  );

  const statusBar = new NogginStatusBar(handle, session);
  context.subscriptions.push(statusBar);

  registerCommands(context, { handle, session, output });
  registerLanguageModelTools(context, { handle });

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      vscode.commands.executeCommand(
        'setContext',
        'noggin.workspaceOpen',
        !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length),
      );
    }),
  );
}

export function deactivate(): void { /* nothing to clean up */ }
