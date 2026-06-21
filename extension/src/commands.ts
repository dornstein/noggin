import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as vscode from 'vscode';
import type { Item } from '../skills/noggin/noggin-api.mjs';
import { NogginHandle } from './noggin.js';
import { NogginSession } from './session.js';

interface CommandContext {
  handle: NogginHandle;
  session: NogginSession;
  output: vscode.OutputChannel;
}

type VerbResult = unknown;

export function registerCommands(
  context: vscode.ExtensionContext,
  ctx: CommandContext,
): void {
  const { handle, session, output } = ctx;

  function runVerb(verb: string, op: () => VerbResult, announce?: string): void {
    if (!handle.isOpen) {
      vscode.window.showWarningMessage('Noggin: no noggin is open. Use "Noggin: Open" or "Noggin: New" first.');
      return;
    }
    try {
      const result = op();
      if (announce) {
        const title = result && typeof result === 'object' && 'title' in result ? String((result as { title: unknown }).title ?? '') : '';
        const text = title ? `${announce}: ${title}` : announce;
        vscode.window.setStatusBarMessage(`Noggin — ${text}`, 3000);
      }
      output.appendLine(`[${new Date().toISOString()}] noggin ${verb}`);
      if (result) output.appendLine(formatResult(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Noggin: ${msg}`);
      output.appendLine(`[${new Date().toISOString()}] ERROR: ${msg}`);
    }
  }

  function targetPathOrThrow(arg: Item | undefined, verb: string): string {
    if (arg && typeof arg === 'object' && arg.key) {
      const p = handle.pathOf(arg);
      if (p) return p;
    }
    const active = handle.active;
    if (!active) throw new Error(`${verb}: no active item and no item provided`);
    return handle.pathOf(active)!;
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
    vscode.commands.registerCommand('noggin.refresh', () => handle.refresh()),

    vscode.commands.registerCommand('noggin.show', async () => {
      if (!handle.isOpen) {
        vscode.window.showWarningMessage('Noggin: no noggin is open.');
        return;
      }
      try {
        const result = handle.show({ notes: true });
        output.clear();
        output.appendLine(formatResult(result));
        output.show(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
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
      runVerb('push', () => handle.push({ title }), 'pushed');
    }),

    vscode.commands.registerCommand('noggin.add', async () => {
      const title = await vscode.window.showInputBox({
        title: 'Noggin: add',
        prompt: 'Title for the new item (added under active, not activated)',
      });
      if (!title) return;
      runVerb('add', () => handle.add({ title }), 'added');
    }),

    vscode.commands.registerCommand('noggin.addChild', async (item?: Item) => {
      const title = await vscode.window.showInputBox({
        title: item ? `Noggin: add child of "${item.title}"` : 'Noggin: add child',
        prompt: 'Title for the new child',
      });
      if (!title) return;
      const placement = item
        ? { kind: 'into' as const, anchor: handle.pathOf(item) ?? '' }
        : undefined;
      runVerb('add', () => handle.add({ title, placement }), 'added');
    }),

    vscode.commands.registerCommand('noggin.addBefore', async (item?: Item) => {
      if (!item) return;
      const anchor = handle.pathOf(item);
      if (!anchor) return;
      const title = await vscode.window.showInputBox({
        title: `Noggin: add before "${item.title}"`,
        prompt: 'Title for the new sibling (inserted before this item)',
      });
      if (!title) return;
      runVerb('add', () => handle.add({ title, placement: { kind: 'before', anchor } }), 'added');
    }),

    vscode.commands.registerCommand('noggin.addAfter', async (item?: Item) => {
      if (!item) return;
      const anchor = handle.pathOf(item);
      if (!anchor) return;
      const title = await vscode.window.showInputBox({
        title: `Noggin: add after "${item.title}"`,
        prompt: 'Title for the new sibling (inserted after this item)',
      });
      if (!title) return;
      runVerb('add', () => handle.add({ title, placement: { kind: 'after', anchor } }), 'added');
    }),

    vscode.commands.registerCommand('noggin.goto', async (item?: Item) => {
      let p: string | undefined;
      if (item && item.key) {
        p = handle.pathOf(item) ?? undefined;
      } else {
        p = await pickItem(handle, 'Go to which item?');
      }
      if (!p) return;
      runVerb('goto', () => handle.goto(p!), 'goto');
    }),

    vscode.commands.registerCommand('noggin.done', async (item?: Item) => {
      try {
        const target = item ?? handle.active;
        if (!target) throw new Error('done: no active item and no item provided');
        const targetPath = handle.pathOf(target);
        if (!targetPath) throw new Error('done: could not resolve target path');

        const openCount = handle.countOpenDescendants(target);
        if (openCount > 0) {
          const label = `"${target.title}"`;
          const choice = await vscode.window.showWarningMessage(
            `Close ${label} and its ${openCount} open descendant${openCount === 1 ? '' : 's'}?`,
            {
              modal: true,
              detail: `Marking ${label} done requires every open item underneath it to be marked done too. This cannot be undone in one step.`,
            },
            'Close All',
          );
          if (choice !== 'Close All') return;
          // `set --done --closeall` closes leaves first, then the target,
          // all in one atomic store write. Active stays put (the UI gesture
          // is "set this item's state", not the CLI's spine-pop `done`).
          runVerb('done (recursive)', () =>
            handle.set({ path: targetPath, done: true, closeAll: true }), 'done');
          return;
        }

        runVerb('done', () => handle.set({ path: targetPath, done: true }), 'done');
      } catch (err) {
        vscode.window.showErrorMessage(`Noggin: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('noggin.pop', async () => {
      runVerb('pop', () => handle.pop(), 'popped');
    }),

    vscode.commands.registerCommand('noggin.undone', async (item?: Item) => {
      try {
        const p = targetPathOrThrow(item, 'undone');
        runVerb('set', () => handle.set({ path: p, done: false }), 'set undone');
      } catch (err) {
        vscode.window.showErrorMessage(`Noggin: ${(err as Error).message}`);
      }
    }),

    /**
     * UI gesture for the state-toggle icons (tree row + details header).
     * Open → invoke noggin.done (handles the cascade confirm for parents with
     * open descendants); Done → invoke noggin.undone.
     */
    vscode.commands.registerCommand('noggin.toggleDone', async (item?: Item) => {
      const target = item ?? handle.active;
      if (!target) return;
      const next = target.done ? 'noggin.undone' : 'noggin.done';
      await vscode.commands.executeCommand(next, target);
    }),

    vscode.commands.registerCommand('noggin.note', async (item?: Item) => {
      try {
        const p = targetPathOrThrow(item, 'note');
        const target = item ?? handle.active;
        const text = await vscode.window.showInputBox({
          title: target ? `Noggin: note on "${target.title}"` : 'Noggin: note',
          prompt: 'Note text (will be timestamped)',
        });
        if (!text) return;
        runVerb('note', () => handle.note({ path: p, text }), 'note appended');
      } catch (err) {
        vscode.window.showErrorMessage(`Noggin: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('noggin.retitle', async (item?: Item) => {
      try {
        const p = targetPathOrThrow(item, 'retitle');
        const target = item ?? handle.active;
        const newTitle = await vscode.window.showInputBox({
          title: target ? `Noggin: retitle "${target.title}"` : 'Noggin: retitle',
          prompt: 'New title',
          value: target?.title,
        });
        if (!newTitle) return;
        runVerb('set', () => handle.set({ path: p, title: newTitle }), 'retitled');
      } catch (err) {
        vscode.window.showErrorMessage(`Noggin: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('noggin.delete', async (item?: Item) => {
      try {
        const p = targetPathOrThrow(item, 'delete');
        const target = item ?? handle.active;
        if (!target) throw new Error('no target item');
        const descendants = handle.countDescendants(target);
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
        runVerb('delete', () => handle.delete({ path: p, recursive: descendants > 0 }), 'deleted');
      } catch (err) {
        vscode.window.showErrorMessage(`Noggin: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('noggin.revealActive', async () => {
      if (!handle.isOpen) {
        vscode.commands.executeCommand('noggin.openFile');
        return;
      }
      const active = handle.active;
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
      // The webview tree mirrors the active item via the snapshot pipeline;
      // bringing the view into focus is enough — the React side will scroll
      // and select on its own.
      await vscode.commands.executeCommand('nogginTree.focus');
    }),
  );
}

async function pickItem(handle: NogginHandle, title: string): Promise<string | undefined> {
  const items = handle.roots.flatMap((r) => flattenForPick(handle, r, 0));
  if (items.length === 0) {
    vscode.window.showInformationMessage('Noggin is empty.');
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(items, { title, matchOnDescription: true });
  return pick?.path;
}

interface PickItem extends vscode.QuickPickItem { path: string }

function flattenForPick(handle: NogginHandle, item: Item, depth: number): PickItem[] {
  const p = handle.pathOf(item) ?? '?';
  const indent = '  '.repeat(depth);
  const indicators = item.done ? '✅' : '';
  const out: PickItem[] = [{
    label: `${indent}${item.title || '(untitled)'} ${indicators}`.trimEnd(),
    description: p,
    path: p,
  }];
  for (const child of handle.childrenOf(item.key)) {
    out.push(...flattenForPick(handle, child, depth + 1));
  }
  return out;
}

function formatResult(result: unknown): string {
  return JSON.stringify(result, null, 2);
}
