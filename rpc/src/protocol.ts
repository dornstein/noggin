// The noggin-rpc protocol surface, defined as TypeScript types only.
//
// Every method the framework speaks is listed here as a key in
// `RpcProtocol`. Each entry pairs a `request` shape (what the client
// sends) with a `response` shape (what the server returns). Streaming
// events use the `notifications` map: server-pushed messages keyed by
// notification method name with their `params` shape.
//
// This file is the contract. Anyone building a noggin-rpc client or
// server in another language can implement it against the printed
// docs at `docs/site/noggin-rpc.html` (generated from the TSDoc here).
//
// Phase 1 ships these as types only. Phase 2 (`@noggin/rpc-server`)
// wires every method to the actual engine + provider + host services.
//
// ── Method families ──
//
//   noggin.*   lifecycle (open/close, snapshot/show, subscribe)
//   verb.*     mutating verbs (push, add, move, …) and `copy`
//   host.*     host-services that the server invokes on behalf of the UI
//              (file pickers, input boxes, quick picks, …)
//   provider.* provider registry introspection / instance management
//
// Plus two server-to-client notification methods that flow inside an
// active `noggin.subscribe`:
//
//   noggin.changed   ItemChange[] for the subscribed noggin
//   noggin.errored   NogginError envelope for the subscribed noggin

import type {
  AddOptions,
  ChangeEvent,
  CopyOptions,
  CopyResult,
  CurrentTreeView,
  DeleteOptions,
  DeleteResult,
  DoneOptions,
  EditOptions,
  GotoOptions,
  Item,
  ItemKey,
  ItemPath,
  MoveOptions,
  NogginDocument,
  NogginErrorCode,
  NoteOptions,
  PopOptions,
  PushOptions,
  ShowOptions,
} from '@noggin/engine';

/** @public Opaque per-connection identifier for an open noggin. */
export type SessionId = string;

/** @public Opaque identifier for an active event subscription. */
export type SubscriptionId = string;

// ── noggin.* ────────────────────────────────────────────────────────────────

/** @public Request for {@link RpcProtocol['noggin.open']}. */
export interface NogginOpenRequest {
  /** Canonical location string the user/agent supplied (e.g.
   *  `~/.noggin.yaml`, `file:///abs/path.yaml`, `memory://x`). */
  readonly location: string;
  /** Forwarded to the provider's `open(location, opts)`. */
  readonly opts?: Record<string, unknown>;
}

/** @public Response for {@link RpcProtocol['noggin.open']}. */
export interface NogginOpenResponse {
  /** Per-connection handle the client uses to address the noggin in
   *  subsequent verb / read / subscribe calls. */
  readonly sessionId: SessionId;
  /** Full document snapshot at open time. Subsequent changes flow as
   *  `noggin.changed` notifications. */
  readonly snapshot: NogginDocument;
  /** Canonical URI the server-side provider resolved. Mirrors
   *  `Noggin.location` on the server; the client surfaces it through
   *  the `RemoteNoggin.location` accessor. */
  readonly location: string;
  /** Round-trippable description of where the noggin lives (mirrors
   *  `Noggin.describe()`). */
  readonly describe: string;
  /** Whether the server-side provider declared this noggin read-only.
   *  Every `verb.*` call on a read-only noggin rejects with
   *  `code: 'read-only'`; UI code reads this to gate mutation
   *  affordances preemptively. */
  readonly readOnly: boolean;
}

/** @public Request for {@link RpcProtocol['noggin.close']}. */
export interface NogginCloseRequest {
  readonly sessionId: SessionId;
}

/** @public Response for {@link RpcProtocol['noggin.close']}. */
export interface NogginCloseResponse {
  /** Echo the closed session id for confirmation. */
  readonly sessionId: SessionId;
}

/** @public Request for {@link RpcProtocol['noggin.snapshot']}. */
export interface NogginSnapshotRequest {
  readonly sessionId: SessionId;
}

/** @public Response for {@link RpcProtocol['noggin.snapshot']}. */
export interface NogginSnapshotResponse {
  readonly snapshot: NogginDocument;
}

