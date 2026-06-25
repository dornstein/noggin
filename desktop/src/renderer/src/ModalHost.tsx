// ModalHost — renderer-side component that fulfils
// `host.showInputBox`/`host.showQuickPick`/`host.showConfirm` requests.
//
// Main posts a modal-request over `MODAL_IPC.request` via the preload
// bridge (`window.modalIpc`). This component listens for those
// requests, mounts the matching React modal, and posts a reply back
// when the user confirms or cancels.
//
// One ModalHost is mounted at the App root. It tracks at most one
// active modal at a time — if main fires another request while one is
// open, we queue it and serve it in order. That keeps the UX from
// surfacing overlapping dialogs the way main never asks for them
// concurrently anyway (HostServices methods are awaited one at a
// time per call site), but the queue guards against bugs.

import { useEffect, useState, type ReactElement } from 'react';

import type {
  HostShowConfirmRequest,
  HostShowInputBoxRequest,
  HostShowQuickPickRequest,
  QuickPickItem,
} from '@noggin/rpc';

import type { ModalRequest } from '@shared/modal-ipc';

declare global {
  interface Window {
    modalIpc?: {
      onRequest(handler: (req: ModalRequest) => void): () => void;
      sendReply(reply: { id: string; kind: 'ok'; response: unknown } | { id: string; kind: 'error'; message: string }): void;
    };
  }
}

export function ModalHost(): ReactElement | null {
  const [active, setActive] = useState<ModalRequest | null>(null);
  const [queue, setQueue] = useState<ModalRequest[]>([]);

  // Keep `queue` referenced even though we only read it via the
  // updater closures below — having it in deps would be the wrong
  // pattern; React lints prefer functional updaters in onRequest.
  void queue;

  useEffect(() => {
    const ipc = window.modalIpc;
    if (!ipc) return;
    return ipc.onRequest((req) => {
      setActive((current) => {
        if (current) {
          setQueue((q) => [...q, req]);
          return current;
        }
        return req;
      });
    });
  }, []);

  const finish = (response: unknown): void => {
    if (!active) return;
    window.modalIpc?.sendReply({ id: active.id, kind: 'ok', response });
    setActive(null);
    setQueue((q) => {
      if (q.length === 0) return q;
      const [next, ...rest] = q;
      setActive(next);
      return rest;
    });
  };

  if (!active) return null;
  if (active.kind === 'inputBox') return <InputBoxModal req={active.payload as HostShowInputBoxRequest} onSubmit={finish} />;
  if (active.kind === 'quickPick') return <QuickPickModal req={active.payload as HostShowQuickPickRequest} onSubmit={finish} />;
  if (active.kind === 'confirm') return <ConfirmModal req={active.payload as HostShowConfirmRequest} onSubmit={finish} />;
  return null;
}

// ── InputBox ─────────────────────────────────────────────────────────

function InputBoxModal({ req, onSubmit }: {
  req: HostShowInputBoxRequest;
  onSubmit: (response: { value: string | null }) => void;
}): ReactElement {
  const [value, setValue] = useState(req.value ?? '');
  return (
    <div className="modal-overlay" onClick={() => onSubmit({ value: null })}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {req.title && <div className="modal-title">{req.title}</div>}
        {req.prompt && <div className="modal-prompt">{req.prompt}</div>}
        <form onSubmit={(e) => { e.preventDefault(); onSubmit({ value }); }}>
          <input
            className="modal-input"
            type={req.password ? 'password' : 'text'}
            autoFocus
            placeholder={req.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); onSubmit({ value: null }); }
            }}
          />
          <div className="modal-buttons">
            <button type="button" onClick={() => onSubmit({ value: null })}>Cancel</button>
            <button type="submit" className="primary">OK</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── QuickPick ────────────────────────────────────────────────────────

function QuickPickModal({ req, onSubmit }: {
  req: HostShowQuickPickRequest;
  onSubmit: (response: { selected: QuickPickItem | null }) => void;
}): ReactElement {
  const [selectedIdx, setSelectedIdx] = useState(0);
  return (
    <div className="modal-overlay" onClick={() => onSubmit({ selected: null })}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {req.title && <div className="modal-title">{req.title}</div>}
        {req.placeholder && <div className="modal-prompt">{req.placeholder}</div>}
        <ul
          className="modal-list"
          role="listbox"
          tabIndex={0}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); onSubmit({ selected: null }); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, req.items.length - 1)); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); return; }
            if (e.key === 'Enter') {
              e.preventDefault();
              const item = req.items[selectedIdx];
              onSubmit({ selected: item ?? null });
            }
          }}
        >
          {req.items.map((item, i) => (
            <li
              key={i}
              role="option"
              aria-selected={i === selectedIdx}
              className={i === selectedIdx ? 'selected' : ''}
              onMouseEnter={() => setSelectedIdx(i)}
              onClick={() => onSubmit({ selected: item })}
            >
              <div className="modal-list-label">{item.label}</div>
              {item.description && <div className="modal-list-desc">{item.description}</div>}
            </li>
          ))}
        </ul>
        <div className="modal-buttons">
          <button type="button" onClick={() => onSubmit({ selected: null })}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Confirm ──────────────────────────────────────────────────────────

function ConfirmModal({ req, onSubmit }: {
  req: HostShowConfirmRequest;
  onSubmit: (response: { confirmed: boolean }) => void;
}): ReactElement {
  return (
    <div className="modal-overlay" onClick={() => onSubmit({ confirmed: false })}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {req.title && <div className="modal-title">{req.title}</div>}
        <div className="modal-prompt">{req.message}</div>
        <div className="modal-buttons">
          <button
            type="button"
            autoFocus
            onClick={() => onSubmit({ confirmed: false })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); onSubmit({ confirmed: false }); }
            }}
          >
            {req.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => onSubmit({ confirmed: true })}
          >
            {req.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
