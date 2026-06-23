// Details pane: shows the selected (or active) item's metadata and
// notes, with an inline note-append composer at the bottom.

import { useCallback, useState, useEffect } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from './Icon';
import type { TreeNode } from './Tree';

export interface DetailsProps {
  node: TreeNode | null;
  /** Whether the details pane is currently visible. */
  visible: boolean;
  onAppendNote: (path: string, text: string) => void;
  onToggleDone: (path: string, currentlyDone: boolean) => void;
  onGoto: (path: string) => void;
  onClose: () => void;
}

export function Details({ node, visible, onAppendNote, onToggleDone, onGoto, onClose }: DetailsProps) {
  const [draft, setDraft] = useState('');

  useEffect(() => { setDraft(''); }, [node?.path]);

  const submit = useCallback(() => {
    const t = draft.trim();
    if (!t || !node) return;
    onAppendNote(node.path, t);
    setDraft('');
  }, [draft, node, onAppendNote]);

  if (!visible) return null;

  if (!node) {
    return (
      <aside className="details" aria-label="Details">
        <div className="details-header">
          <span className="details-title">Details</span>
          <button className="iconbtn" onClick={onClose} title="Hide details">
            <Icon name="close" />
          </button>
        </div>
        <div className="details-empty">Select an item to see its notes and metadata.</div>
      </aside>
    );
  }

  return (
    <aside className="details" aria-label="Details">
      <div className="details-header">
        <span className="details-title">
          <span className="path-chip">{node.path}</span>
          <span className="details-item-title">{node.title}</span>
        </span>
        <button className="iconbtn" onClick={onClose} title="Hide details">
          <Icon name="close" />
        </button>
      </div>

      <div className="details-meta">
        <button
          className={`pill${node.done ? ' pill-done' : ''}`}
          onClick={() => onToggleDone(node.path, node.done)}
          title={node.done ? 'Reopen' : 'Mark done'}
        >
          {node.done ? <><Icon name="check" /> done</> : <>open</>}
        </button>
        <button className="pill" onClick={() => onGoto(node.path)} title="Make active">
          <Icon name="target" /> goto
        </button>
      </div>

      <div className="details-section-title">
        Notes {node.notes && node.notes.length > 0 ? `(${node.notes.length})` : ''}
      </div>

      <ul className="notes-list">
        {(!node.notes || node.notes.length === 0) && (
          <li className="note-empty">No notes yet.</li>
        )}
        {node.notes?.map((n, i) => (
          <li key={`${n.timestamp}-${i}`} className="note">
            <div className="note-timestamp">{formatNoteTimestamp(n.timestamp)}</div>
            <div className="note-body">{n.text}</div>
          </li>
        ))}
      </ul>

      <form
        className="note-composer"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Append a note… (Ctrl+Enter)"
          onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
          rows={3}
        />
        <div className="note-composer-actions">
          <button type="submit" disabled={!draft.trim()}>Append</button>
        </div>
      </form>
    </aside>
  );
}

function formatNoteTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return ts;
  }
}
