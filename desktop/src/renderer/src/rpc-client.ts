// Renderer-side noggin-rpc client.
//
// One `RpcClient` per renderer; the underlying transport is bound to
// `window.nogginRpcIpc` (exposed by the preload script). Main runs the
// server; we drive verbs across it.

import { RpcClient } from '@noggin/rpc';
import { createElectronIpcRendererTransport } from '@noggin/rpc/transports/electron-ipc';
import type { NogginRpcIpc } from '../../preload/index';

declare global {
  interface Window {
    nogginRpcIpc?: NogginRpcIpc;
  }
}

let cached: RpcClient | null = null;

/**
 * Return the renderer's singleton {@link RpcClient}. Throws if the
 * preload bridge isn't on `window` — which means either we're running
 * outside Electron (use `?mock=1` to skip the rpc path) or the preload
 * script failed to load.
 */
export function getRpcClient(): RpcClient {
  if (cached) return cached;
  const ipc = window.nogginRpcIpc;
  if (!ipc) {
    throw new Error(
      'noggin-rpc IPC bridge missing. The desktop app must be launched ' +
      'via Electron (or, for browser UI iteration, use ?mock=1).',
    );
  }
  const transport = createElectronIpcRendererTransport(ipc, {});
  cached = new RpcClient(transport);
  return cached;
}

/** Tear down the cached client. Only used by tests; production keeps
 *  the client alive for the renderer's lifetime. */
export function _resetRpcClient(): void {
  if (cached) { cached.dispose(); cached = null; }
}
