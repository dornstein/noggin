import * as vscode from 'vscode';
import { NogginStore, StoreItem } from './store';

export class NogginTreeProvider implements vscode.TreeDataProvider<StoreItem> {
  private readonly emitter = new vscode.EventEmitter<StoreItem | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly store: NogginStore) {
    store.onDidChange(() => this.emitter.fire());
  }

  refresh(): void { this.emitter.fire(); }

  getTreeItem(element: StoreItem): vscode.TreeItem {
    const children = this.store.childrenOf(element.key);
    const position = this.store.positionOf(element);

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

  getChildren(element?: StoreItem): StoreItem[] {
    if (!element) return this.store.roots;
    return this.store.childrenOf(element.key);
  }

  getParent(element: StoreItem): StoreItem | null {
    return element.parentKey ? this.store.findByKey(element.parentKey) : null;
  }

  private isOnActiveSpine(item: StoreItem): boolean {
    const active = this.store.active;
    if (!active) return false;
    let cur: StoreItem | null = active;
    while (cur) {
      if (cur.key === item.key) return true;
      cur = cur.parentKey ? this.store.findByKey(cur.parentKey) : null;
    }
    return false;
  }

  private buildTooltip(item: StoreItem): vscode.MarkdownString {
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = false;
    md.supportThemeIcons = true;

    const p = this.store.pathOf(item) ?? '';
    md.appendMarkdown(`**${escape(item.title || '(untitled)')}**\n\n`);
    md.appendMarkdown(`Path: \`${p}\`\n\n`);

    const flags: string[] = [];
    if (this.store.active?.key === item.key) flags.push('active');
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
