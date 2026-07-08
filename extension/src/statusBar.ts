import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as vscode from 'vscode';
import { NogginSession } from './session.js';
import { NogginHandle } from './noggin.js';

const MAX_LEN = 40;

export class NogginStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly handle: NogginHandle, private readonly session: NogginSession) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'noggin.revealActive';
    this.disposables.push(this.item);
    this.disposables.push(handle.onDidChange(() => this.render()));
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

    if (!this.session.location) {
      this.item.text = '$(circle-large-outline) noggin: closed';
      const md = new vscode.MarkdownString('No noggin is open.\n\nClick to open one.', true);
      this.item.tooltip = md;
      this.item.command = 'noggin.openFile';
      this.item.show();
      return;
    }

    this.item.command = 'noggin.revealActive';
    const active = this.handle.active;
    const location = this.session.location!;
    const fileLabel = friendlyLocationLabel(location);

    if (!active) {
      this.item.text = `$(circle-large-outline) noggin · ${fileLabel}`;
      const md = new vscode.MarkdownString(`No active item.\n\n_${location}_`, true);
      this.item.tooltip = md;
      this.item.show();
      return;
    }

    const title = truncate(active.title || '(untitled)', MAX_LEN);
    this.item.text = `$(circle-large-filled) ${title} · ${fileLabel}`;

    const spine = [...this.handle.ancestorsOf(active), active]
      .map((i, idx, arr) => (idx === arr.length - 1 ? `**${i.title}**` : i.title))
      .join(' → ');
    const md = new vscode.MarkdownString('', true);
    md.appendMarkdown(`**Active:** ${active.title}\n\n`);
    if (this.handle.ancestorsOf(active).length) md.appendMarkdown(`Spine: ${spine}\n\n`);
    md.appendMarkdown(`Location: \`${location}\`\n\n`);
    md.appendMarkdown(`Click to reveal in the Noggin view.`);
    this.item.tooltip = md;
    this.item.show();
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/** Compact label for the status bar. File locations get the same
 *  workspace-relative / `~`-prefixed / basename treatment we always
 *  used; URI locations get a scheme-specific rendering. */
function friendlyLocationLabel(location: string): string {
  // Reuse the existing file-shaped labelling for anything that
  // resolves to a filesystem path (bare paths + `file://` URIs).
  const asFs = asFsPathIfPossible(location);
  if (asFs !== null) return friendlyFileLabel(asFs);

  const vscodeTodo = /^vscode-todo:\/\/.*#(.+)$/i.exec(location);
  if (vscodeTodo) {
    const sid = vscodeTodo[1];
    const short = sid.length > 8 ? sid.slice(0, 8) : sid;
    return `Copilot todo · ${short}`;
  }

  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(location);
  if (!schemeMatch) return location;
  const [, scheme, rest] = schemeMatch;
  const clean = rest.split(/[#?]/, 1)[0];
  const tail = clean.split('/').filter(Boolean).pop() ?? clean;
  return `${scheme}:${tail}`;
}

function asFsPathIfPossible(location: string): string | null {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(location)) return location;
  if (location.toLowerCase().startsWith('file://')) {
    try { return fileURLToPath(location); }
    catch { return null; }
  }
  return null;
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
