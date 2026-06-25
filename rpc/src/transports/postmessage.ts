// postMessage transport.
//
// Generic adapter over the `postMessage` / `message` pair the browser
// and VS Code webviews share. The two ends use slightly different
// APIs:
//
//   VS Code extension host  - webview.postMessage(msg)
//                             webview.onDidReceiveMessage(handler)
//   VS Code webview script  - vscode.postMessage(msg)
//                             window.addEventListener('message', handler)
//   Browser window          - window.postMessage(msg, '*')
//                             window.addEventListener('message', handler)
//
// We expose two factories that take a structural channel object so
// the noggin host code wires the right pair into each side without
// the rpc package needing 'vscode' as a peer dep.

import type { RpcMessage } from '../envelope.ts';
import { Emitter } from '../emitter.ts';
import type { RpcDisposable, Transport } from '../transport.ts';

/** @public Structural shape of a `MessageEvent`-like object. */
export interface MessageEventLike {
  readonly data: unknown;
}

/**
 * @public
 * Generic shape of a postMessage channel: something with a `postMessage`
 * method and an addEventListener / removeEventListener pair (or VS Code
 * webview-style `onDidReceiveMessage` returning a disposable).
 */
export interface PostMessageChannel {
  postMessage(message: unknown): void;
  /** Browser / window-style listener registration. */
  addEventListener?(event: 'message', listener: (e: MessageEventLike) => void): void;
  removeEventListener?(event: 'message', listener: (e: MessageEventLike) => void): void;
  /** VS Code webview-style listener registration. Either onMessage form
   *  is acceptable; the transport prefers `onDidReceiveMessage` when present. */
  onDidReceiveMessage?(listener: (message: unknown) => void): { dispose(): void };
}

class PostMessageTransport implements Transport {
  private readonly channel: PostMessageChannel;
  private readonly messages = new Emitter<RpcMessage>();
  private readonly disconnects = new Emitter<void>();
  private readonly subscription: { dispose: () => void };
  private closed = false;

  constructor(channel: PostMessageChannel) {
    this.channel = channel;
    if (typeof channel.onDidReceiveMessage === 'function') {
      const sub = channel.onDidReceiveMessage((message) => {
        if (!this.closed) this.messages.emit(message as RpcMessage);
      });
      this.subscription = sub;
    } else if (typeof channel.addEventListener === 'function') {
      const listener = (e: MessageEventLike) => {
        if (!this.closed) this.messages.emit(e.data as RpcMessage);
      };
      channel.addEventListener('message', listener);
      const remove = channel.removeEventListener;
      this.subscription = {
        dispose: () => { remove?.call(channel, 'message', listener); },
      };
    } else {
      throw new Error('PostMessageTransport: channel exposes neither addEventListener nor onDidReceiveMessage');
    }
  }

  send(message: RpcMessage): void {
    if (this.closed) throw new Error('PostMessageTransport: send after close');
    this.channel.postMessage(message);
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
    try { this.subscription.dispose(); } catch { /* swallow */ }
    this.disconnects.emit();
    this.disconnects.clear();
    this.messages.clear();
  }
}

/**
 * @public
 * Wrap a postMessage-capable channel as a `Transport`. Works for both
 * VS Code webview <-> extension host (via `webview` on the host side
 * and `acquireVsCodeApi() + window` on the webview side) and plain
 * browser `window <-> window` scenarios.
 */
export function createPostMessageTransport(channel: PostMessageChannel): Transport {
  return new PostMessageTransport(channel);
}
