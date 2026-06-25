// Electron IPC transport.
//
// Two factories, one per side:
//
//   createElectronIpcRendererTransport(ipcRenderer, channel)
//       wraps ipcRenderer.send / ipcRenderer.on so the renderer side
//       of an Electron app can speak noggin-rpc to the main process.
//
//   createElectronIpcMainTransport(ipcMain, channel, sender)
//       wraps ipcMain.on / sender.send for the main-process side. One
//       transport per renderer; multiplexing across multiple windows
//       is the caller's responsibility (typically one server per
//       webContents).
//
// We don't import 'electron' at the top of this module — it's a
// peerDep, and importing it would force every consumer (including
// the docs site) to ship Electron. We accept the IPC objects via
// structural typing instead.

import type { RpcMessage } from '../envelope.ts';
import { Emitter } from '../emitter.ts';
import type { RpcDisposable, Transport } from '../transport.ts';

/** @public Subset of Electron's `IpcRenderer` we use. */
export interface IpcRendererLike {
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): this;
  off?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): this;
  removeListener?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): this;
}

/** @public Subset of Electron's `IpcMain` we use. */
export interface IpcMainLike {
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): this;
  off?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): this;
  removeListener?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): this;
}

/** @public Subset of Electron's `WebContents` we use. */
export interface WebContentsLike {
  send(channel: string, ...args: unknown[]): void;
  isDestroyed?(): boolean;
  on(event: 'destroyed', listener: () => void): this;
  off?(event: 'destroyed', listener: () => void): this;
  removeListener?(event: 'destroyed', listener: () => void): this;
}

/** @public Options for both renderer + main IPC transports. */
export interface ElectronIpcTransportOptions {
  /** Channel name to send/receive on. Default `'noggin-rpc'`. */
  channel?: string;
}

class ElectronIpcRendererTransport implements Transport {
  private readonly ipc: IpcRendererLike;
  private readonly channel: string;
  private readonly messages = new Emitter<RpcMessage>();
  private readonly disconnects = new Emitter<void>();
  private readonly listener: (event: unknown, message: RpcMessage) => void;
  private closed = false;

  constructor(ipc: IpcRendererLike, channel: string) {
    this.ipc = ipc;
    this.channel = channel;
    this.listener = (_event, message) => {
      if (!this.closed) this.messages.emit(message);
    };
    this.ipc.on(this.channel, this.listener as never);
  }

  send(message: RpcMessage): void {
    if (this.closed) throw new Error('ElectronIpcRendererTransport: send after close');
    this.ipc.send(this.channel, message);
  }

  onMessage(handler: (message: RpcMessage) => void): RpcDisposable {
    return this.messages.add(handler);
  }

  onDisconnect(handler: () => void): RpcDisposable {
    if (this.closed) {
      queueMicrotask(handler);
      return { dispose: () => {} };
    }
    return this.disconnects.add(handler);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const off = this.ipc.off ?? this.ipc.removeListener;
    off?.call(this.ipc, this.channel, this.listener as never);
    this.disconnects.emit();
    this.disconnects.clear();
    this.messages.clear();
  }
}

class ElectronIpcMainTransport implements Transport {
  private readonly ipcMain: IpcMainLike;
  private readonly sender: WebContentsLike;
  private readonly channel: string;
  private readonly messages = new Emitter<RpcMessage>();
  private readonly disconnects = new Emitter<void>();
  private readonly ipcListener: (event: unknown, message: RpcMessage) => void;
  private readonly destroyListener: () => void;
  private closed = false;

  constructor(ipcMain: IpcMainLike, sender: WebContentsLike, channel: string) {
    this.ipcMain = ipcMain;
    this.sender = sender;
    this.channel = channel;
    this.ipcListener = (event, message) => {
      // ipcMain fires for every renderer on the channel; only accept
      // messages from the renderer this transport is paired with.
      const fromSender = (event as { sender?: WebContentsLike })?.sender;
      if (fromSender !== this.sender) return;
      if (!this.closed) this.messages.emit(message);
    };
    this.destroyListener = () => this.close();
    this.ipcMain.on(this.channel, this.ipcListener as never);
    this.sender.on('destroyed', this.destroyListener);
  }

  send(message: RpcMessage): void {
    if (this.closed) throw new Error('ElectronIpcMainTransport: send after close');
    if (this.sender.isDestroyed?.()) {
      this.close();
      throw new Error('ElectronIpcMainTransport: sender destroyed');
    }
    this.sender.send(this.channel, message);
  }

  onMessage(handler: (message: RpcMessage) => void): RpcDisposable {
    return this.messages.add(handler);
  }

  onDisconnect(handler: () => void): RpcDisposable {
    if (this.closed) {
      queueMicrotask(handler);
      return { dispose: () => {} };
    }
    return this.disconnects.add(handler);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const ipcOff = this.ipcMain.off ?? this.ipcMain.removeListener;
    ipcOff?.call(this.ipcMain, this.channel, this.ipcListener as never);
    const destroyOff = this.sender.off ?? this.sender.removeListener;
    destroyOff?.call(this.sender, 'destroyed' as never, this.destroyListener);
    this.disconnects.emit();
    this.disconnects.clear();
    this.messages.clear();
  }
}

/**
 * @public
 * Wrap an Electron renderer-side `ipcRenderer` as a `Transport`. Used
 * by the desktop renderer to talk to a noggin-rpc server running in
 * the main process.
 */
export function createElectronIpcRendererTransport(
  ipcRenderer: IpcRendererLike,
  opts: ElectronIpcTransportOptions = {},
): Transport {
  return new ElectronIpcRendererTransport(ipcRenderer, opts.channel ?? 'noggin-rpc');
}

/**
 * @public
 * Wrap Electron's `ipcMain` + a `WebContents` as a `Transport` for the
 * main-process server. Pair one transport per renderer window.
 */
export function createElectronIpcMainTransport(
  ipcMain: IpcMainLike,
  sender: WebContentsLike,
  opts: ElectronIpcTransportOptions = {},
): Transport {
  return new ElectronIpcMainTransport(ipcMain, sender, opts.channel ?? 'noggin-rpc');
}
