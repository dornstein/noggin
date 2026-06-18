import * as vscode from 'vscode';
import { registerCommands } from './commands.js';
import { NogginDetailsView } from './detailsView.js';
import { NogginDragAndDrop } from './dnd.js';
import { NogginHandle } from './noggin.js';
import { NogginSession } from './session.js';
import { NogginStatusBar } from './statusBar.js';
import { registerLanguageModelTools } from './tools.js';
import { NogginTreeProvider } from './treeView.js';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Noggin');
  context.subscriptions.push(output);

  const session = new NogginSession(context);
  context.subscriptions.push(session);

  const handle = new NogginHandle(session, output);
  context.subscriptions.push(handle);

  const tree = new NogginTreeProvider(handle);
  const dnd = new NogginDragAndDrop(handle, output);
  const view = vscode.window.createTreeView('nogginTree', {
    treeDataProvider: tree,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController: dnd,
  });
  context.subscriptions.push(view);

  const details = new NogginDetailsView(handle, output);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(NogginDetailsView.viewType, details),
    view.onDidChangeSelection((e) => details.setSelection(e.selection)),
  );

  // Bidirectional sync: tree selection always mirrors the noggin's active item.
  //   external active change → select/reveal that item in the tree
  //   tree selection change   → goto that item (covers click AND arrow keys)
  // syncing flag prevents the programmatic reveal from re-triggering goto.
  let syncing = false;
  let lastActiveKey: string | null = null;
  const syncActiveToSelection = () => {
    const active = handle.active;
    const activeKey = active?.key ?? null;
    if (activeKey === lastActiveKey) return;
    lastActiveKey = activeKey;
    if (!active) return;
    queueMicrotask(() => {
      syncing = true;
      view.reveal(active, { select: true, focus: false, expand: true }).then(
        () => { syncing = false; },
        () => { syncing = false; },
      );
    });
  };
  context.subscriptions.push(
    handle.onDidChange(syncActiveToSelection),
    view.onDidChangeSelection((e) => {
      if (syncing) return;
      if (e.selection.length !== 1) return;
      const sel = e.selection[0]!;
      if (sel.key === handle.active?.key) return;
      const p = handle.pathOf(sel);
      if (!p) return;
      try {
        handle.goto(p);
      } catch (err) {
        vscode.window.showErrorMessage(`Noggin: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
  syncActiveToSelection();
  let didInitialReveal = false;
  context.subscriptions.push(
    view.onDidChangeVisibility((e) => {
      if (didInitialReveal || !e.visible) return;
      const active = handle.active;
      if (!active) { didInitialReveal = true; return; }
      didInitialReveal = true;
      syncing = true;
      view.reveal(active, { select: true, focus: false, expand: true }).then(
        () => { syncing = false; },
        () => { syncing = false; },
      );
    }),
  );

  const statusBar = new NogginStatusBar(handle, session);
  context.subscriptions.push(statusBar);

  registerCommands(context, { handle, session, tree, view, output });
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