/** @public Request for {@link RpcProtocol['noggin.show']}. */
export interface NogginShowRequest {
  readonly sessionId: SessionId;
  readonly opts?: ShowOptions;
}

/** @public Response for {@link RpcProtocol['noggin.show']}. */
export type NogginShowResponse = CurrentTreeView | null;

/** @public Request for {@link RpcProtocol['noggin.subscribe']}. */
export interface NogginSubscribeRequest {
  readonly sessionId: SessionId;
}

/** @public Response for {@link RpcProtocol['noggin.subscribe']}. */
export interface NogginSubscribeResponse {
  /** Opaque token; every `noggin.changed` / `noggin.errored` notification
   *  for this subscription carries the same id. Pass to
   *  `noggin.unsubscribe` to stop receiving events. */
  readonly subscriptionId: SubscriptionId;
}

/** @public Request for {@link RpcProtocol['noggin.unsubscribe']}. */
export interface NogginUnsubscribeRequest {
  readonly subscriptionId: SubscriptionId;
}

/** @public Response for {@link RpcProtocol['noggin.unsubscribe']}. */
export interface NogginUnsubscribeResponse {
  /** Echo the cancelled subscription id. */
  readonly subscriptionId: SubscriptionId;
}

/** @public Payload of a `noggin.changed` notification. */
export interface NogginChangedNotification {
  readonly subscriptionId: SubscriptionId;
  readonly sessionId: SessionId;
  /** Items that shifted between the previous and current snapshot;
   *  same vocabulary as the engine's in-process `onDidChange`. */
  readonly changes: ChangeEvent;
  /**
   * Authoritative document snapshot AFTER `changes` were applied.
   *
   * Servers SHOULD include this; clients SHOULD use it as the source
   * of truth and rebase any in-flight optimistic predictions on top.
   * Without a snapshot the client would have to issue a follow-up
   * `noggin.snapshot` request after every notification just to know
   * the current title / done state of an `updated` item (the
   * `ItemChange` shape carries only field-name lists, not values).
   *
   * The field is optional only so a future bandwidth-constrained
   * transport (a WebSocket-backed web host, etc.) can negotiate diffs-
   * only delivery. The reference server adapter always sends a
   * snapshot.
   */
  readonly snapshot?: NogginDocument;
}

/** @public Payload of a `noggin.errored` notification. */
export interface NogginErroredNotification {
  readonly subscriptionId: SubscriptionId;
  readonly sessionId: SessionId;
  /** Stable engine error code (e.g. `'no-active-item'`). */
  readonly code: NogginErrorCode | string;
  readonly message: string;
  readonly exitCode?: number;
}

// ── verb.* ──────────────────────────────────────────────────────────────────
//
// Every verb takes a sessionId + the engine's existing opts type and
// returns the same shape the engine returns in-process. The server
// streams the resulting state change to subscribed clients as a
// `noggin.changed` notification BEFORE returning the response — so a
// client that subscribed before issuing a verb sees its own write
// land in the snapshot first, then the verb resolves.

/** @public Shared shape for every `verb.X` request. */
export interface VerbRequest<O> {
  readonly sessionId: SessionId;
  readonly opts: O;
}

/** @public Request for {@link RpcProtocol['verb.push']}. */
export type VerbPushRequest = VerbRequest<PushOptions>;
/** @public Request for {@link RpcProtocol['verb.add']}. */
export type VerbAddRequest = VerbRequest<AddOptions>;
/** @public Request for {@link RpcProtocol['verb.move']}. */
export type VerbMoveRequest = VerbRequest<MoveOptions>;
/** @public Request for {@link RpcProtocol['verb.goto']}. */
export type VerbGotoRequest = VerbRequest<GotoOptions>;
/** @public Request for {@link RpcProtocol['verb.done']}. */
export type VerbDoneRequest = VerbRequest<DoneOptions | undefined>;
/** @public Request for {@link RpcProtocol['verb.pop']}. */
export type VerbPopRequest = VerbRequest<PopOptions | undefined>;
/** @public Request for {@link RpcProtocol['verb.edit']}. */
export type VerbEditRequest = VerbRequest<EditOptions>;
/** @public Request for {@link RpcProtocol['verb.note']}. */
export type VerbNoteRequest = VerbRequest<NoteOptions>;
/** @public Request for {@link RpcProtocol['verb.delete']}. */
export type VerbDeleteRequest = VerbRequest<DeleteOptions>;

