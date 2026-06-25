// Main-process engine — owns the live `Noggin` instance and the
// `RpcServer` that the renderer talks to.
//
// Phase 4 of `docs/plans/2026-06-noggin-rpc.md` moves engine
// instantiation out of the renderer. Main hosts the engine; the
// renderer drives verbs over `noggin-rpc` via `ElectronIpcTransport`.
//
// This module is small on purpose. It exposes:
//
//   attachRpcServer(window) → NogginRpcServer
//     Pair an `ElectronIpcMainTransport` to the given window's
//     webContents, build a server that owns the engine + provider
//     registry + host services, and return a handle the caller can
//     dispose when the window closes.
//
// Provider flows (pickToOpen / create / listInstances) and host
// services are injected from siblings to keep this file focused on
// "what does main know about the engine".

import { ipcMain, type BrowserWindow } from 'electron';

import { createElectronIpcMainTransport } from '@noggin/rpc/transports/electron-ipc';
import {
  createNogginRpcServer,
  type CreateNogginRpcServerOptions,
  type NogginRpcServer,
  type ProviderFlows,
} from '@noggin/rpc';

import '@noggin/engine/providers/file';     // registers file://
import '@noggin/engine/providers/memory';   // registers memory://

import { createElectronHostServices } from './host-services-electron.js';
import { createElectronProviderFlows } from './provider-flows-electron.js';

const RPC_CHANNEL = 'noggin-rpc';

/** Public handle returned by {@link attachRpcServer}. */
export interface AttachedRpcServer {
  /** The underlying server. Disposed by {@link dispose}. */
  readonly server: NogginRpcServer;
  /** Tear down the server and free its transport. Idempotent. */
  dispose(): Promise<void>;
}

/**
 * Build and attach a noggin-rpc server to the given window.
 *
 * The server lives until the window is closed (the IPC transport
 * notices `webContents 'destroyed'`) or the caller invokes `dispose()`.
 *
 * One server per window. Each call constructs its own transport bound
 * to that window's `webContents`, so multiple windows speak
 * independent RPC streams.
 */
export function attachRpcServer(window: BrowserWindow): AttachedRpcServer {
  const transport = createElectronIpcMainTransport(
    ipcMain,
    window.webContents,
    { channel: RPC_CHANNEL },
  );

  const hostServices = createElectronHostServices(window);
  const providerFlows: ProviderFlows = createElectronProviderFlows(window);

  const opts: CreateNogginRpcServerOptions = {
    transport,
    hostServices,
    providerFlows,
  };
  const server = createNogginRpcServer(opts);

  let disposed = false;
  return {
    server,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await server.dispose();
    },
  };
}
