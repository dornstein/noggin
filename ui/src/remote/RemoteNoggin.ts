// RemoteNoggin — the UI-side noggin adapter.
//
// Wraps an `RpcClient` so the UI can drive verbs on a remote noggin
// with the same shape as an in-process one. Two pillars:
//
//   1. Verb dispatch       → calls send `verb.X` RPC requests.
//                           Replies (CurrentTreeView / DeleteResult)
//                           are returned to the caller.
//
//   2. Optimistic apply    → every verb is also run locally against a
//                           held memory noggin BEFORE the RPC fires.
//                           The cached snapshot updates immediately
//                           and `onDidChange` fires; the UI re-renders
//                           with no round-trip latency. When the
//                           server's authoritative `noggin.changed`
//                           notification lands, the local memory
//                           noggin is re-seeded from the server's
//                           snapshot and any pending ops are replayed
//                           on top. Errors roll the prediction back.
//
// The optimistic engine is the real engine — we use a memory noggin
// from `@noggin/engine` so predictions are guaranteed equivalent to
// what the server would compute. No separate "prediction" code path.
//
// Lifecycle:
//
//   const rn = await openRemoteNoggin({ client, location });
//   //  ↑ sends noggin.open + noggin.subscribe under the hood
//
//   rn.onDidChange((changes) => /* re-render */);
//   await rn.push({ title: 'x' });
//
//   await rn.dispose();
//   //  ↑ sends noggin.unsubscribe + noggin.close
//
// Phase 3 ships the adapter + golden tests. Phases 4 / 5 swap the
// desktop renderer and the VS Code webview onto it.

import type {
  ChangeEvent,
  Noggin as EngineNoggin,
  NogginDocument,
  Item,
  ItemKey,
} from '../../skills/noggin/noggin-api.mjs';
import {
  diffDocuments,
  NogginError,
  verbs as engineVerbs,
} from '../../skills/noggin/noggin-api.mjs';
import { openMemoryNoggin } from '../../skills/noggin/providers/memory.mjs';

import type { RpcClient } from '@noggin/rpc';
import { NogginRpcError } from '@noggin/rpc';
import type {
  NogginChangedNotification,
  NogginErroredNotification,
  SessionId,
  SubscriptionId,
} from '@noggin/rpc';

import type { NogginVerbs } from './verbs.ts';

/**
 * @public
 * Listener subscription handle. Mirrors the engine's `Disposable`.
 */
export interface RemoteDisposable {
  dispose(): void;
}

/** @public Read-only accessor + event surface the UI needs. */
export interface NogginReadable {
  readonly items: readonly Item[];
  readonly active: Item | null;
  describe(): string;
  onDidChange(handler: (changes: ChangeEvent) => void): RemoteDisposable;
  onDidError(handler: (error: NogginError) => void): RemoteDisposable;
}

/**
 * @public
 * UI-facing noggin client: verbs + reads + events + lifecycle.
 * Implemented by `RemoteNoggin`; anything that wants to consume a
 * noggin via the UI should depend on this shape, not the engine's
 * in-process `Noggin`.
 */
export interface NogginClient extends NogginVerbs, NogginReadable {
  dispose(): Promise<void>;
}

/** Internal record of an op the client predicted but hasn't yet seen confirmed. */
interface PendingOp {
  readonly id: number;
  readonly verb: keyof NogginVerbs;
  readonly opts: unknown;
}

/**
 * @public
 * Options for {@link RemoteNoggin}. Most callers should use
 * {@link openRemoteNoggin} instead, which handles `noggin.open` +
 * `noggin.subscribe` for you.
 */
export interface RemoteNogginOptions {
  client: RpcClient;
  sessionId: SessionId;
  subscriptionId: SubscriptionId;
  /** Initial document; usually the snapshot returned by `noggin.open`. */
  initialSnapshot: NogginDocument;
  /** Human-readable label (mirrors the engine's `describe()`). Optional;
   *  falls back to the location used to open the noggin. */
  describe?: string;
}

/**
 * @public
 * UI-side adapter for a noggin running behind a noggin-rpc server.
 * Implements the verb surface + accessors + events the UI consumes.
 * Predictions are applied locally so gestures feel sync; the server's
 * authoritative state is reconciled in via `noggin.changed`.
 */
export class RemoteNoggin implements NogginClient {
  private readonly client: RpcClient;
  private readonly sessionId: SessionId;
  private readonly subscriptionId: SubscriptionId;
  private readonly describeLabel: string;