/** @public Verb request shape that returns a tree view. */
export type VerbViewResponse = CurrentTreeView;

/**
 * @public Request for {@link RpcProtocol['verb.copy']}. Two-noggin
 * verb: source and dest each live in their own session.
 */
export interface VerbCopyRequest {
  readonly sourceSessionId: SessionId;
  readonly destSessionId: SessionId;
  readonly opts?: CopyOptions;
}

// ── host.* ──────────────────────────────────────────────────────────────────
//
// `host.*` calls flow client -> server even though they're "host"
// services: the UI lives in the client process; the host runtime
// (Electron main, VS Code extension host) lives in the server process.
// The server's `HostServices` implementation does the OS-level work
// (file pickers, etc.) and returns the result over the wire.

/** @public Generic file-picker filter. */
export interface FileFilter {
  readonly name: string;
  readonly extensions: readonly string[];
}

/** @public Request for {@link RpcProtocol['host.pickFile']}. */
export interface HostPickFileRequest {
  readonly title?: string;
  readonly defaultPath?: string;
  readonly filters?: readonly FileFilter[];
  /** When true, allow selecting multiple files. Default false. */
  readonly multiple?: boolean;
}

/** @public Response for {@link RpcProtocol['host.pickFile']}. */
export interface HostPickFileResponse {
  /** Empty array if the user cancelled. */
  readonly paths: readonly string[];
}

/** @public Request for {@link RpcProtocol['host.pickNewFile']}. */
export interface HostPickNewFileRequest {
  readonly title?: string;
  readonly defaultPath?: string;
  readonly filters?: readonly FileFilter[];
}

/** @public Response for {@link RpcProtocol['host.pickNewFile']}. */
export interface HostPickNewFileResponse {
  /** null if the user cancelled. */
  readonly path: string | null;
}

/** @public Request for {@link RpcProtocol['host.showInputBox']}. */
export interface HostShowInputBoxRequest {
  readonly title?: string;
  readonly prompt?: string;
  readonly placeholder?: string;
  readonly value?: string;
  readonly password?: boolean;
}

/** @public Response for {@link RpcProtocol['host.showInputBox']}. */
export interface HostShowInputBoxResponse {
  /** null if the user cancelled. */
  readonly value: string | null;
}

/** @public A pickable item for `host.showQuickPick`. */
export interface QuickPickItem {
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
  /** Arbitrary value the caller wants echoed back on selection. */
  readonly value?: unknown;
}

/** @public Request for {@link RpcProtocol['host.showQuickPick']}. */
export interface HostShowQuickPickRequest {
  readonly title?: string;
  readonly placeholder?: string;
  readonly items: readonly QuickPickItem[];
}

/** @public Response for {@link RpcProtocol['host.showQuickPick']}. */
export interface HostShowQuickPickResponse {
  /** null if the user cancelled; otherwise the selected item. */
  readonly selected: QuickPickItem | null;
}

/** @public Request for {@link RpcProtocol['host.showConfirm']}. */
export interface HostShowConfirmRequest {
  readonly title?: string;
  readonly message: string;
  /** Label for the affirmative button. Default 'OK'. */
  readonly confirmLabel?: string;
  /** Label for the cancel button. Default 'Cancel'. */
  readonly cancelLabel?: string;
}

/** @public Response for {@link RpcProtocol['host.showConfirm']}. */
export interface HostShowConfirmResponse {
  /** True if the user picked confirm, false if cancel or dismissed. */
  readonly confirmed: boolean;
}

/** @public Request for {@link RpcProtocol['host.showError']}. */
export interface HostShowErrorRequest {
  readonly message: string;
  /** Optional secondary detail (e.g. a stack or hint). */
  readonly detail?: string;
}

