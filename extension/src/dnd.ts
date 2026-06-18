import * as vscode from 'vscode';
import { CliError, CliRunner } from './cli';
import { NogginStore, StoreItem } from './store';

const MIME = 'application/vnd.code.tree.noggintree';

export class NogginDragAndDrop implements vscode.TreeDragAndDropController<StoreItem> {
  readonly dropMimeTypes = [MIME];
  readonly dragMimeTypes = [MIME];

  constructor(
    private readonly cli: CliRunner,
    private readonly store: NogginStore,
    private readonly output: vscode.OutputChannel,
  ) {}

  handleDrag(source: readonly StoreItem[], dt: vscode.DataTransfer): void {
    const keys = source.map((s) => s.key).filter(Boolean);
    if (keys.length) dt.set(MIME, new vscode.DataTransferItem(keys));
  }

  async handleDrop(target: StoreItem | undefined, dt: vscode.DataTransfer): Promise<void> {
    const transfer = dt.get(MIME);
    if (!transfer) return;
    const keys: unknown = await transfer.value;
    if (!Array.isArray(keys) || keys.length === 0) return;

    const sources = keys
      .map((k) => this.store.findByKey(String(k)))
      .filter((s): s is StoreItem => !!s);
    if (sources.length === 0) return;

    if (target) {
      // Drop on a node: reparent each source as the last child of target.
      // Reject moves where the target sits inside the source's own subtree
      // (cycle) or where source already is the target.
      for (const src of sources) {
        if (src.key === target.key) continue;
        if (this.isAncestor(src, target)) {
          vscode.window.showWarningMessage(
            `Noggin: cannot move "${src.title}" into its own descendant.`,
          );
          continue;
        }
        await this.run(src, ['--into', this.pathOrSkip(target)!]);
      }
    } else {
      // Drop on empty area: move each source to the end of the root list.
      // Use --after <last root> if there is one, otherwise it's already a root
      // and there's nothing to do unless it isn't.
      const roots = this.store.roots;
      const lastRoot = roots[roots.length - 1];
      for (const src of sources) {
        if (!lastRoot) continue; // empty tree; can't even be here
        if (src.key === lastRoot.key) continue; // already last root
        await this.run(src, ['--after', this.pathOrSkip(lastRoot)!]);
      }
    }
    this.store.refresh();
  }

  private async run(src: StoreItem, tail: string[]): Promise<void> {
    const srcPath = this.pathOrSkip(src);
    if (!srcPath) return;
    try {
      await this.cli.run('move', [srcPath, ...tail]);
      this.output.appendLine(`[${new Date().toISOString()}] noggin move ${srcPath} ${tail.join(' ')}`);
    } catch (err) {
      const msg = err instanceof CliError ? err.message : (err as Error).message;
      vscode.window.showErrorMessage(`Noggin: ${msg}`);
      this.output.appendLine(`[${new Date().toISOString()}] ERROR: ${msg}`);
    }
  }

  private pathOrSkip(item: StoreItem): string | null {
    const p = this.store.pathOf(item);
    if (!p) {
      vscode.window.showWarningMessage(`Noggin: could not resolve path for "${item.title}".`);
      return null;
    }
    return p;
  }

  private isAncestor(ancestor: StoreItem, candidate: StoreItem): boolean {
    let cur: StoreItem | null = candidate;
    while (cur) {
      if (cur.key === ancestor.key) return true;
      cur = cur.parentKey ? this.store.findByKey(cur.parentKey) : null;
    }
    return false;
  }
}