  /** Last document we know the server agrees with. */
  private confirmed: NogginDocument;

  /** Live memory noggin holding `confirmed` + replayed pending ops.
   *  All read accessors and prediction routes through this. */
  private local!: EngineNoggin;

  /** Verbs sent but not yet confirmed by the server. Replayed on top
   *  of `confirmed` whenever an external change forces a rebase. */
  private readonly pending: PendingOp[] = [];

  /** Monotonic op id; used to identify pending ops uniquely. */
  private nextOpId = 0;

  /** Serialises every state mutation (predict, rebuild) so concurrent
   *  verbs and incoming notifications don't trample each other's
   *  view of `this.local`. */
  private opQueue: Promise<unknown> = Promise.resolve();

  private readonly changeListeners = new Set<(changes: ChangeEvent) => void>();
  private readonly errorListeners = new Set<(error: NogginError) => void>();

  private readonly subscriptions: RemoteDisposable[] = [];
  private disposed = false;

  /** Construct directly only if you've already issued noggin.open +
   *  noggin.subscribe yourself. Most callers want {@link openRemoteNoggin}. */
  constructor(opts: RemoteNogginOptions) {
    this.client = opts.client;
    this.sessionId = opts.sessionId;
    this.subscriptionId = opts.subscriptionId;
    this.describeLabel = opts.describe ?? '(remote noggin)';
    this.confirmed = opts.initialSnapshot;

    // Listen for change/error notifications.
    this.subscriptions.push(this.client.onNotification((method, params) => {
      if (this.disposed) return;
      if (method === 'noggin.changed') this.handleChanged(params as NogginChangedNotification);
      else if (method === 'noggin.errored') this.handleErrored(params as NogginErroredNotification);
    }));
  }

  /** @internal Lazy local-noggin construction so callers can `await` once. */
  async _initLocal(): Promise<void> {
    this.local = await openMemoryNoggin({
      label: this.describeLabel,
      initialDocument: this.confirmed,
    });
  }

  // ── NogginReadable ─────────────────────────────────────────────────

  get items(): readonly Item[] { return this.local.items; }
  get active(): Item | null { return this.local.active; }
  describe(): string { return this.describeLabel; }

  onDidChange(handler: (changes: ChangeEvent) => void): RemoteDisposable {
    this.changeListeners.add(handler);
    return { dispose: () => { this.changeListeners.delete(handler); } };
  }

  onDidError(handler: (error: NogginError) => void): RemoteDisposable {
    this.errorListeners.add(handler);
    return { dispose: () => { this.errorListeners.delete(handler); } };
  }

  // ── NogginVerbs ────────────────────────────────────────────────────

  push       = this.makeVerb('push');
  add        = this.makeVerb('add');
  move       = this.makeVerb('move');
  goto       = this.makeVerb('goto');
  done       = this.makeVerb('done');
  pop        = this.makeVerb('pop');
  edit       = this.makeVerb('edit');
  note       = this.makeVerb('note');
  delete     = this.makeVerb('delete') as NogginVerbs['delete'];

  private makeVerb<V extends keyof NogginVerbs>(verb: V): NogginVerbs[V] {
    const dispatch = async (opts: unknown): Promise<unknown> => {
      if (this.disposed) throw new NogginRpcError('rpc.disposed', 'RemoteNoggin is disposed');

      const opId = ++this.nextOpId;

      // 1. Predict locally. Serialised through opQueue so a notification
      //    arriving mid-flight can't race with us mutating local. The
      //    predict step both mutates `local` and registers the op as
      //    pending, in one atomic block.
      await this.enqueue(async () => {
        const before = snapshotOf(this.local);
        await (engineVerbs[verb] as unknown as (n: EngineNoggin, o: unknown) => Promise<unknown>)(this.local, opts);
        this.pending.push({ id: opId, verb, opts });
        const after = snapshotOf(this.local);
        this.fireChanges(diffDocuments(before, after));
      });

      // 2. Send the RPC. The server fires a noggin.changed notification
      //    BEFORE resolving the response (server-adapter guarantee), so
      //    by the time this await resolves, our notification handler
      //    has already consumed the pending op from the FIFO queue.
      try {
        return await this.dispatchRpc(verb, opts);
      } catch (err) {
        // Server rejected. If the op is still in pending, remove it
        // and rebuild local. (If the notification already consumed it,
        // that means the engine fired onDidChange before failing — odd
        // but possible; either way we want a fresh local state.)
        await this.enqueue(async () => {
          this.removePending(opId);
          await this.rebuildLocal();
        });
        throw err;
      }
    };
    return dispatch as NogginVerbs[V];
  }

