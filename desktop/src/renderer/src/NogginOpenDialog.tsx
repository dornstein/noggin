// NogginOpenDialog — cross-provider "Open a noggin" / "New noggin"
// dialog. Parallel to the OS file picker, but each registered
// provider plugs in its own pickers (file dialog, URL prompt,
// memory placeholder, …).
//
// Presentation only: takes the resolved provider catalog and
// forwards clicks to each picker's `onSelect`. Provider-side
// success/failure surfaces through those handlers (they open the
// noggin, show errors, close this dialog by calling `onClose`).

import type { NogginProviderTypeReader } from '@noggin/ui';
import { Icon } from '@noggin/ui';
import { useEffect, useMemo, useRef } from 'react';

export type NogginOpenDialogMode = 'open' | 'new';

export interface NogginOpenDialogProps {
  /** Whether the dialog is visible. */
  open: boolean;
  /** 'open' shows only pickers with `mode: 'open'` (or unspecified);
   *  'new' shows only pickers with `mode: 'new'` (or unspecified).
   *  A picker with `mode` undefined shows in both. */
  mode: NogginOpenDialogMode;
  providers: NogginProviderTypeReader;
  /** Fired on Esc, backdrop click, Cancel, and after any picker
   *  selection so callers can dismiss without threading state
   *  through each picker. */
  onClose: () => void;
}

export function NogginOpenDialog({ open, mode, providers, onClose }: NogginOpenDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Auto-focus the dialog on open so Esc works immediately without
  // requiring the user to click first.
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  // Group pickers by provider, filtered by mode. Providers that
  // contribute zero matching pickers are omitted rather than shown
  // as empty cards.
  const groups = useMemo(() => {
    return providers.types
      .map((p) => ({
        provider: p,
        pickers: (p.pickers ?? []).filter((pk) => pk.mode === undefined || pk.mode === mode),
      }))
      .filter((g) => g.pickers.length > 0);
  }, [providers, mode]);

  if (!open) return null;

  const title = mode === 'new' ? 'New noggin' : 'Open noggin';
  const subtitle = mode === 'new'
    ? 'Pick where the new noggin lives. Each provider stores data in its own place.'
    : 'Pick where the noggin lives. Each provider has its own way of resolving a location.';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal-wide noggin-open-dialog"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        role="dialog"
        aria-labelledby="noggin-open-dialog-title"
        aria-modal="true"
      >
        <div className="modal-title" id="noggin-open-dialog-title">{title}</div>
        <div className="modal-prompt">{subtitle}</div>

        {groups.length === 0 ? (
          <div className="noggin-open-empty">
            No {mode === 'new' ? 'creators' : 'openers'} are registered. Install a
            provider or check the Help → Installed Providers dialog.
          </div>
        ) : (
          <ul className="noggin-open-list">
            {groups.map(({ provider, pickers }) => (
              <li key={provider.scheme} className="noggin-open-group">
                <div className="noggin-open-group-head">
                  <span className={`noggin-list-badge noggin-list-badge--${provider.badgeTone}`}>
                    {provider.scheme}
                  </span>
                  <Icon name={provider.icon} className="noggin-open-group-icon" />
                  <span className="noggin-open-group-label">{provider.label}</span>
                </div>
                <ul className="noggin-open-pickers">
                  {pickers.map((picker) => (
                    <li key={picker.id}>
                      <button
                        type="button"
                        className="noggin-open-picker"
                        onClick={() => {
                          onClose();
                          void picker.onSelect();
                        }}
                      >
                        <Icon name={picker.icon} className="noggin-open-picker-icon" />
                        <span className="noggin-open-picker-body">
                          <span className="noggin-open-picker-label">{picker.label}</span>
                          {picker.hint && (
                            <span className="noggin-open-picker-hint">{picker.hint}</span>
                          )}
                        </span>
                        <Icon name="chevron-right" className="noggin-open-picker-chev" />
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <div className="modal-buttons">
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
