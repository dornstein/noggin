import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as vscode from 'vscode';
import { CliError, CliRunner } from './cli';
import { NogginSession } from './session';
import { NogginStore, StoreItem } from './store';
import { NogginTreeProvider } from './treeView';

interface CommandContext {
  cli: CliRunner;
  session: NogginSession;
  store: NogginStore;
  tree: NogginTreeProvider;
  view: vscode.TreeView<StoreItem>;
  output: vscode.OutputChannel;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  ctx: CommandContext,
): void {
  const { cli, session, store, view, output } = ctx;

  async function run(verb: string, args: string[], announce?: string): Promise<void> {
    if (!store.isOpen) {
      vscode.window.showWarningMessage('Noggin: no noggin is open. Use "Noggin: Open" or "Noggin: New" first.');
      return;
    }
    try {
      const result = await cli.run(verb, args);
      store.refresh();
      if (announce) {
        const text = result?.title ? `${announce}: ${result.title}` : announce;
        vscode.window.setStatusBarMessage(`Noggin — ${text}`, 3000);
      }
      output.appendLine(`[${new Date().toISOString()}] noggin ${verb} ${args.join(' ')}`);
      if (result) output.appendLine(formatResult(result));
    } catch (err) {
      const msg = err instanceof CliError ? err.message : (err as Error).message;
      vscode.window.showErrorMessage(`Noggin: ${msg}`);
      output.appendLine(`[${new Date().toISOString()}] ERROR: ${msg}`);
    }
  }

  function targetPathOrThrow(arg: StoreItem | undefined, verb: string): string {
    if (arg && typeof arg === 'object' && arg.key) {
      const p = store.pathOf(arg);
      if (p) return p;
    }
    const active = store.active;
    if (!active) throw new Error(`${verb}: no active item and no item provided`);
    return store.pathOf(active)!;
  }

  // ── File management ────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('noggin.new', async () => {
      const folders = vscode.workspace.workspaceFolders;
      const defaultDir = folders && folders.length ? folders[0].uri.fsPath : os.homedir();
      const defaultUri = vscode.Uri.file(path.join(defaultDir, '.noggin.yaml'));
      const target = await vscode.window.showSaveDialog({
        title: 'New Noggin',
        defaultUri,
        filters: { 'Noggin (YAML)': ['yaml', 'yml'] },
        saveLabel: 'Create',
      });
      if (!target) return;
      try {
        if (fs.existsSync(target.fsPath)) {
          const choice = await vscode.window.showWarningMessage(
            `A file already exists at ${target.fsPath}. Open it instead of creating a new one?`,
            { modal: true },
            'Open',
          );
          if (choice !== 'Open') return;
          await session.open(target.fsPath);
        } else {
          await session.create(target.fsPath);
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Noggin: could not create ${target.fsPath}: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('noggin.openFile', async () => {
      const folders = vscode.workspace.workspaceFolders;
      const defaultUri = folders && folders.length
        ? vscode.Uri.file(folders[0].uri.fsPath)
        : vscode.Uri.file(os.homedir());
      const picked = await vscode.window.showOpenDialog({
        title: 'Open Noggin',
        defaultUri,
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: false,
        filters: { 'Noggin (YAML)': ['yaml', 'yml'], 'All files': ['*'] },
        openLabel: 'Open',
      });
      if (!picked || picked.length === 0) return;
      await session.open(picked[0].fsPath);
    }),

    vscode.commands.registerCommand('noggin.openWorkspaceNoggin', async () => {
      const target = NogginSession.workspaceNogginPath();
      if (!target) {
        vscode.window.showWarningMessage('Noggin: no workspace folder is open.');
        return;
      }
      try {
        await session.create(target);
      } catch (err) {
        vscode.window.showErrorMessage(`Noggin: could not open workspace noggin: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('noggin.close', async () => {
      await session.close();
    }),

    vscode.commands.registerCommand('noggin.openYaml', async () => {
      if (!session.file) {
        vscode.window.showInformationMessage('Noggin: no noggin file is open.');
        return;
      }
      try {
        const doc = await vscode.workspace.openTextDocument(session.file);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        vscode.window.showErrorMessage(`Noggin: could not open ${session.file}: ${(err as Error).message}`);
      }
    }),
  );

  // ── Tree refresh / show ────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('noggin.refresh', () => store.refresh()),

    vscode.commands.registerCommand('noggin.show', async () => {
      if (!store.isOpen) {
        vscode.window.showWarningMessage('Noggin: no noggin is open.');
        return;
      }
      try {
        const result = await cli.run('show', ['--notes']);
        output.clear();
        output.appendLine(formatResult(result));
        output.show(true);
      } catch (err) {
        const msg = err instanceof CliError ? err.message : (err as Error).message;
        vscode.window.showErrorMessage(`Noggin: ${msg}`);
      }
    }),
  );

  // ── Mutations ──────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('noggin.push', async () => {
      const title = await vscode.window.showInputBox({
        title: 'Noggin: push',
        prompt: 'Title for the new active item',
        placeHolder: 'e.g. spike storage layer',
      });
      if (!title) return;
      await run('push', ['--title', title], 'pushed');
    }),

    vscode.commands.registerCommand('noggin.add', async () => {
      const title = await vscode.window.showInputBox({
        title: 'Noggin: add',
        prompt: 'Title for the new item (added under active, not activated)',
      });
      if (!title) return;
      await run('add', ['--title', title], 'added');
    }),

    vscode.commands.registerCommand('noggin.addChild', async (item?: StoreItem) => {
      const title = await vscode.window.showInputBox({
        title: item ? `Noggin: add child of "${item.title}"` : 'Noggin: add child',
        prompt: 'Title for the new child',
      });
      if (!title) return;
      const args = ['--title', title];
      if (item) {
        const p = store.pathOf(item);
        if (p) args.push('--into', p);
      }
      await run('add', args, 'added');
    }),

    vscode.commands.registerCommand('noggin.addBefore', async (item?: StoreItem) => {
      if (!item) return;
      const anchor = store.pathOf(item);
      if (!anchor) return;
      const title = await vscode.window.showInputBox({
        title: `Noggin: add before "${item.title}"`,
        prompt: 'Title for the new sibling (inserted before this item)',
      });
      if (!title) return;
      await run('add', ['--title', title, '--before', anchor], 'added');
    }),

    vscode.commands.registerCommand('noggin.addAfter', async (item?: StoreItem) => {
      if (!item) return;
      const anchor = store.pathOf(item);
      if (!anchor) return;
      const title = await vscode.window.showInputBox({
        title: `Noggin: add after "${item.title}"`,
        prompt: 'Title for the new sibling (inserted after this item)',
      });
      if (!title) return;
      await run('add', ['--title', title, '--after', anchor], 'added');
    }),

    vscode.commands.registerCommand('noggin.goto', async (item?: StoreItem) => {
      let path: string | undefined;
      if (item && item.key) {
        path = store.pathOf(item) ?? undefined;
      } else {
        path = await pickItem(store, 'Go to which item?');
      }
      if (!path) return;
      await run('goto', [path], 'goto');
    }),

    vscode.commands.registerCommand('noggin.done', async (item?: StoreItem) => {
      try {
        const path = targetPathOrThrow(item, 'done');
        const target = item ?? store.active;
        if (target && store.countOpenDescendants(target) > 0) {
          vscode.window.showWarningMessage(
            `Noggin: "${target.title}" has open descendants. Finish them first.`,
          );
          return;
        }
        await run('done', [path], 'done');
      } catch (err) {
        vscode.window.showErrorMessage(`Noggin: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('noggin.pop', async () => {
      await run('pop', [], 'popped');
    }),

    vscode.commands.registerCommand('noggin.undone', async (item?: StoreItem) => {
      try {
        const path = targetPathOrThrow(item, 'undone');
        await run('set-state', [path, '--undone'], 'set undone');
      } catch (err) {
        vscode.window.showErrorMessage(`Noggin: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('noggin.note', async (item?: StoreItem) => {
      try {
        const path = targetPathOrThrow(item, 'note');
        const target = item ?? store.active;
        const text = await vscode.window.showInputBox({
          title: target ? `Noggin: note on "${target.title}"` : 'Noggin: note',
          prompt: 'Note text (will be timestamped)',
        });
        if (!text) return;
        await run('note', [path, text], 'note appended');
      } catch (err) {
        vscode.window.showErrorMessage(`Noggin: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('noggin.retitle', async (item?: StoreItem) => {
      try {
        const path = targetPathOrThrow(item, 'retitle');
        const target = item ?? store.active;
        const newTitle = await vscode.window.showInputBox({
          title: target ? `Noggin: retitle "${target.title}"` : 'Noggin: retitle',
          prompt: 'New title',
          value: target?.title,
        });
        if (!newTitle) return;
        await run('retitle', [path, '--title', newTitle], 'retitled');
      } catch (err) {
        vscode.window.showErrorMessage(`Noggin: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('noggin.delete', async (item?: StoreItem) => {
      try {
        const path = targetPathOrThrow(item, 'delete');
        const target = item ?? store.active;
        if (!target) throw new Error('no target item');
        const descendants = store.countDescendants(target);
        const label = `"${target.title}"`;
        const detail = descendants > 0
          ? `${label} has ${descendants} descendant${descendants === 1 ? '' : 's'}. Deleting will remove the whole subtree.`
          : `${label} will be removed.`;
        const choice = await vscode.window.showWarningMessage(
          `Delete ${label}?`,
          { modal: true, detail },
          'Delete',
        );
        if (choice !== 'Delete') return;
        const args = [path];
        if (descendants > 0) args.push('--recursive');
        await run('delete', args, 'deleted');
      } catch (err) {
        vscode.window.showErrorMessage(`Noggin: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('noggin.revealActive', async () => {
      if (!store.isOpen) {
        vscode.commands.executeCommand('noggin.openFile');
        return;
      }
      const active = store.active;
      if (!active) {
        const pick = await vscode.window.showQuickPick(
          [
            { label: '$(arrow-down) Push…', action: 'push' },
            { label: '$(add) Add…', action: 'add' },
          ],
          { title: 'No active noggin item' },
        );
        if (pick?.action === 'push') vscode.commands.executeCommand('noggin.push');
        if (pick?.action === 'add') vscode.commands.executeCommand('noggin.add');
        return;
      }
      try {
        await view.reveal(active, { expand: true, focus: true, select: true });
      } catch {
        store.refresh();
        try { await view.reveal(active, { expand: true, focus: true, select: true }); } catch { /* ignore */ }
      }
    }),

    vscode.commands.registerCommand('noggin.revealItem', async (item: StoreItem) => {
      if (!item) return;
      try { await view.reveal(item, { select: true, focus: false }); } catch { /* ignore */ }
    }),
  );
}

async function pickItem(store: NogginStore, title: string): Promise<string | undefined> {
  const items = store
    .roots
    .flatMap((r) => flattenForPick(store, r, 0));
  if (items.length === 0) {
    vscode.window.showInformationMessage('Noggin is empty.');
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(items, { title, matchOnDescription: true });
  return pick?.path;
}

interface PickItem extends vscode.QuickPickItem { path: string }

function flattenForPick(store: NogginStore, item: StoreItem, depth: number): PickItem[] {
  const path = store.pathOf(item) ?? '?';
  const indent = '  '.repeat(depth);
  const indicators = item.done ? '✅' : '';
  const out: PickItem[] = [{
    label: `${indent}${item.title || '(untitled)'} ${indicators}`.trimEnd(),
    description: path,
    path,
  }];
  for (const child of store.childrenOf(item.key)) {
    out.push(...flattenForPick(store, child, depth + 1));
  }
  return out;
}

function formatResult(result: unknown): string {
  return JSON.stringify(result, null, 2);
}
