import * as vscode from 'vscode';
import { registerCommands } from './commands.js';
import { NogginDetailsView } from './detailsView.js';
import { NogginHandle } from './noggin.js';
import { NogginSession } from './session.js';
import { NogginStatusBar } from './statusBar.js';
import { registerLanguageModelTools } from './tools.js';
import { NogginTreeWebviewProvider } from './treeViewProvider.js';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Noggin');
  context.subscriptions.push(output);

  const session = new NogginSession(context);
  context.subscriptions.push(session);

  const handle = new NogginHandle(session, output);
  context.subscriptions.push(handle);

  const tree = new NogginTreeWebviewProvider(context, handle, output);
  context.subscriptions.push(
    tree,
    vscode.window.registerWebviewViewProvider(NogginTreeWebviewProvider.viewType, tree),
  );

  const details = new NogginDetailsView(handle, output);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(NogginDetailsView.viewType, details),
  );
  // The tree webview drives goto on selection; mirror the same active item
  // into the details pane whenever it changes.
  context.subscriptions.push(
    handle.onDidChange(() => {
      const active = handle.active;
      details.setSelection(active ? [active] : []);
    }),
  );

  // View-title icon commands for the DETAILS header. They forward to the
  // existing item-scoped commands, using whatever the details pane is
  // currently focused on.
  const detailsAction = (cmd: string) => () => {
    const item = details.getCurrent();
    if (!item) return;
    vscode.commands.executeCommand(cmd, item);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('noggin.details.addChild', detailsAction('noggin.addChild')),
    vscode.commands.registerCommand('noggin.details.delete', detailsAction('noggin.delete')),
    vscode.commands.registerCommand('noggin.details.moveUp', () => details.reorderPublic('up')),
    vscode.commands.registerCommand('noggin.details.moveDown', () => details.reorderPublic('down')),
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
