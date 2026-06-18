import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { NogginSession } from './session';
import { NogginStore } from './store';

const MAX_LEN = 40;

export class NogginStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly store: NogginStore, private readonly session: NogginSession) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'noggin.revealActive';
    this.disposables.push(this.item);
    this.disposables.push(store.onDidChange(() => this.render()));
    this.disposables.push(session.onDidChange(() => this.render()));
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('noggin.statusBar.enabled')) this.render();
      }),
    );
    this.render();
  }

  dispose(): void { for (const d of this.disposables) d.dispose(); }

  private render(): void {
    const enabled = vscode.workspace.getConfiguration('noggin').get<boolean>('statusBar.enabled', true);
    if (!enabled) { this.item.hide(); return; }

    if (!this.session.file) {
      this.item.text = '$(circle-large-outline) noggin: closed';
      const md = new vscode.MarkdownString('No noggin is open.\n\nClick to open one.', true);
      this.item.tooltip = md;
      this.item.command = 'noggin.openFile';
      this.item.show();
      return;
    }

    this.item.command = 'noggin.revealActive';
    const active = this.store.active;
    const fileLabel = friendlyFileLabel(this.session.file);

    if (!active) {
      this.item.text = `$(circle-large-outline) noggin · ${fileLabel}`;
      const md = new vscode.MarkdownString(`No active item.\n\n_${this.session.file}_`, true);
      this.item.tooltip = md;
      this.item.show();
      return;
    }

    const title = truncate(active.title || '(untitled)', MAX_LEN);
    this.item.text = `$(circle-large-filled) ${title} · ${fileLabel}`;

    const spine = [...this.store.ancestorsOf(active), active]
      .map((i, idx, arr) => (idx === arr.length - 1 ? `**${i.title}**` : i.title))
      .join(' → ');
    const md = new vscode.MarkdownString('', true);
    md.appendMarkdown(`**Active:** ${active.title}\n\n`);
    if (this.store.ancestorsOf(active).length) md.appendMarkdown(`Spine: ${spine}\n\n`);
    md.appendMarkdown(`File: \`${this.session.file}\`\n\n`);
    md.appendMarkdown(`Click to reveal in the Noggin view.`);
    this.item.tooltip = md;
    this.item.show();
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function friendlyFileLabel(file: string): string {
  const folders = vscode.workspace.workspaceFolders;
  if (folders) {
    for (const f of folders) {
      const root = f.uri.fsPath;
      if (file === path.join(root, '.noggin.yaml')) return 'workspace';
      if (file.startsWith(root + path.sep)) return path.relative(root, file);
    }
  }
  const home = os.homedir();
  if (file.startsWith(home + path.sep)) return '~/' + path.relative(home, file).replace(/\\/g, '/');
  return path.basename(file);
}
