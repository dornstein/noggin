// HostServices RPC client — the main-process caller on the
// host-services RPC arc.
//
// Some `HostServices` methods can't be fulfilled by main alone (today:
// showInputBox / showQuickPick / showConfirm, which need React to
// render). Main forwards those to the renderer's HostServices
// implementation (`HostServicesReactImpl`) and awaits the answer.
// Main is the CLIENT here; the renderer is the SERVER. The pattern:
//
//   1. main calls `client.request(kind, payload)`.
//   2. the client assigns a request id and stashes a deferred Promise.
//   3. it sends the request over a dedicated IPC channel (separate
//      from noggin-rpc, and running the opposite direction).
//   4. The renderer fulfils the request and sends a reply.
//   5. the client receives the reply, resolves the pending Promise.
//
// If the window closes before a reply arrives, every pending request
// rejects with `'host-error'`. The client is a per-window singleton.

import { ipcMain as defaultIpcMain, type BrowserWindow, type IpcMain } from 'electron';

import {
  HOST_SERVICES_RPC,
  type HostServicesRpcKind,
  type HostServicesRpcReply,
  type HostServicesRpcRequest,
} from '@shared/host-services-rpc';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

export interface HostServicesRpcClient {
  /** Send a request to the renderer implementation and wait for the reply. */
  request<T>(kind: HostServicesRpcKind, payload: unknown): Promise<T>;
  /** Stop listening for replies and reject every pending request. */
  dispose(): void;
}

/** Minimal shape of Electron's `IpcMain` the client actually uses. */
export interface IpcMainLike {
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
}

/** Minimal shape of Electron's `BrowserWindow` the client actually uses. */
export interface HostServicesRpcWindowLike {
  readonly webContents: {
    send(channel: string, payload: unknown): void;
    isDestroyed(): boolean;
    on(event: 'destroyed', listener: () => void): unknown;
  };
}

export function createHostServicesRpcClient(
  window: BrowserWindow | HostServicesRpcWindowLike,
  ipcMain: IpcMain | IpcMainLike = defaultIpcMain,
): HostServicesRpcClient {
  const pending = new Map<string, PendingRequest>();
  let nextId = 1;
  let disposed = false;

  const replyListener = (_event: unknown, reply: HostServicesRpcReply): void => {
    if (disposed) return;
    const entry = pending.get(reply.id);
    if (!entry) return;
    pending.delete(reply.id);
    if (reply.kind === 'error') {
      entry.reject(new Error(reply.message ?? 'host-services request failed'));
    } else {
      entry.resolve(reply.response);
    }
  };

  ipcMain.on(HOST_SERVICES_RPC.reply, replyListener as never);

  const failAll = (err: Error): void => {
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  };

  window.webContents.on('destroyed', () => {
    if (disposed) return;
    disposed = true;
    ipcMain.removeListener(HOST_SERVICES_RPC.reply, replyListener as never);
    failAll(new Error('host-error: window destroyed before host-services reply'));
  });

  return {
    request<T>(kind: HostServicesRpcKind, payload: unknown): Promise<T> {
      if (disposed) {
        return Promise.reject(new Error('host-error: host-services rpc client disposed'));
      }
      if (window.webContents.isDestroyed()) {
        return Promise.reject(new Error('host-error: window destroyed'));
      }
      const id = `h${nextId++}`;
      const req: HostServicesRpcRequest = { id, kind, payload };
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        try {
          window.webContents.send(HOST_SERVICES_RPC.request, req);
        } catch (err) {
          pending.delete(id);
          reject(err);
        }
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      ipcMain.removeListener(HOST_SERVICES_RPC.reply, replyListener as never);
      failAll(new Error('host-error: host-services rpc client disposed'));
    },
  };
}
