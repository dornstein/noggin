// In-process wrapper around the bundled noggin-api.mjs library.
//
// Replaces the old extension/src/store.ts (YAML reader + watcher) and
// extension/src/cli.ts (child_process.spawn wrapper) with a single object
// that holds a `Noggin` instance for the currently-open file. Verb methods
// call straight into the API; reads come from the API's deep-frozen
// in-memory snapshot.

import * as vscode from 'vscode';
import {
  Noggin,
  NogginError,
  type CurrentTreeView,
  type DeleteResult,
  type Item,
  type ItemKey,
  type ItemPath,
  type PushOptions,
  type AddOptions,
  type MoveOptions,
  type DoneOptions,
  type PopOptions,
  type EditOptions,
  type ShowOptions,
  type NoteOptions,
  type DeleteOptions,
} from '../skills/noggin/noggin-api.mjs';
import { fileNoggin } from '../skills/noggin/backends/file.mjs';
import { NogginSession } from './session.js';

export {
  Noggin,
  NogginError,
  type CurrentTreeView,
  type DeleteResult,
  type Item,
  type ItemKey,
  type ItemPath,
  type PushOptions,
  type AddOptions,
  type MoveOptions,
  type DoneOptions,
  type PopOptions,
  type EditOptions,
  type ShowOptions,
  type NoteOptions,
  type DeleteOptions,
};

/**
 * Long-lived handle that owns a `Noggin` instance for the open file.
 * Re-creates the instance whenever the session swaps files. Read accessors
 * answer from the cached store; verb methods delegate to the API and fire
 * `onDidChange`.
 */
export class NogginHandle implements vscode.Disposable {
  private current: Noggin | null = null;
  private currentChangeSub: vscode.Disposable | null = null;
  private currentErrorSub: vscode.Disposable | null = null;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly sessionSub: vscode.Disposable;

  constructor(
    private readonly session: NogginSession,
    private readonly output: vscode.OutputChannel,
  ) {
    this.sessionSub = session.onDidChange(() => { void this.swap(); });
    void this.swap();
  }

  dispose(): void {
    this.currentChangeSub?.dispose();
    this.currentErrorSub?.dispose();
    void this.current?.dispose();
    this.current = null;
    this.sessionSub.dispose();
    this.emitter.dispose();
  }

  // ── Identity / state ────────────────────────────────────────────────
  get file(): string | null { return this.session.file; }
  get isOpen(): boolean { return !!this.current; }
  get instance(): Noggin | null { return this.current; }

  // ── Read accessors (mirror the old NogginStore surface) ─────────────
  get active(): Item | null { return this.current?.active ?? null; }
  get roots(): Item[] { return this.current?.roots ?? []; }

  findByKey(key: string | null | undefined): Item | null {
    return this.current ? this.current.findByKey(key ?? null) : null;
  }

  childrenOf(parentKey: string | null | undefined): Item[] {
    return this.current ? this.current.childrenOf(parentKey ?? null) : [];
  }

  pathOf(item: Item | null | undefined): string | null {
    return this.current ? this.current.pathOf(item ?? null) : null;
  }

  tryResolvePath(path: string): Item | null {
    return this.current ? this.current.tryResolvePath(path) : null;
  }

  positionOf(item: Item | null | undefined): number | null {
    if (!item || !this.current) return null;
    const sibs = this.current.childrenOf(item.parentKey ?? null);
    const idx = sibs.findIndex((s) => s.key === item.key);
    return idx >= 0 ? idx + 1 : null;
  }

