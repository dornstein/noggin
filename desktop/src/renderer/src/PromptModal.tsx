// Renderer-local prompt modal. Reusable input dialog mounted directly
// by the renderer (no main-process round-trip). Used by the sidebar
// `+` menu to ask for a URL when the user picks "Open from URL", and
// by anything else in the renderer that needs to prompt for text.
//
// Same look-and-feel as the InputBoxModal that HostServicesReactImpl
// mounts for main-initiated `host.showInputBox` requests, but invocable
// imperatively via `usePromptText` instead of waiting on an IPC
// message.

import { useCallback, useState, type ReactElement } from 'react';

export interface PromptOptions {
  readonly title?: string;
  readonly prompt?: string;
  readonly placeholder?: string;
  /** Pre-filled value. */
  readonly value?: string;
  /** Label for the submit button. Default 'OK'. */
  readonly confirmLabel?: string;
}

interface PromptModalProps extends PromptOptions {
  onSubmit: (value: string | null) => void;
}

function PromptModal({ title, prompt, placeholder, value: initial, confirmLabel, onSubmit }: PromptModalProps): ReactElement {
  const [value, setValue] = useState(initial ?? '');
  return (
    <div className="modal-overlay" onClick={() => onSubmit(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {title && <div className="modal-title">{title}</div>}
        {prompt && <div className="modal-prompt">{prompt}</div>}
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(value); }}>
          <input
            className="modal-input"
            type="text"
            autoFocus
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); onSubmit(null); }
            }}
          />
          <div className="modal-buttons">
            <button type="button" onClick={() => onSubmit(null)}>Cancel</button>
            <button type="submit" className="primary">{confirmLabel ?? 'OK'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Imperative prompt hook. Returns:
 *   - `prompt(opts) => Promise<string | null>` — call from any event
 *     handler; the modal mounts, user enters text or cancels, the
 *     promise resolves with the trimmed value or null on cancel.
 *   - `element` — the modal node; render it once near the root of
 *     your component tree.
 *
 * One active prompt at a time. Calls made while a prompt is already
 * open reject with `'busy'` rather than queueing (matches how the
 * sidebar uses this — the user can only click one menu item at a
 * time anyway).
 */
export function usePromptText(): {
  prompt: (opts: PromptOptions) => Promise<string | null>;
  element: ReactElement | null;
} {
  const [pending, setPending] = useState<{
    opts: PromptOptions;
    resolve: (v: string | null) => void;
  } | null>(null);

  const promptFn = useCallback((opts: PromptOptions): Promise<string | null> => {
    if (pending) return Promise.reject(new Error('busy'));
    return new Promise<string | null>((resolve) => {
      setPending({ opts, resolve });
    });
  }, [pending]);

  const element: ReactElement | null = pending ? (
    <PromptModal
      {...pending.opts}
      onSubmit={(value) => {
        const trimmed = value === null ? null : value.trim();
        pending.resolve(trimmed && trimmed.length > 0 ? trimmed : null);
        setPending(null);
      }}
    />
  ) : null;

  return { prompt: promptFn, element };
}
