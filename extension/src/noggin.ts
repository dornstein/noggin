// In-process wrapper around the bundled engine.
//
// Holds a `Noggin` for the currently-open file (via the file provider,
// registered side-effect via the import below) and exposes verb shortcuts
// that delegate to `verbs.*` from the engine. Read accessors mirror the
// provider's deep-frozen in-memory snapshot.

import * as vscode from 'vscode';
import {
  NogginError,
  openNoggin,
  verbs,
  providers,
  type CurrentTreeView,
  type DeleteResult,
  type Item,
  type ItemKey,
  type ItemPath,
  type Noggin,
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
import '../skills/noggin/providers/file.mjs'; // side-effect: registers file://
import { NogginSession } from './session.js';

export {
  NogginError,
  type Noggin,
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
 * Long-lived handle that owns a `Noggin` for the open file. Re-creates
 * the noggin whenever the session swaps files. Read accessors answer
 * from the cached document; verb methods delegate to `verbs.*` and the
 * provider's `apply(ops)`.
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

  // ── Read accessors ───────────────────────────────────────────────────
  get active(): Item | null { return this.current?.active ?? null; }
  get roots(): readonly Item[] { return this.current?.roots ?? []; }

  findByKey(key: string | null | undefined): Item | null {
    return this.current ? this.current.findByKey(key ?? null) : null;
  }

  childrenOf(parentKey: string | null | undefined): readonly Item[] {
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
    const stack: Item[] = [...this.current.childrenOf(item.key)];
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
    const stack: Item[] = [...this.current.childrenOf(item.key)];
    while (stack.length) {
      const f = stack.pop()!;
      n++;
      for (const c of this.current.childrenOf(f.key)) stack.push(c);
    }
    return n;
  }

  /** Force a re-render (the file provider handles disk re-reads via its watcher). */
  refresh(): void {
    this.emitter.fire();
  }

  // ── Verb methods (delegate to engine verbs) ─────────────────────────
  push(opts: PushOptions): Promise<CurrentTreeView> { return verbs.push(this.requireOpen(), opts); }
  add(opts: AddOptions): Promise<CurrentTreeView> { return verbs.add(this.requireOpen(), opts); }
  move(opts: MoveOptions): Promise<CurrentTreeView> { return verbs.move(this.requireOpen(), opts); }
  goto(p: ItemPath): Promise<CurrentTreeView> { return verbs.goto(this.requireOpen(), { path: p }); }
  done(opts?: DoneOptions): Promise<CurrentTreeView> { return verbs.done(this.requireOpen(), opts); }
  pop(opts?: PopOptions): Promise<CurrentTreeView> { return verbs.pop(this.requireOpen(), opts); }
  edit(opts: EditOptions): Promise<CurrentTreeView> { return verbs.edit(this.requireOpen(), opts); }
  show(opts?: ShowOptions): Promise<CurrentTreeView | null> { return verbs.show(this.requireOpen(), opts); }
  note(opts: NoteOptions): Promise<CurrentTreeView> { return verbs.note(this.requireOpen(), opts); }
  delete(opts: DeleteOptions): Promise<DeleteResult> { return verbs.delete(this.requireOpen(), opts); }
  where(): string | null { return this.current ? this.current.describe() : null; }

  /** List registered providers (file://, etc.). */
  providers(): ReadonlyArray<{ scheme: string; default: boolean }> { return providers.list(); }

  /**
   * Resolve a noggin location to a usable `Noggin` instance.
   *
   * - If `location` is a non-empty string, open it via the engine and
   *   return it with a `dispose()` that cleans up the transient.
   * - Otherwise return the currently-open noggin with a no-op `dispose()`
   *   (the handle owns its lifecycle).
   *
   * Used by the language-model tools so every verb can target an
   * arbitrary noggin via the optional `noggin` parameter, defaulting
   * to whichever noggin the user has open in VS Code.
   */
  async resolve(location: string | undefined | null): Promise<{ noggin: Noggin; dispose: () => Promise<void> }> {
    const loc = typeof location === 'string' && location.trim() ? location.trim() : null;
    if (!loc) {
      return { noggin: this.requireOpen(), dispose: async () => {} };
    }
    const transient = await openNoggin(loc);
    return {
      noggin: transient,
      dispose: async () => { try { await (transient as any).dispose?.(); } catch { /* ignore */ } },
    };
  }

  /**
   * Copy every item from one noggin into another (whole-noggin,
   * append-only). Either side defaults to the currently-open noggin if
   * the corresponding location is omitted; pass both to copy between
   * two arbitrary noggins without touching the open one.
   */
  async copy(opts: { from?: string; to?: string }): Promise<{ copied: number; mapping: Record<string, string> }> {
    const fromExplicit = typeof opts?.from === 'string' && opts.from.trim() ? opts.from.trim() : null;
    const toExplicit = typeof opts?.to === 'string' && opts.to.trim() ? opts.to.trim() : null;
    if (!fromExplicit && !toExplicit) {
      throw new NogginError('copy: pass at least one of `from` or `to`', { code: 'usage', exitCode: 2 });
    }
    const src = await this.resolve(fromExplicit);
    const dst = (toExplicit && toExplicit === fromExplicit)
      // Same location on both sides — share the noggin instance (avoids
      // taking two file locks against the same physical file).
      ? { noggin: src.noggin, dispose: async () => {} }
      : await this.resolve(toExplicit);
    try {
      return await verbs.copy(src.noggin, dst.noggin, {});
    } finally {
      await dst.dispose();
      await src.dispose();
    }
  }

  /** Throwable helper for the verb wrappers — keeps the type non-null. */
  private requireOpen(): Noggin {
    if (!this.current) throw new NogginError('no noggin is open', { code: 'no-file', exitCode: 2 });
    return this.current;
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
      noggin = await openNoggin(file, { watch: true });
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
