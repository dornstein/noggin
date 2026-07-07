// createProviderFlowsClient — client-side helper for the
// `provider.open` / `provider.create` RPC methods.
//
// Every UI host (desktop renderer, VS Code webview) that wants a
// provider's native "open" / "create" flow (a file dialog driven by
// the HOST process, not the sandboxed UI) ends up writing the exact
// same two-function wrapper around `client.request(...)`. Centralized
// here so hosts don't duplicate the request/response dance or the
// cancel-shaped error handling.

import type { RpcClient } from './client.ts';
import type { ProviderCreateResponse, ProviderOpenResponse } from './protocol.ts';

/**
 * @public
 * Client-side handle for driving a provider's host-side open/create
 * flows. Returned by {@link createProviderFlowsClient}.
 */
export interface ProviderFlowsClient {
  /** Run the provider's "open" flow for `scheme` (e.g. `'file://'`).
   *  Resolves to a canonical location, or null on cancel, on
   *  transport failure, or when the server has no flow wired for
   *  that scheme. */
  open(scheme: string): Promise<string | null>;
  /** Run the provider's "create" flow for `scheme`. Resolves to a
   *  canonical location, or null on cancel / failure / unwired
   *  scheme. */
  create(scheme: string): Promise<string | null>;
}

/**
 * @public
 * Build a {@link ProviderFlowsClient} bound to `client`. Hosts whose
 * `+`-menu pickers need a native dialog driven by the server use
 * this instead of hand-rolling `client.request('provider.open', …)`.
 */
export function createProviderFlowsClient(client: RpcClient): ProviderFlowsClient {
  return {
    async open(scheme: string): Promise<string | null> {
      try {
        const res = await client.request<ProviderOpenResponse>('provider.open', { scheme });
        return res.location;
      } catch {
        return null;
      }
    },
    async create(scheme: string): Promise<string | null> {
      try {
        const res = await client.request<ProviderCreateResponse>('provider.create', { scheme });
        return res.location;
      } catch {
        return null;
      }
    },
  };
}
