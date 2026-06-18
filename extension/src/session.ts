// Tracks which noggin file is currently open. Persisted in workspaceState
// so reopening the same VS Code window restores the same noggin.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

const STATE_KEY = 'noggin.openFile';
const EMPTY_SEED = 'schemaVersion: 1\nactive: null\nitems: []\n';

export class NogginSession implements vscode.Disposable {
  private currentFile: string | null;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.currentFile = context.workspaceState.get<string | null>(STATE_KEY, null);
    this.context.environmentVariableCollection.description =
      'Sets NOGGIN_FILE so the noggin CLI in this terminal targets the noggin file you have open in VS Code.';
    this.publishEnv();
    this.publishContext();
  }

  dispose(): void { this.emitter.dispose(); }

  get file(): string | null { return this.currentFile; }

  static workspaceNogginPath(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    return path.join(folders[0].uri.fsPath, '.noggin.yaml');
  }

  async open(file: string): Promise<void> {
    const normalized = path.normalize(file);
    this.currentFile = normalized;
    await this.context.workspaceState.update(STATE_KEY, normalized);
    this.publishEnv();
    this.publishContext();
    this.emitter.fire();
  }

  async create(file: string): Promise<void> {
    const normalized = path.normalize(file);
    if (!fs.existsSync(normalized)) {
      const dir = path.dirname(normalized);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(normalized, EMPTY_SEED, 'utf8');
    }
    await this.open(normalized);
  }

  async close(): Promise<void> {
    this.currentFile = null;
    await this.context.workspaceState.update(STATE_KEY, undefined);
    this.publishEnv();
    this.publishContext();
    this.emitter.fire();
  }

  private publishEnv(): void {
    const coll = this.context.environmentVariableCollection;
    if (this.currentFile) {
      coll.replace('NOGGIN_FILE', this.currentFile);
    } else {
      coll.delete('NOGGIN_FILE');
    }
  }

  private publishContext(): void {
    vscode.commands.executeCommand('setContext', 'noggin.fileOpen', !!this.currentFile);
    vscode.commands.executeCommand(
      'setContext',
      'noggin.workspaceOpen',
      !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length),
    );
  }
}