/** @public Response for {@link RpcProtocol['host.showError']}. */
export interface HostShowErrorResponse {
  /** Always true; included so the wire shape stays uniform. */
  readonly acknowledged: true;
}

/** @public Request for {@link RpcProtocol['host.openExternal']}. */
export interface HostOpenExternalRequest {
  /** URL or file:// path to open in the OS default handler. */
  readonly target: string;
}

/** @public Response for {@link RpcProtocol['host.openExternal']}. */
export interface HostOpenExternalResponse {
  readonly opened: boolean;
}

// ── provider.* ──────────────────────────────────────────────────────────────

/** @public Request for {@link RpcProtocol['provider.list']}. */
export interface ProviderListRequest {}

/** @public Information about a registered provider. */
export interface ProviderDescriptor {
  readonly scheme: string;
  /** Human-readable label for UIs. Optional; defaults to `scheme`. */
  readonly displayName?: string;
}

/** @public Response for {@link RpcProtocol['provider.list']}. */
export interface ProviderListResponse {
  readonly providers: readonly ProviderDescriptor[];
}

/**
 * @public Request for {@link RpcProtocol['provider.create']}.
 *
 * "Create" is the provider's user-facing flow for producing a new
 * noggin instance — typically a "Save As…" dialog that returns a
 * location string. The server's `HostServices` are the building
 * blocks the provider uses to drive the flow.
 */
export interface ProviderCreateRequest {
  readonly scheme: string;
  /** Provider-specific hints. */
  readonly hints?: Record<string, unknown>;
}

/** @public Response for {@link RpcProtocol['provider.create']}. */
export interface ProviderCreateResponse {
  /** Canonical location of the newly-created noggin, or null if the
   *  user cancelled the create flow. */
  readonly location: string | null;
}

/**
 * @public Request for {@link RpcProtocol['provider.open']}.
 *
 * "Open" is the provider's user-facing flow for picking an existing
 * noggin location (e.g. an Open dialog).
 */
export interface ProviderOpenRequest {
  readonly scheme: string;
  readonly hints?: Record<string, unknown>;
}

/** @public Response for {@link RpcProtocol['provider.open']}. */
export interface ProviderOpenResponse {
  /** Canonical location, or null if the user cancelled. */
  readonly location: string | null;
}

/**
 * @public Request for {@link RpcProtocol['provider.listInstances']}.
 *
 * For providers that have a notion of a discoverable catalog
 * (recently-opened files, known cloud noggins, etc.) — the server
 * asks the provider for its list.
 */
export interface ProviderListInstancesRequest {
  readonly scheme: string;
}

/** @public One known noggin instance discoverable through a provider. */
export interface ProviderInstance {
  /** Canonical location (suitable for `noggin.open`). */
  readonly location: string;
  /** Display label. Defaults to a provider-specific format of `location`. */
  readonly label?: string;
  /** Optional last-opened / last-modified timestamp (ISO 8601). */
  readonly modifiedAt?: string;
}

/** @public Response for {@link RpcProtocol['provider.listInstances']}. */
export interface ProviderListInstancesResponse {
  readonly instances: readonly ProviderInstance[];
}

/** @public Request for {@link RpcProtocol['provider.describe']}. */
export interface ProviderDescribeRequest {
  readonly scheme: string;
}

/** @public Response for {@link RpcProtocol['provider.describe']}. */
export interface ProviderDescribeResponse {
  readonly scheme: string;
  readonly displayName?: string;
  /** Markdown blurb describing what the provider stores and where. */
  readonly description?: string;
}

// ── The protocol surface ───────────────────────────────────────────────────

/**
 * @public
 * The noggin-rpc method table. Every method is `{ request, response }`.
 *
 * Use as the type argument for `request<M>(method, params)` calls; an
 * untyped generic `RpcClient` can still talk noggin-rpc, but a typed
 * client (`NogginRpcClient`, Phase 2) wraps `RpcClient.request` with
 * the keyof / indexed-access pattern shown below.
 */
