// In-memory model of the open noggin store. Reads YAML directly; writes go
// through the CLI (cli.ts). Reloads automatically when the file changes
// on disk, and re-points to a new file when the NogginSession changes.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { NogginSession } from './session';

export interface StoreItem {
  key: string;
  parentKey: string | null;
  title: string;
  done: boolean;
  pushedAt?: string;
  closedAt?: string | null;
  notes: Array<{ timestamp: string | null; text: string }>;
}

export interface StoreData {
  schemaVersion: number;
  active: string | null;
  items: StoreItem[];
}

const EMPTY: StoreData = { schemaVersion: 1, active: null, items: [] };

export class NogginStore implements vscode.Disposable {
  private data: StoreData = EMPTY;
  private watcher: fs.FSWatcher | undefined;
  private watchedFile: string | null = null;
  private debounceTimer: NodeJS.Timeout | undefined;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly session: NogginSession) {
    this.subscription = session.onDidChange(() => this.onSessionChanged());
    this.onSessionChanged();
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.watcher?.close();
    this.subscription.dispose();
    this.emitter.dispose();
  }

  get file(): string | null { return this.session.file; }
  get isOpen(): boolean { return !!this.session.file; }
  get active(): StoreItem | null { return this.data.active ? this.findByKey(this.data.active) : null; }
  get roots(): StoreItem[] { return this.data.items.filter((i) => !i.parentKey); }

  findByKey(key: string | null | undefined): StoreItem | null {
    if (!key) return null;
    return this.data.items.find((i) => i.key === key) ?? null;
  }

  childrenOf(parentKey: string | null): StoreItem[] {
    return this.data.items.filter((i) => (i.parentKey ?? null) === parentKey);
  }

  positionOf(item: StoreItem): number {
    const siblings = this.childrenOf(item.parentKey ?? null);
    return siblings.findIndex((s) => s.key === item.key) + 1;
  }

  pathOf(item: StoreItem | null): string | null {
    if (!item) return null;
    const parts: string[] = [];
    let cur: StoreItem | null = item;
    while (cur) {
      const pos = this.positionOf(cur);
      if (pos <= 0) return null;
      parts.unshift(String(pos));
      cur = cur.parentKey ? this.findByKey(cur.parentKey) : null;
    }
    return parts.join('/');
  }

  ancestorsOf(item: StoreItem): StoreItem[] {
    const chain: StoreItem[] = [];
    let cur: StoreItem | null = item.parentKey ? this.findByKey(item.parentKey) : null;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parentKey ? this.findByKey(cur.parentKey) : null;
    }
    return chain;
  }

  countOpenDescendants(item: StoreItem): number {
    let n = 0;
    const stack = [...this.childrenOf(item.key)];
    while (stack.length) {
      const f = stack.pop()!;
      if (!f.done) n++;
      for (const c of this.childrenOf(f.key)) stack.push(c);
    }
    return n;
  }

  countDescendants(item: StoreItem): number {
    let n = 0;
    const stack = [...this.childrenOf(item.key)];
    while (stack.length) {
      const f = stack.pop()!;
      n++;
      for (const c of this.childrenOf(f.key)) stack.push(c);
    }
    return n;
  }

  refresh(): void {
    this.reload();
    this.emitter.fire();
  }

  private onSessionChanged(): void {
    this.installWatcher();
    this.reload();
    this.emitter.fire();
  }

  private reload(): void {
    const file = this.session.file;
    if (!file) { this.data = { ...EMPTY }; return; }
    try {
      if (!fs.existsSync(file)) { this.data = { ...EMPTY }; return; }
      const raw = fs.readFileSync(file, 'utf8');
      if (!raw.trim()) { this.data = { ...EMPTY }; return; }
      const parsed = yaml.load(raw) as Partial<StoreData> | null;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
        this.data = { ...EMPTY };
        return;
      }
      this.data = {
        schemaVersion: parsed.schemaVersion ?? 1,
        active: parsed.active ?? null,
        items: parsed.items.map((i) => ({
          key: i.key,
          parentKey: i.parentKey ?? null,
          title: i.title ?? '',
          done: Boolean(i.done),
          pushedAt: i.pushedAt,
          closedAt: i.closedAt ?? null,
          notes: Array.isArray(i.notes) ? i.notes : [],
        })),
      };
    } catch {
      this.data = { ...EMPTY };
    }
  }

  private installWatcher(): void {
    const file = this.session.file;
    if (this.watchedFile === file) return;
    this.watcher?.close();
    this.watcher = undefined;
    this.watchedFile = file;
    if (!file) return;
    try {
      const dir = path.dirname(file);
      const base = path.basename(file);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.watcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
        if (!filename || filename === base) this.scheduleRefresh();
      });
    } catch {
      // watcher unavailable; the user can still hit Refresh manually.
    }
  }

  private scheduleRefresh(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => { this.refresh(); }, 100);
  }
}
