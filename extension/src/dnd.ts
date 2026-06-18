import * as vscode from 'vscode';
import type { Item } from '../skills/noggin/noggin-api.mjs';
import { NogginHandle } from './noggin.js';

const MIME = 'application/vnd.code.tree.noggintree';

export class NogginDragAndDrop implements vscode.TreeDragAndDropController<Item> {
  readonly dropMimeTypes = [MIME];
  readonly dragMimeTypes = [MIME];

  constructor(
    private readonly handle: NogginHandle,
    private readonly output: vscode.OutputChannel,
  ) {}

  handleDrag(source: readonly Item[], dt: vscode.DataTransfer): void {
    const keys = source.map((s) => s.key).filter(Boolean);
    if (keys.length) dt.set(MIME, new vscode.DataTransferItem(keys));
  }

  async handleDrop(target: Item | undefined, dt: vscode.DataTransfer): Promise<void> {
    const transfer = dt.get(MIME);
    if (!transfer) return;
    const keys: unknown = await transfer.value;
    if (!Array.isArray(keys) || keys.length === 0) return;

    const sources = keys
      .map((k) => this.handle.findByKey(String(k)))
      .filter((s): s is Item => !!s);
    if (sources.length === 0) return;

    if (target) {
      // Drop on a node: reparent each source as the last child of target.
      // Reject moves where the target sits inside the source's own subtree.
      for (const src of sources) {
        if (src.key === target.key) continue;
        if (this.isAncestor(src, target)) {
          vscode.window.showWarningMessage(
            `Noggin: cannot move "${src.title}" into its own descendant.`,
          );
          continue;
        }
        const anchor = this.pathOrSkip(target);
        if (anchor) this.runMove(src, 'into', anchor);
      }
    } else {
      // Drop on empty area: move each source to the end of the root list.
      const roots = this.handle.roots;
      const lastRoot = roots[roots.length - 1];
      for (const src of sources) {
        if (!lastRoot) continue;
        if (src.key === lastRoot.key) continue;
        const anchor = this.pathOrSkip(lastRoot);
        if (anchor) this.runMove(src, 'after', anchor);
      }
    }
    this.handle.refresh();
  }

  private runMove(src: Item, kind: 'before' | 'after' | 'into', anchor: string): void {
    const srcPath = this.pathOrSkip(src);
    if (!srcPath) return;
    try {
      this.handle.move({ path: srcPath, placement: { kind, anchor } });
      this.output.appendLine(`[${new Date().toISOString()}] noggin move ${srcPath} --${kind} ${anchor}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Noggin: ${msg}`);
      this.output.appendLine(`[${new Date().toISOString()}] ERROR: ${msg}`);
    }
  }

  private pathOrSkip(item: Item): string | null {
    const p = this.handle.pathOf(item);
    if (!p) {
      vscode.window.showWarningMessage(`Noggin: could not resolve path for "${item.title}".`);
      return null;
    }
    return p;
  }

  private isAncestor(ancestor: Item, candidate: Item): boolean {
    let cur: Item | null = candidate;
    while (cur) {
      if (cur.key === ancestor.key) return true;
      cur = cur.parentKey ? this.handle.findByKey(cur.parentKey) : null;
    }
    return false;
  }
}
