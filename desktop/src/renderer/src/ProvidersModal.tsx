// ProvidersModal — Help → Installed Providers… dialog.
//
// Pure presentation. Reads from the same
// `NogginProviderTypeReader` the sidebar uses so the listing is
// always in lock-step with what's actually mounted.

import type { ReactElement } from 'react';
import { Icon, type NogginProviderTypeReader } from '@noggin/ui';

export function ProvidersModal({ open, onClose, providers }: {
  open: boolean;
  onClose: () => void;
  providers: NogginProviderTypeReader;
}): ReactElement | null {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal-wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="providers-modal-title"
      >
        <div className="modal-title" id="providers-modal-title">Installed providers</div>
        <div className="modal-prompt">
          The desktop app routes each noggin location to a provider based on
          its URL scheme. Adding a new provider type adds new pickers and
          new badge tones automatically.
        </div>

        <ul className="providers-list">
          {providers.types.map((p) => (
            <li key={p.scheme} className="providers-item">
              <div className="providers-item-head">
                <span className={`noggin-list-badge noggin-list-badge--${p.badgeTone}`}>{p.scheme}</span>
                <span className="providers-item-icon"><Icon name={p.icon} /></span>
                <span className="providers-item-label">{p.label}</span>
                <span className="providers-item-scheme"><code>{p.scheme}://</code></span>
                {p.readOnly && <span className="providers-item-flag" title="apply() rejects with code 'read-only'">read-only</span>}
              </div>
              {(p.pickers?.length ?? 0) > 0 ? (
                <ul className="providers-pickers">
                  {(p.pickers ?? []).map((picker) => (
                    <li key={picker.id} className="providers-picker">
                      <Icon name={picker.icon} />
                      <span className="providers-picker-label">{picker.label}</span>
                      {picker.hint && <span className="providers-picker-hint">{picker.hint}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="providers-pickers-empty">
                  No user-facing picker. This scheme is created programmatically
                  (e.g. by tests or by the playground), not from the <kbd>+</kbd> menu.
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="modal-buttons">
          <button type="button" className="primary" autoFocus onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