export interface RpcProtocol {
  // ── noggin.* ──
  'noggin.open':         { request: NogginOpenRequest;          response: NogginOpenResponse };
  'noggin.close':        { request: NogginCloseRequest;         response: NogginCloseResponse };
  'noggin.snapshot':     { request: NogginSnapshotRequest;      response: NogginSnapshotResponse };
  'noggin.show':         { request: NogginShowRequest;          response: NogginShowResponse };
  'noggin.subscribe':    { request: NogginSubscribeRequest;     response: NogginSubscribeResponse };
  'noggin.unsubscribe':  { request: NogginUnsubscribeRequest;   response: NogginUnsubscribeResponse };

  // ── verb.* ──
  'verb.push':           { request: VerbPushRequest;            response: VerbViewResponse };
  'verb.add':            { request: VerbAddRequest;             response: VerbViewResponse };
  'verb.move':           { request: VerbMoveRequest;            response: VerbViewResponse };
  'verb.goto':           { request: VerbGotoRequest;            response: VerbViewResponse };
  'verb.done':           { request: VerbDoneRequest;            response: VerbViewResponse };
  'verb.pop':            { request: VerbPopRequest;             response: VerbViewResponse };
  'verb.edit':           { request: VerbEditRequest;            response: VerbViewResponse };
  'verb.note':           { request: VerbNoteRequest;            response: VerbViewResponse };
  'verb.delete':         { request: VerbDeleteRequest;          response: DeleteResult };
  'verb.copy':           { request: VerbCopyRequest;            response: CopyResult };

  // ── host.* ──
  'host.pickFile':       { request: HostPickFileRequest;        response: HostPickFileResponse };
  'host.pickNewFile':    { request: HostPickNewFileRequest;     response: HostPickNewFileResponse };
  'host.showInputBox':   { request: HostShowInputBoxRequest;    response: HostShowInputBoxResponse };
  'host.showQuickPick':  { request: HostShowQuickPickRequest;   response: HostShowQuickPickResponse };
  'host.showConfirm':    { request: HostShowConfirmRequest;     response: HostShowConfirmResponse };
  'host.showError':      { request: HostShowErrorRequest;       response: HostShowErrorResponse };
  'host.openExternal':   { request: HostOpenExternalRequest;    response: HostOpenExternalResponse };

  // ── provider.* ──
  'provider.list':           { request: ProviderListRequest;          response: ProviderListResponse };
  'provider.create':         { request: ProviderCreateRequest;        response: ProviderCreateResponse };
  'provider.open':           { request: ProviderOpenRequest;          response: ProviderOpenResponse };
  'provider.listInstances':  { request: ProviderListInstancesRequest; response: ProviderListInstancesResponse };
  'provider.describe':       { request: ProviderDescribeRequest;      response: ProviderDescribeResponse };
}

/** @public Notification methods (server → client only). */
export interface RpcNotifications {
  'noggin.changed':  NogginChangedNotification;
  'noggin.errored':  NogginErroredNotification;
}

/** @public Helper: the union of all method names. */
export type RpcMethod = keyof RpcProtocol;

/** @public Helper: request shape for a given method. */
export type RpcRequestOf<M extends RpcMethod> = RpcProtocol[M]['request'];

/** @public Helper: response shape for a given method. */
export type RpcResponseOf<M extends RpcMethod> = RpcProtocol[M]['response'];

/** @public Helper: the union of all notification method names. */
export type RpcNotificationMethod = keyof RpcNotifications;

/** @public Helper: payload shape for a given notification method. */
export type RpcNotificationOf<M extends RpcNotificationMethod> = RpcNotifications[M];

// Re-export the small set of engine types every protocol implementation
// will want, so consumers can `import { Item, ChangeEvent } from
// '@noggin/rpc'` and don't have to depend on `@noggin/engine` directly
// just for types.
export type {
  Item,
  ItemKey,
  ItemPath,
  ChangeEvent,
  CurrentTreeView,
  DeleteResult,
  CopyResult,
  CopyOptions,
  NogginDocument,
  NogginErrorCode,
};