  private dispatchRpc(verb: keyof NogginVerbs, opts: unknown): Promise<unknown> {
    return this.client.request(`verb.${verb}`, { sessionId: this.sessionId, opts });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const sub of this.subscriptions.splice(0)) sub.dispose();
    this.changeListeners.clear();
    this.errorListeners.clear();
    // Best-effort server-side cleanup. If the transport is already
    // gone these will reject; swallow.
    try { await this.client.request('noggin.unsubscribe', { subscriptionId: this.subscriptionId }); } catch { /* swallow */ }
    try { await this.client.request('noggin.close', { sessionId: this.sessionId }); } catch { /* swallow */ }
    try { await this.local.dispose(); } catch { /* swallow */ }
  }

  // ── Internals ──────────────────────────────────────────────────────

  /** Serialise an async action behind any previously-queued action. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.opQueue.then(() => fn());
    // Swallow errors on the queue's tail; the caller's `await` still
    // sees them via `next`.
    this.opQueue = next.catch(() => {});
    return next;
  }

  /** Remove an op from `pending` by id. Returns true if it was there. */
  private removePending(opId: number): boolean {
    const idx = this.pending.findIndex((p) => p.id === opId);
    if (idx < 0) return false;
    this.pending.splice(idx, 1);
    return true;
  }

  /** Reset `local` to `confirmed` then replay every still-pending op.
   *  Called inside `enqueue` blocks so concurrent dispatches don't
   *  see a half-rebuilt state. */
  private async rebuildLocal(): Promise<void> {
    const before = snapshotOf(this.local);
    try { await this.local.dispose(); } catch { /* swallow */ }
    this.local = await openMemoryNoggin({
      label: this.describeLabel,
      initialDocument: this.confirmed,
    });
    for (const op of this.pending) {
      try {
        await (engineVerbs[op.verb] as unknown as (n: EngineNoggin, o: unknown) => Promise<unknown>)(this.local, op.opts);
      } catch {
        // A pending op failed to replay (e.g. the external change
        // already invalidated its precondition). Skip; the server's
        // upcoming response for that op will likely reject too.
      }
    }
    const after = snapshotOf(this.local);
    const changes = diffDocuments(before, after);
    if (changes.length > 0) this.fireChanges(changes);
  }

  private handleChanged(notification: NogginChangedNotification): void {
    if (notification.subscriptionId !== this.subscriptionId) return;
    if (!notification.snapshot) {
      // Bandwidth-optimised transports that send diffs only aren't
      // supported in Phase 3. The reference server adapter always
      // includes a snapshot.
      return;
    }
    const snapshot = notification.snapshot;
    void this.enqueue(async () => {
      this.confirmed = snapshot;
      // FIFO: notifications arrive in the order their causing verbs
      // were processed server-side. Pre-consume the front pending op
      // so the rebuild doesn't double-apply it. If there are no
      // pending ops, the notification represents an external change
      // (or our own no-op verb whose response is still in flight) and
      // we just rebase.
      if (this.pending.length > 0) {
        this.pending.shift();
      }
      await this.rebuildLocal();
    });
  }

  private handleErrored(notification: NogginErroredNotification): void {
    if (notification.subscriptionId !== this.subscriptionId) return;
    const err = new NogginError(notification.message, {
      code: notification.code,
      exitCode: notification.exitCode,
    });
    for (const h of [...this.errorListeners]) {
      try { h(err); } catch { /* swallow */ }
    }
  }

  private fireChanges(changes: ChangeEvent): void {
    if (changes.length === 0) return;
    for (const h of [...this.changeListeners]) {
      try { h(changes); } catch { /* swallow */ }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Capture a memory noggin's current document as a plain NogginDocument.
 * Used to diff before/after snapshots inside the optimistic layer.
 */
function snapshotOf(noggin: EngineNoggin): NogginDocument {
  const SCHEMA_VERSION = 1;
  const activeKey: ItemKey | null = noggin.active?.key ?? null;
  return {
    schemaVersion: SCHEMA_VERSION,
    active: activeKey,
    items: noggin.items.map((it) => ({
      key: it.key,
      parentKey: it.parentKey,
      title: it.title,
      done: it.done,
      createdAt: it.createdAt,
      notes: (it.notes ?? []).map((n) => ({ timestamp: n.timestamp, text: n.text })),
    })),
  };
}
