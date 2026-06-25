// Modal broker round-trip tests.
//
// The broker is the renderer-modal-fulfilment side of the noggin-rpc
// HostServices contract for desktop. It runs in the main process,
// posts modal-request IPC messages to the renderer, and resolves the
// pending Promise when the renderer posts a modal-reply back.
//
// We mock Electron's `ipcMain` and `webContents` with EventEmitters so
// the test runs in plain Node (no Electron runtime). The broker code
// under test is the production module — we just inject the mocks.

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// Mock the 'electron' import that modal-broker.ts pulls in for its
// default ipcMain parameter. We don't use the default in these tests
// (we inject our own) but the import must still resolve.
vi.mock('electron', () => ({
  ipcMain: new EventEmitter(),
}));

import { createModalBroker } from '../src/main/modal-broker';
import { MODAL_IPC, type ModalReply, type ModalRequest } from '../src/shared/modal-ipc';

interface MockSender {
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
  on(event: 'destroyed', listener: () => void): void;
  _destroy(): void;
}

interface MockHarness {
  ipcMain: EventEmitter;
  window: { webContents: MockSender };
  sent: Array<{ channel: string; payload: ModalRequest }>;
  /** Simulate the renderer posting a reply for the most recent
   *  modal-request — or, with an id, for that specific request. */
  reply(response: unknown, id?: string): void;
  replyError(message: string, id?: string): void;
}

function makeHarness(): MockHarness {
  const ipcMain = new EventEmitter();
  const sent: Array<{ channel: string; payload: ModalRequest }> = [];
  let destroyed = false;
  const destroyListeners: Array<() => void> = [];
  const sender: MockSender = {
    send(channel, payload) {
      sent.push({ channel, payload: payload as ModalRequest });
    },
    isDestroyed: () => destroyed,
    on(event, listener) {
      if (event === 'destroyed') destroyListeners.push(listener);
    },
    _destroy() {
      destroyed = true;
      for (const l of destroyListeners) l();
    },
  };
  return {
    ipcMain,
    window: { webContents: sender },
    sent,
    reply(response, id) {
      const last = sent[sent.length - 1];
      const targetId = id ?? last.payload.id;
      const reply: ModalReply = { id: targetId, kind: 'ok', response };
      ipcMain.emit(MODAL_IPC.reply, null, reply);
    },
    replyError(message, id) {
      const last = sent[sent.length - 1];
      const targetId = id ?? last.payload.id;
      const reply: ModalReply = { id: targetId, kind: 'error', message };
      ipcMain.emit(MODAL_IPC.reply, null, reply);
    },
  };
}

describe('createModalBroker', () => {
  it('round-trips a happy-path modal request', async () => {
    const h = makeHarness();
    const broker = createModalBroker(h.window, h.ipcMain);

    const pending = broker.request<{ value: string | null }>('inputBox', { title: 'Enter a name' });
    expect(h.sent.length).toBe(1);
    expect(h.sent[0].channel).toBe(MODAL_IPC.request);
    expect(h.sent[0].payload.kind).toBe('inputBox');
    expect(h.sent[0].payload.payload).toEqual({ title: 'Enter a name' });

    h.reply({ value: 'Alice' });
    await expect(pending).resolves.toEqual({ value: 'Alice' });
    broker.dispose();
  });

  it('routes replies by id, not by send order', async () => {
    const h = makeHarness();
    const broker = createModalBroker(h.window, h.ipcMain);

    const first = broker.request<{ value: string | null }>('inputBox', { title: 'A' });
    const second = broker.request<{ value: string | null }>('inputBox', { title: 'B' });
    expect(h.sent.length).toBe(2);

    // Reply to the SECOND request before the first.
    h.reply({ value: 'second-answer' }, h.sent[1].payload.id);
    await expect(second).resolves.toEqual({ value: 'second-answer' });

    // First still pending; reply now.
    h.reply({ value: 'first-answer' }, h.sent[0].payload.id);
    await expect(first).resolves.toEqual({ value: 'first-answer' });

    broker.dispose();
  });

  it('rejects when the renderer replies with an error envelope', async () => {
    const h = makeHarness();
    const broker = createModalBroker(h.window, h.ipcMain);

    const pending = broker.request('confirm', { message: 'Delete?' });
    h.replyError('renderer crashed');
    await expect(pending).rejects.toThrow(/renderer crashed/);
    broker.dispose();
  });

  it('rejects every pending request when the window is destroyed', async () => {
    const h = makeHarness();
    const broker = createModalBroker(h.window, h.ipcMain);

    const a = broker.request('inputBox', {});
    const b = broker.request('quickPick', { items: [] });
    expect(h.sent.length).toBe(2);

    h.window.webContents._destroy();

    await expect(a).rejects.toThrow(/window destroyed/);
    await expect(b).rejects.toThrow(/window destroyed/);
    // No need to call dispose; destroy already cleaned up.
  });

  it('rejects further requests once disposed', async () => {
    const h = makeHarness();
    const broker = createModalBroker(h.window, h.ipcMain);
    broker.dispose();

    await expect(broker.request('inputBox', {})).rejects.toThrow(/disposed/);
  });

  it('rejects when the window is already destroyed at request time', async () => {
    const h = makeHarness();
    const broker = createModalBroker(h.window, h.ipcMain);

    h.window.webContents._destroy();
    // Some implementations dispose synchronously on destroy; either
    // 'window destroyed' or 'modal broker disposed' is acceptable.
    await expect(broker.request('inputBox', {})).rejects.toThrow(/disposed|destroyed/);
  });

  it('issues unique ids per request', () => {
    const h = makeHarness();
    const broker = createModalBroker(h.window, h.ipcMain);

    void broker.request('inputBox', {}).catch(() => undefined);
    void broker.request('inputBox', {}).catch(() => undefined);
    void broker.request('inputBox', {}).catch(() => undefined);

    const ids = h.sent.map((s) => s.payload.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);

    broker.dispose();
  });

  it('ignores stale replies for unknown ids', () => {
    const h = makeHarness();
    const broker = createModalBroker(h.window, h.ipcMain);

    // Should be a no-op, not throw.
    h.ipcMain.emit(MODAL_IPC.reply, null, { id: 'no-such-id', kind: 'ok', response: {} });
    broker.dispose();
  });
});