  ancestorsOf(item: Item): Item[] {
    const chain: Item[] = [];
    if (!this.current) return chain;
    let cur: Item | null = item.parentKey ? this.current.findByKey(item.parentKey) : null;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parentKey ? this.current.findByKey(cur.parentKey) : null;
    }
    return chain;
  }

  countOpenDescendants(item: Item): number {
    if (!this.current) return 0;
    let n = 0;
    const stack = [...this.current.childrenOf(item.key)];
    while (stack.length) {
      const f = stack.pop()!;
      if (!f.done) n++;
      for (const c of this.current.childrenOf(f.key)) stack.push(c);
    }
    return n;
  }

  countDescendants(item: Item): number {
    if (!this.current) return 0;
    let n = 0;
    const stack = [...this.current.childrenOf(item.key)];
    while (stack.length) {
      const f = stack.pop()!;
      n++;
      for (const c of this.current.childrenOf(f.key)) stack.push(c);
    }
    return n;
  }

  /** Force a re-read from disk and fire onDidChange. */
  refresh(): void {
    if (!this.current) { this.emitter.fire(); return; }
    this.current.reload();
    // reload only fires onDidChange when content changed; force a refresh
    // event regardless so views re-render on explicit user request.
    this.emitter.fire();
  }

  // ── Verb methods (1:1 with the API; async) ─────────────────────────
  push(opts: PushOptions): Promise<CurrentTreeView> { return this.requireOpen().push(opts); }
  add(opts: AddOptions): Promise<CurrentTreeView> { return this.requireOpen().add(opts); }
  move(opts: MoveOptions): Promise<CurrentTreeView> { return this.requireOpen().move(opts); }
  goto(p: ItemPath): Promise<CurrentTreeView> { return this.requireOpen().goto(p); }
  done(opts?: DoneOptions): Promise<CurrentTreeView> { return this.requireOpen().done(opts); }
  pop(opts?: PopOptions): Promise<CurrentTreeView> { return this.requireOpen().pop(opts); }
  edit(opts: EditOptions): Promise<CurrentTreeView> { return this.requireOpen().edit(opts); }
  show(opts?: ShowOptions): Promise<CurrentTreeView | null> { return this.requireOpen().show(opts); }
  note(opts: NoteOptions): Promise<CurrentTreeView> { return this.requireOpen().note(opts); }
  delete(opts: DeleteOptions): Promise<DeleteResult> { return this.requireOpen().delete(opts); }
  where(): string | null { return this.current ? this.current.describe() : null; }

  /** Throwable helper for the verb wrappers — keeps the type non-null. */
  private requireOpen(): Noggin {
    if (!this.current) throw new NogginError('no noggin is open', { code: 'no-file', exitCode: 2 });
    return this.current;
  }

  /** Build a CurrentTreeView for an arbitrary target. */
  view(target: Item | ItemPath | null | undefined, opts?: { includeChildren?: boolean }): CurrentTreeView | null {
    return this.current ? this.current.view(target ?? null, opts) : null;
  }

  // ── Internals ───────────────────────────────────────────────────────
  private async swap(): Promise<void> {
    this.currentChangeSub?.dispose();
    this.currentErrorSub?.dispose();
    if (this.current) {
      try { await this.current.dispose(); } catch { /* ignore */ }
    }
    this.current = null;
    this.currentChangeSub = null;
    this.currentErrorSub = null;

    const file = this.session.file;
    if (!file) { this.emitter.fire(); return; }
    let noggin: Noggin;
    try {
      noggin = await fileNoggin(file, { watch: true });
    } catch (err) {
      this.output.appendLine(`[${new Date().toISOString()}] noggin: failed to open ${file}: ${(err as Error).message}`);
      this.emitter.fire();
      return;
    }
    // Bail if another swap happened while we were awaiting.
    if (this.session.file !== file) {
      try { await noggin.dispose(); } catch { /* ignore */ }
      return;
    }
    this.current = noggin;
    this.currentChangeSub = noggin.onDidChange(() => this.emitter.fire());
    this.currentErrorSub = noggin.onDidError((err: NogginError) => {
      this.output.appendLine(`[${new Date().toISOString()}] noggin: ${err.message}`);
    });
    this.emitter.fire();
  }
}

/** Convert any error from a verb call to a human string. */
export function nogginErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
