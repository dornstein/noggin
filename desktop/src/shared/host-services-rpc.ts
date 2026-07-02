// Shared IPC contract for the desktop HostServices split implementation.
//
// Some `HostServices` methods can't be fulfilled by the main process
// alone (today: showInputBox / showQuickPick / showConfirm, which need
// React to render). Desktop answers those with a SECOND HostServices
// implementation living in the renderer (`HostServicesReactImpl`).
// Main is the CLIENT on this arc; the renderer is the SERVER. Main
// posts a request; the renderer answers with a reply.
//
// This is a distinct channel from noggin-rpc, which runs the OPPOSITE
// direction (renderer client → main server, for verbs). Keeping the
// two arcs split lets each evolve independently and avoids forcing
// either side to disambiguate envelope shapes. Nothing here is
// modal-specific — a future non-rendering host service that main
// can't satisfy would ride the same arc.

/** Which `HostServices` method the renderer is being asked to fulfil. */
export type HostServicesRpcKind = 'inputBox' | 'quickPick' | 'confirm';

/** Request envelope (main → renderer). `payload` is the typed
 *  request shape for the matching `HostServices` method. */
export interface HostServicesRpcRequest {
  readonly id: string;
  readonly kind: HostServicesRpcKind;
  readonly payload: unknown;
}

/** Reply envelope (renderer → main). On success `response` is the
 *  typed response shape for the matching `HostServices` method.
 *  On error, `kind: 'error'` and a `message`. */
export type HostServicesRpcReply =
  | { readonly id: string; readonly kind: 'ok'; readonly response: unknown }
  | { readonly id: string; readonly kind: 'error'; readonly message: string };

/** IPC channels. Centralized so main + preload + renderer stay in sync. */
export const HOST_SERVICES_RPC = {
  request: 'noggin-host-services-rpc:request',  // main → renderer
  reply:   'noggin-host-services-rpc:reply',    // renderer → main
} as const;
