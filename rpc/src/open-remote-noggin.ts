// openRemoteNoggin — one-call factory wrapping noggin.open + noggin.subscribe.
//
// Returns a ready-to-use RemoteNoggin with the local memory noggin
// already seeded from the server's initial snapshot. Callers invoke
// this once per noggin and then drive verbs on the result.

import type { RpcClient } from './client.ts';
import type {
  NogginOpenResponse,
  NogginSubscribeResponse,
} from './protocol.ts';

import { RemoteNoggin } from './remote-noggin.ts';

/** @public Options for {@link openRemoteNoggin}. */
export interface OpenRemoteNogginOptions {
  client: RpcClient;
  /** Canonical location string the server's provider registry knows
   *  how to open (e.g. `'~/.noggin.yaml'`, `'file:///abs/path.yaml'`,
   *  `'memory://x'`). */
  location: string;
  /** Optional provider-specific open opts forwarded to the server. */
  openOpts?: Record<string, unknown>;
}

/**
 * @public
 * Open a noggin over noggin-rpc and return a ready-to-use
 * {@link RemoteNoggin}.
 *
 * Performs three RPCs in sequence:
 *
 *   1. `noggin.open`      — server resolves the provider, returns
 *                           sessionId + initial snapshot + describe.
 *   2. `noggin.subscribe` — server starts streaming `noggin.changed` /
 *                           `noggin.errored` notifications back.
 *   3. Local memory noggin construction (seeded from the snapshot).
 *
 * If any step fails the function rejects and no server state is left
 * behind: a noggin opened in step 1 is closed on failure of step 2.
 */
export async function openRemoteNoggin(opts: OpenRemoteNogginOptions): Promise<RemoteNoggin> {
  const { client, location, openOpts } = opts;
  const open = await client.request<NogginOpenResponse>(
    'noggin.open',
    { location, opts: openOpts },
  );
  let sub: NogginSubscribeResponse;
  try {
    sub = await client.request<NogginSubscribeResponse>(
      'noggin.subscribe',
      { sessionId: open.sessionId },
    );
  } catch (err) {
    // Roll back the opened session so we don't leak server resources.
    try { await client.request('noggin.close', { sessionId: open.sessionId }); } catch { /* swallow */ }
    throw err;
  }
  const remote = new RemoteNoggin({
    client,
    sessionId: open.sessionId,
    subscriptionId: sub.subscriptionId,
    initialSnapshot: open.snapshot,
    describe: open.describe,
  });
  await remote._initLocal();
  return remote;
}
