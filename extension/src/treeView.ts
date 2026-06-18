import * as vscode from 'vscode';
import type { Item } from '../skills/noggin/noggin-api.mjs';
import { NogginHandle } from './noggin.js';

export class NogginTreeProvider implements vscode.TreeDataProvider<Item> {
  private readonly emitter = new vscode.EventEmitter<Item | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly handle: NogginHandle) {
    handle.onDidChange(() => this.emitter.fire());
  }

  refresh(): void { this.emitter.fire(); }

  getTreeItem(element: Item): vscode.TreeItem {
    const children = this.handle.childrenOf(element.key);
    const position = this.handle.positionOf(element);

    const item = new vscode.TreeItem(
      `${position}. ${element.title || '(untitled)'}`,
      children.length > 0
        ? (this.isOnActiveSpine(element)
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed)
        : vscode.TreeItemCollapsibleState.None,
    );

    const decorations: string[] = [];
    if (element.notes?.length) decorations.push(`✏️${element.notes.length}`);
    item.description = decorations.join(' ');

    item.contextValue = element.done ? 'nogginItem.done' : 'nogginItem.open';
    item.tooltip = this.buildTooltip(element);

    if (element.done) {
      item.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
    }

    item.id = element.key;
    return item;
  }

  getChildren(element?: Item): Item[] {
    if (!element) return this.handle.roots;
    return this.handle.childrenOf(element.key);
  }

  getParent(element: Item): Item | null {
    return element.parentKey ? this.handle.findByKey(element.parentKey) : null;
  }

  private isOnActiveSpine(item: Item): boolean {
    const active = this.handle.active;
    if (!active) return false;
    let cur: Item | null = active;
    while (cur) {
      if (cur.key === item.key) return true;
      cur = cur.parentKey ? this.handle.findByKey(cur.parentKey) : null;
    }
    return false;
  }

  private buildTooltip(item: Item): vscode.MarkdownString {
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = false;
    md.supportThemeIcons = true;

    const p = this.handle.pathOf(item) ?? '';
    md.appendMarkdown(`**${escape(item.title || '(untitled)')}**\n\n`);
    md.appendMarkdown(`Path: \`${p}\`\n\n`);

    const flags: string[] = [];
    if (this.handle.active?.key === item.key) flags.push('active');
    if (item.done) flags.push('done');
    if (flags.length) md.appendMarkdown(`State: ${flags.join(', ')}\n\n`);

    if (item.pushedAt) md.appendMarkdown(`Pushed: ${item.pushedAt}  \n`);
    if (item.closedAt) md.appendMarkdown(`Closed: ${item.closedAt}  \n`);

    return md;
  }
}

function escape(s: string): string {
  return s.replace(/[\\`*_{}\[\]()#+\-.!|>]/g, (m) => `\\${m}`);
}
