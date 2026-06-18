import * as vscode from 'vscode';
import { createCliRunner } from './cli';
import { registerCommands } from './commands';
import { NogginDetailsView } from './detailsView';
import { NogginDragAndDrop } from './dnd';
import { NogginSession } from './session';
import { NogginStatusBar } from './statusBar';
import { NogginStore } from './store';
import { registerLanguageModelTools } from './tools';
import { NogginTreeProvider } from './treeView';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Noggin');
  context.subscriptions.push(output);

  const session = new NogginSession(context);
  context.subscriptions.push(session);

  const cli = createCliRunner(context, session);
  const store = new NogginStore(session);
  context.subscriptions.push(store);

  const tree = new NogginTreeProvider(store);
  const dnd = new NogginDragAndDrop(cli, store, output);
  const view = vscode.window.createTreeView('nogginTree', {
    treeDataProvider: tree,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController: dnd,
  });
  context.subscriptions.push(view);

  const details = new NogginDetailsView(store, cli, output);
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
    const active = store.active;
    const activeKey = active?.key ?? null;
    if (activeKey === lastActiveKey) return;
    lastActiveKey = activeKey;
    if (!active) return;
    // Defer so the tree provider's own onDidChange handler can rerender first.
    queueMicrotask(() => {
      syncing = true;
      view.reveal(active, { select: true, focus: false, expand: true }).then(
        () => { syncing = false; },
        () => { syncing = false; },
      );
    });
  };
  context.subscriptions.push(
    store.onDidChange(syncActiveToSelection),
    view.onDidChangeSelection(async (e) => {
      if (syncing) return;
      if (e.selection.length !== 1) return;
      const sel = e.selection[0]!;
      if (sel.key === store.active?.key) return;
      const p = store.pathOf(sel);
      if (!p) return;
      try {
        await cli.run('goto', [p]);
        store.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`Noggin: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
  // Initial sync once the tree view is wired up.
  syncActiveToSelection();
  // The tree may not be rendered/visible at activation time, in which case the
  // initial reveal is a no-op. Re-attempt the first time the view becomes visible.
  let didInitialReveal = false;
  context.subscriptions.push(
    view.onDidChangeVisibility((e) => {
      if (didInitialReveal || !e.visible) return;
      const active = store.active;
      if (!active) { didInitialReveal = true; return; }
      didInitialReveal = true;
      syncing = true;
      view.reveal(active, { select: true, focus: false, expand: true }).then(
        () => { syncing = false; },
        () => { syncing = false; },
      );
    }),
  );

  const statusBar = new NogginStatusBar(store, session);
  context.subscriptions.push(statusBar);

  registerCommands(context, { cli, session, store, tree, view, output });
  registerLanguageModelTools(context, { cli, store });

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      // Refresh the workspaceOpen context key.
      vscode.commands.executeCommand(
        'setContext',
        'noggin.workspaceOpen',
        !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length),
      );
    }),
  );
}

export function deactivate(): void {
  // disposables handle cleanup
}
