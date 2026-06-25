// createNogginRpcServer — Phase 2 server adapter.
//
// Wires every `RpcProtocol` method to in-process engine + provider +
// `HostServices` calls. One call to `createNogginRpcServer({...})`
// gives you a full noggin-rpc server endpoint over any `Transport`.
//
// Architecture:
//   transport ──┐
//               ├─ RpcServer  ───  this adapter  ───┬─ Noggin (per session)
//   client ─────┘                                   ├─ providers registry
//                                                   └─ HostServices
//
// Per-connection state lives in a `SessionManager`:
//   sessionId  →  { noggin, subscriptions: Map<subId, dispose> }
//
// When the transport disconnects we tear down every open noggin and
// every active subscription. Idempotent dispose.

import type {
  Noggin,
  NogginProviderRegistry,
  NogginDocument,
  ChangeEvent,
  NogginError,
  ItemKey,
} from '@noggin/engine';
import {
  openNoggin as engineOpenNoggin,
  verbs as engineVerbs,
  providers as defaultProviderRegistry,
  SCHEMA_VERSION,
} from '@noggin/engine';

import type {
  NogginCloseRequest,
  NogginCloseResponse,
  NogginOpenRequest,
  NogginOpenResponse,
  NogginShowRequest,
  NogginShowResponse,
  NogginSnapshotRequest,
  NogginSnapshotResponse,
  NogginSubscribeRequest,
  NogginSubscribeResponse,
  NogginUnsubscribeRequest,
  NogginUnsubscribeResponse,
  ProviderDescribeRequest,
  ProviderDescribeResponse,
  ProviderCreateRequest,
  ProviderCreateResponse,
  ProviderListInstancesRequest,
  ProviderListInstancesResponse,
  ProviderListResponse,
  ProviderOpenRequest,
  ProviderOpenResponse,
  SessionId,
  SubscriptionId,
  VerbAddRequest,
  VerbCopyRequest,
  VerbDeleteRequest,
  VerbDoneRequest,
  VerbEditRequest,
  VerbGotoRequest,
  VerbMoveRequest,
  VerbNoteRequest,
  VerbPopRequest,
  VerbPushRequest,
  VerbRequest,
  VerbViewResponse,
} from './protocol.ts';
import type { HostServices } from './host-services.ts';
import { RpcServer, type RpcServerOptions } from './server.ts';
import { NogginRpcError } from './errors.ts';
import type { Transport } from './transport.ts';

/**
 * @public
 * Optional provider-flow extensions. The base engine `Noggin` provider
 * surface is just `{ scheme, open(location, opts) }` — enough to back
 * `noggin.open`. The richer methods `create` / `pickToOpen` /
 * `listInstances` / `describe` are UX flows the host wires per
 * provider; pass them here at server-construction time.
 */
export interface ProviderFlows {
  /** Drive the provider's "Save As…" flow. Resolves to the canonical
   *  location of the newly-created noggin, or null on cancel. */
  create?: (scheme: string, hints?: Record<string, unknown>) => Promise<string | null>;
  /** Drive the provider's "Open…" flow. Resolves to a canonical
   *  location, or null on cancel. */
  pickToOpen?: (scheme: string, hints?: Record<string, unknown>) => Promise<string | null>;
  /** Discoverable instances (recents, catalog, …) keyed by scheme. */
  listInstances?: (scheme: string) => Promise<Array<{ location: string; label?: string; modifiedAt?: string }>>;
  /** Friendly display info per scheme. */
  describe?: (scheme: string) => Promise<{ displayName?: string; description?: string }>;
}

/** @public Options for {@link createNogginRpcServer}. */
export interface CreateNogginRpcServerOptions {
  /** The wire-level transport. The adapter constructs the `RpcServer`
   *  internally; callers don't need to touch it directly. */
  transport: Transport;
  /** Engine provider registry. Default: `providers` from
   *  `@noggin/engine`. Inject a custom one for tests. */
  providerRegistry?: NogginProviderRegistry;
  /** Optional provider-flow overrides (create / open / listInstances /
   *  describe). Without these the corresponding `provider.*` RPC
   *  methods reject with `code: 'not-implemented'`. */
  providerFlows?: ProviderFlows;
  /** `HostServices` implementation. Without it `host.*` RPC methods
   *  reject with `code: 'not-implemented'`. */
  hostServices?: HostServices;
  /** Forwarded to the underlying `RpcServer`. */
  serverOptions?: RpcServerOptions;
}

/**
 * @public
 * Handle returned by `createNogginRpcServer`. Mostly opaque; expose
 * `dispose()` so callers can tear down the server when the transport
 * goes away.
 */
export interface NogginRpcServer {
  /** True until `dispose()` or the transport disconnects. */
  readonly connected: boolean;
  /** Tear down every open session, every subscription, and the
   *  underlying RpcServer / transport. Idempotent. */
  dispose(): Promise<void>;
}

interface SessionEntry {
  readonly noggin: Noggin;
  /** subscriptionId -> dispose handles for both onDidChange and onDidError. */
  readonly subscriptions: Map<SubscriptionId, { dispose: () => void }>;
}

