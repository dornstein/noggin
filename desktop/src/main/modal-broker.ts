// Modal broker — round-trips a modal request from main to the
// renderer and back.
//
// Some `HostServices` methods (showInputBox, showQuickPick,
// showConfirm) need React UI. Only the renderer can render React, so
// main has no way to fulfil them locally. The pattern:
//
//   1. main calls `broker.request(kind, payload)`.
//   2. broker assigns a request id and stashes a deferred Promise.
//   3. broker sends `modal:request { id, kind, payload }` over a
//      dedicated IPC channel (separate from noggin-rpc).
//   4. The renderer mounts a React modal of the requested kind. When
//      the user confirms or cancels, the renderer sends
//      `modal:reply { id, response }`.
//   5. broker receives the reply, resolves the pending Promise.
//
// If the window closes before a reply arrives, every pending request
// rejects with `'host-error'`. The broker is a per-window singleton.

import { ipcMain as defaultIpcMain, type BrowserWindow, type IpcMain } from 'electron';

import { MODAL_IPC, type ModalKind, type ModalReply, type ModalRequest } from '@shared/modal-ipc';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

export interface ModalBroker {
  /** Send a modal request to the renderer and wait for the reply. */
  request<T>(kind: ModalKind, payload: unknown): Promise<T>;
  /** Stop listening for replies and reject every pending request. */
  dispose(): void;
}

/** Minimal shape of Electron's `IpcMain` the broker actually uses. */
export interface IpcMainLike {
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
}

/** Minimal shape of Electron's `BrowserWindow` the broker actually uses. */
export interface BrokerWindowLike {
  readonly webContents: {
    send(channel: string, payload: unknown): void;
    isDestroyed(): boolean;
    on(event: 'destroyed', listener: () => void): unknown;
  };
}

export function createModalBroker(
  window: BrowserWindow | BrokerWindowLike,
  ipcMain: IpcMain | IpcMainLike = defaultIpcMain,
): ModalBroker {
  const pending = new Map<string, PendingRequest>();
  let nextId = 1;
  let disposed = false;

  const replyListener = (_event: unknown, reply: ModalReply): void => {
    if (disposed) return;
    const entry = pending.get(reply.id);
    if (!entry) return;
    pending.delete(reply.id);
    if (reply.kind === 'error') {
      entry.reject(new Error(reply.message ?? 'modal request failed'));
    } else {
      entry.resolve(reply.response);
    }
  };

  ipcMain.on(MODAL_IPC.reply, replyListener as never);

  const failAll = (err: Error): void => {
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  };

  window.webContents.on('destroyed', () => {
    if (disposed) return;
    disposed = true;
    ipcMain.removeListener(MODAL_IPC.reply, replyListener as never);
    failAll(new Error('host-error: window destroyed before modal reply'));
  });

  return {
    request<T>(kind: ModalKind, payload: unknown): Promise<T> {
      if (disposed) {
        return Promise.reject(new Error('host-error: modal broker disposed'));
      }
      if (window.webContents.isDestroyed()) {
        return Promise.reject(new Error('host-error: window destroyed'));
      }
      const id = `m${nextId++}`;
      const req: ModalRequest = { id, kind, payload };
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        try {
          window.webContents.send(MODAL_IPC.request, req);
        } catch (err) {
          pending.delete(id);
          reject(err);
        }
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      ipcMain.removeListener(MODAL_IPC.reply, replyListener as never);
      failAll(new Error('host-error: modal broker disposed'));
    },
  };
}
