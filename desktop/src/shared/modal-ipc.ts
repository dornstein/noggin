// Shared IPC contract between main and renderer for modal round-trips.
//
// Used by `HostServices` methods that need React UI (showInputBox,
// showQuickPick, showConfirm). Main posts `modal:request`; renderer
// answers with `modal:reply`. This is renderer-internal — it's NOT
// noggin-rpc. The noggin-rpc transport uses a separate channel.
//
// Why a separate channel? noggin-rpc traffic is generic envelopes
// (request/response/notification ids managed by RpcClient/RpcServer).
// Modal traffic is point-to-point UI state. Mixing them would force
// either side to disambiguate envelope shapes; keeping them split is
// simpler and lets the modal layer evolve independently.

/** Kinds of modal the renderer can be asked to render. */
export type ModalKind = 'inputBox' | 'quickPick' | 'confirm';

/** Request envelope (main → renderer). `payload` is the typed
 *  request shape for the matching `HostServices` method. */
export interface ModalRequest {
  readonly id: string;
  readonly kind: ModalKind;
  readonly payload: unknown;
}

/** Reply envelope (renderer → main). On success `response` is the
 *  typed response shape for the matching `HostServices` method.
 *  On error, `kind: 'error'` and a `message`. */
export type ModalReply =
  | { readonly id: string; readonly kind: 'ok'; readonly response: unknown }
  | { readonly id: string; readonly kind: 'error'; readonly message: string };

/** IPC channels. Centralized so main + preload + renderer stay in sync. */
export const MODAL_IPC = {
  request: 'modal:request',  // main → renderer
  reply:   'modal:reply',    // renderer → main
} as const;