/**
 * @public
 * Build a noggin-rpc server endpoint. Single entry point; everything
 * else in this file is internal plumbing. The returned `NogginRpcServer`
 * is alive as long as the transport is.
 *
 * Example:
 *
 * ```ts
 * import { createMemoryTransportPair } from '@noggin/rpc/transports/memory';
 * import { createNogginRpcServer } from '@noggin/rpc';
 *
 * const { a, b } = createMemoryTransportPair();
 * createNogginRpcServer({ transport: a, hostServices });
 * // Client side: `b` is now an RpcClient-compatible transport speaking
 * // the noggin-rpc protocol.
 * ```
 */
export function createNogginRpcServer(opts: CreateNogginRpcServerOptions): NogginRpcServer {
  const { transport, providerRegistry, providerFlows, hostServices, serverOptions } = opts;

  const registry = providerRegistry ?? defaultProviderRegistry;

  const server = new RpcServer(transport, serverOptions);
  const sessions = new Map<SessionId, SessionEntry>();
  let nextSessionId = 0;
  let nextSubscriptionId = 0;
  let disposed = false;

  // ── noggin.* ──────────────────────────────────────────────────────
  server.on<NogginOpenRequest, NogginOpenResponse>('noggin.open', async ({ location, opts }) => {
    const noggin = await engineOpenNoggin(location, opts);
    const sessionId: SessionId = `sess-${++nextSessionId}`;
    sessions.set(sessionId, { noggin, subscriptions: new Map() });
    return {
      sessionId,
      snapshot: snapshotOf(noggin),
      describe: noggin.describe(),
    };
  });

  server.on<NogginCloseRequest, NogginCloseResponse>('noggin.close', async ({ sessionId }) => {
    const entry = sessions.get(sessionId);
    if (!entry) throw notFound('session', sessionId);
    for (const sub of entry.subscriptions.values()) sub.dispose();
    entry.subscriptions.clear();
    await entry.noggin.dispose();
    sessions.delete(sessionId);
    return { sessionId };
  });

  server.on<NogginSnapshotRequest, NogginSnapshotResponse>('noggin.snapshot', ({ sessionId }) => {
    const entry = requireSession(sessions, sessionId);
    return { snapshot: snapshotOf(entry.noggin) };
  });

  server.on<NogginShowRequest, NogginShowResponse>('noggin.show', async ({ sessionId, opts }) => {
    const entry = requireSession(sessions, sessionId);
    return engineVerbs.show(entry.noggin, opts);
  });

  server.on<NogginSubscribeRequest, NogginSubscribeResponse>('noggin.subscribe', ({ sessionId }) => {
    const entry = requireSession(sessions, sessionId);
    const subscriptionId: SubscriptionId = `sub-${++nextSubscriptionId}`;
    const changeSub = entry.noggin.onDidChange((changes: ChangeEvent) => {
      if (!server.connected) return;
      try {
        server.notify('noggin.changed', {
          subscriptionId,
          sessionId,
          changes,
          // Authoritative state AFTER the changes. The client uses this
          // to rebase any optimistic predictions; the diff alone isn't
          // enough because `updated` entries carry only field-name lists.
          snapshot: snapshotOf(entry.noggin),
        });
      } catch { /* server is dying — swallow */ }
    });
    const errorSub = entry.noggin.onDidError((err: NogginError) => {
      if (!server.connected) return;
      try {
        server.notify('noggin.errored', {
          subscriptionId,
          sessionId,
          code: err.code,
          message: err.message,
          exitCode: err.exitCode,
        });
      } catch { /* swallow */ }
    });
    entry.subscriptions.set(subscriptionId, {
      dispose: () => { changeSub.dispose(); errorSub.dispose(); },
    });
    return { subscriptionId };
  });

  server.on<NogginUnsubscribeRequest, NogginUnsubscribeResponse>('noggin.unsubscribe', ({ subscriptionId }) => {
    // Walk sessions to find the subscription; the protocol doesn't
    // require carrying sessionId for unsubscribe so we look it up.
    for (const entry of sessions.values()) {
      const sub = entry.subscriptions.get(subscriptionId);
      if (sub) {
        sub.dispose();
        entry.subscriptions.delete(subscriptionId);
        return { subscriptionId };
      }
    }
    // Unknown id is a no-op (idempotent). Spec calls for silent ignore.
    return { subscriptionId };
  });

  // ── verb.* ────────────────────────────────────────────────────────
  // Generic verb table. All single-noggin verbs share the same
  // request shape and return a CurrentTreeView (except delete).
  const singleNogginVerbs = ['push', 'add', 'move', 'goto', 'done', 'pop', 'edit', 'note'] as const;
  type VerbName = (typeof singleNogginVerbs)[number];
  type AnyVerbRequest =
    | VerbPushRequest | VerbAddRequest | VerbMoveRequest | VerbGotoRequest
    | VerbDoneRequest | VerbPopRequest | VerbEditRequest | VerbNoteRequest;
  for (const v of singleNogginVerbs) {
    server.on<AnyVerbRequest, VerbViewResponse>(`verb.${v}`, async ({ sessionId, opts }: VerbRequest<unknown>) => {
      const entry = requireSession(sessions, sessionId);
      // Engine signatures vary slightly (some take optional opts, some
      // don't); cast through 'unknown' because the protocol type already
      // pinned the shape.
      const verb = engineVerbs[v as VerbName] as unknown as
        (n: Noggin, o: unknown) => Promise<VerbViewResponse>;
      return verb(entry.noggin, opts);
    });
  }

  server.on<VerbDeleteRequest>('verb.delete', async ({ sessionId, opts }) => {
    const entry = requireSession(sessions, sessionId);
    return engineVerbs.delete(entry.noggin, opts);
  });

  server.on<VerbCopyRequest>('verb.copy', async ({ sourceSessionId, destSessionId, opts }) => {
    const source = requireSession(sessions, sourceSessionId);
    const dest = requireSession(sessions, destSessionId);
    return engineVerbs.copy(source.noggin, dest.noggin, opts);
  });

  // ── host.* ────────────────────────────────────────────────────────
  for (const m of [
    'pickFile', 'pickNewFile', 'showInputBox', 'showQuickPick',
    'showConfirm', 'showError', 'openExternal',
  ] as const) {
    server.on(`host.${m}`, async (params) => {
      if (!hostServices) throw notImplemented(`host.${m}`);
      // The host method names are 1:1 with the protocol method tails.
      const fn = (hostServices as unknown as Record<string, (p: unknown) => Promise<unknown>>)[m];
      return fn.call(hostServices, params);
    });
  }

  // ── provider.* ────────────────────────────────────────────────────
  server.on<unknown, ProviderListResponse>('provider.list', () => {
    const list = registry.list();
    return {
      providers: list.map((p) => ({ scheme: p.scheme, default: p.default })),
    };
  });

  server.on<ProviderDescribeRequest, ProviderDescribeResponse>('provider.describe', async ({ scheme }) => {
    const entry = registry.get(scheme);
    if (!entry) throw new NogginRpcError('no-provider', `no provider registered for scheme '${scheme}'`);
    const list = registry.list();
    const isDefault = list.find((p) => p.scheme === scheme)?.default ?? false;
    const extra = (await providerFlows?.describe?.(scheme)) ?? {};
    return { scheme, default: isDefault, ...extra };
  });

  server.on<ProviderCreateRequest, ProviderCreateResponse>('provider.create', async ({ scheme, hints }) => {
    if (!providerFlows?.create) throw notImplemented('provider.create');
    const location = await providerFlows.create(scheme, hints);
    return { location };
  });

  server.on<ProviderOpenRequest, ProviderOpenResponse>('provider.open', async ({ scheme, hints }) => {
    if (!providerFlows?.pickToOpen) throw notImplemented('provider.open');
    const location = await providerFlows.pickToOpen(scheme, hints);
    return { location };
  });

  server.on<ProviderListInstancesRequest, ProviderListInstancesResponse>('provider.listInstances', async ({ scheme }) => {
    if (!providerFlows?.listInstances) throw notImplemented('provider.listInstances');
    const instances = await providerFlows.listInstances(scheme);
    return { instances };
  });

  // ── Teardown ──────────────────────────────────────────────────────
  const disconnectSub = server.onDisconnect(async () => {
    await dispose();
  });

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    disconnectSub.dispose();
    // Tear down every session's subscriptions + dispose its noggin.
    for (const entry of sessions.values()) {
      for (const sub of entry.subscriptions.values()) sub.dispose();
      entry.subscriptions.clear();
      try { await entry.noggin.dispose(); } catch { /* swallow */ }
    }
    sessions.clear();
    server.dispose();
  }

  return {
    get connected() { return !disposed && server.connected; },
    dispose,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

function snapshotOf(noggin: Noggin): NogginDocument {
  // The engine doesn't expose the raw doc as a public accessor; build
  // one from the accessors we do have. The shape matches NogginDocument
  // verbatim — schemaVersion (engine const), active key, items array.
  const activeKey: ItemKey | null = noggin.active?.key ?? null;
  return {
    schemaVersion: SCHEMA_VERSION,
    active: activeKey,
    // Deep-cloned items: the engine's accessor returns frozen objects
    // we don't want crossing the wire as references.
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

function requireSession(sessions: Map<SessionId, SessionEntry>, sessionId: SessionId): SessionEntry {
  const entry = sessions.get(sessionId);
  if (!entry) throw notFound('session', sessionId);
  return entry;
}

function notFound(kind: 'session' | 'subscription', id: string): NogginRpcError {
  return new NogginRpcError(`no-${kind}`, `unknown ${kind}: ${id}`);
}

function notImplemented(method: string): NogginRpcError {
  return new NogginRpcError(
    'not-implemented',
    `${method} is not implemented by this server (no providerFlows or hostServices supplied)`,
  );
}
