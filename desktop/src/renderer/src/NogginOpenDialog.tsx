// NogginOpenDialog — cross-provider "Open a noggin" / "New noggin"
// dialog.
//
// Two-pane layout, wizard-style: providers + their pickers on the
// left, an active detail pane on the right. Selecting a picker
// updates the right pane in-place — no cascade of separate modals
// for the URL prompt case. Pickers that need extra input declare
// it via `NogginProviderPicker.input`; the dialog renders the
// appropriate form field and hands the value back to `onSelect`.
// Pickers with no `input` (native file dialogs) get a single
// "Open" button that fires `onSelect()` — the OS dialog IS their
// form.
//
// Each picker's `onSelect` still owns the actual work (dialog +
// engine open); this component only orchestrates selection and
// input, then closes on completion.

import type { NogginProviderTypeReader } from '@noggin/ui';
import { Icon } from '@noggin/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NogginProviderPicker, NogginProviderType } from '@noggin/ui';

export type NogginOpenDialogMode = 'open' | 'new';

export interface NogginOpenDialogProps {
  open: boolean;
  mode: NogginOpenDialogMode;
  providers: NogginProviderTypeReader;
  onClose: () => void;
}

interface PickerEntry {
  provider: NogginProviderType;
  picker: NogginProviderPicker;
}

export function NogginOpenDialog({ open, mode, providers, onClose }: NogginOpenDialogProps) {
  // Flat list of picker entries in the current mode, grouped by
  // provider for the sidebar rendering below.
  const entries: PickerEntry[] = useMemo(() => {
    const out: PickerEntry[] = [];
    for (const provider of providers.types) {
      for (const picker of provider.pickers ?? []) {
        if (picker.mode === undefined || picker.mode === mode) {
          out.push({ provider, picker });
        }
      }
    }
    return out;
  }, [providers, mode]);

  const groups = useMemo(() => {
    const byScheme = new Map<string, PickerEntry[]>();
    for (const e of entries) {
      const list = byScheme.get(e.provider.scheme) ?? [];
      list.push(e);
      byScheme.set(e.provider.scheme, list);
    }
    return Array.from(byScheme.entries());
  }, [entries]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset selection + form state whenever the dialog opens or the
  // available entries change (e.g. mode flip). Default to the first
  // picker so the right pane is never empty.
  useEffect(() => {
    if (!open) return;
    setInputValue('');
    setValidationError(null);
    setInFlight(false);
    setSelectedId((prev) => {
      if (prev && entries.some((e) => e.picker.id === prev)) return prev;
      return entries[0]?.picker.id ?? null;
    });
  }, [open, entries]);

  const selected = useMemo(
    () => entries.find((e) => e.picker.id === selectedId) ?? null,
    [entries, selectedId],
  );

  // Auto-focus: the input if the picker has one, otherwise the Go
  // button so Enter fires the picker.
  useEffect(() => {
    if (!open || !selected) return;
    if (selected.picker.input) {
      inputRef.current?.focus();
    }
  }, [open, selected]);

  if (!open) return null;

  const title = mode === 'new' ? 'New noggin' : 'Open noggin';

  const goLabel = selected?.picker.input
    ? (mode === 'new' ? 'Create' : 'Open')
    : selected?.picker.label ?? 'Continue';

  async function submit() {
    if (!selected || inFlight) return;
    const picker = selected.picker;
    let value: string | undefined;
    if (picker.input) {
      const trimmed = inputValue.trim();
      const err = picker.input.validate?.(trimmed);
      if (err) { setValidationError(err); return; }
      value = trimmed;
    }
    setInFlight(true);
    try {
      await picker.onSelect(value);
      onClose();
    } catch (err) {
      // Picker-side errors bubble to the surrounding host's error
      // channel already (via wrapOpen in providers.ts). Still clear
      // in-flight so the user can try again from inside the dialog.
      setInFlight(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal noggin-open-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        role="dialog"
        aria-labelledby="noggin-open-dialog-title"
        aria-modal="true"
      >
        <div className="noggin-open-header">
          <span className="noggin-open-title" id="noggin-open-dialog-title">{title}</span>
        </div>

        <div className="noggin-open-body">
          {/* Left: picker nav */}
          <nav className="noggin-open-nav" aria-label="Sources">
            {groups.length === 0 && (
              <div className="noggin-open-empty">
                No {mode === 'new' ? 'creators' : 'openers'} are registered.
              </div>
            )}
            {groups.map(([scheme, groupEntries]) => (
              <div key={scheme} className="noggin-open-nav-group">
                <div className="noggin-open-nav-head">
                  <span className={`noggin-list-badge noggin-list-badge--${groupEntries[0].provider.badgeTone}`}>
                    {scheme}
                  </span>
                  <span className="noggin-open-nav-head-label">{groupEntries[0].provider.label}</span>
                </div>
                {groupEntries.map(({ picker }) => {
                  const isSelected = picker.id === selectedId;
                  return (
                    <button
                      type="button"
                      key={picker.id}
                      className={`noggin-open-nav-item${isSelected ? ' noggin-open-nav-item--selected' : ''}`}
                      onClick={() => setSelectedId(picker.id)}
                      aria-current={isSelected}
                    >
                      <Icon name={picker.icon} className="noggin-open-nav-icon" />
                      <span className="noggin-open-nav-label">{picker.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Right: detail + form */}
          <section className="noggin-open-detail">
            {selected ? (
              <>
                <div className="noggin-open-detail-head">
                  <Icon name={selected.picker.icon} className="noggin-open-detail-icon" />
                  <div className="noggin-open-detail-heading">
                    <div className="noggin-open-detail-label">{selected.picker.label}</div>
                    {selected.picker.hint && (
                      <div className="noggin-open-detail-hint">{selected.picker.hint}</div>
                    )}
                  </div>
                </div>

                {selected.picker.input ? (
                  <form
                    className="noggin-open-form"
                    onSubmit={(e) => { e.preventDefault(); void submit(); }}
                  >
                    <label className="noggin-open-form-label">
                      {selected.picker.input.label ?? 'Value'}
                      <input
                        ref={inputRef}
                        className="modal-input"
                        type={selected.picker.input.kind === 'url' ? 'url' : 'text'}
                        placeholder={selected.picker.input.placeholder}
                        value={inputValue}
                        onChange={(e) => {
                          setInputValue(e.target.value);
                          if (validationError) setValidationError(null);
                        }}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    {validationError && (
                      <div className="noggin-open-form-error" role="alert">{validationError}</div>
                    )}
                  </form>
                ) : (
                  <div className="noggin-open-detail-body">
                    <div className="noggin-open-detail-body-note">
                      {mode === 'new'
                        ? 'The system save dialog will appear next.'
                        : 'The system file dialog will appear next.'}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="noggin-open-empty">Pick a source on the left.</div>
            )}
          </section>
        </div>

        <div className="noggin-open-footer modal-buttons">
          <button type="button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="primary"
            disabled={!selected || inFlight}
            onClick={() => { void submit(); }}
          >
            {inFlight ? 'Working…' : goLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
