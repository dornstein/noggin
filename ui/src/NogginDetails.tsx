// Details pane. Shows the selected (or active) item's metadata, notes
// (markdown-rendered), and an inline note editor. Lifted in spirit
// from extension/src/detailsView.ts but rewritten as React.

import { useState } from 'react';
import type { NogginDetailsItem } from './types';
import { renderMarkdown } from './markdown';
import { NogginNoteEditor } from './NogginNoteEditor';
import { Icon } from './Icon';

export interface NogginDetailsHandlers {
  onToggleDone: (path: string, currentlyDone: boolean) => void;
  onGoto: (path: string) => void;
  onAppendNote: (path: string, markdown: string) => void;
  onRetitle?: (path: string, title: string) => void;
  onReorderUp?: (path: string) => void;
  onReorderDown?: (path: string) => void;
}

export interface NogginDetailsProps extends NogginDetailsHandlers {
  /** The selected (or active fallback) item; null when nothing's selected. */
  item: NogginDetailsItem | null;
}

export function NogginDetails({
  item,
  onToggleDone,
  onGoto,
  onAppendNote,
  onRetitle,
  onReorderUp,
  onReorderDown,
}: NogginDetailsProps) {
  const [composing, setComposing] = useState(false);
  const [renaming, setRenaming] = useState(false);

  if (!item) {
    return (
      <div className="noggin-details">
        <div className="noggin-details-empty">
          Select an item in the tree to see its notes and metadata.
        </div>
      </div>
    );
  }

  return (
    <div className="noggin-details">
      <div className="noggin-details-title-row">
        <button
          className={'noggin-details-state-icon ' + (item.done ? 'done' : 'open')}
          onClick={() => onToggleDone(item.path, item.done)}
          title={item.done ? 'Reopen' : 'Mark done'}
          aria-pressed={item.done}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            {item.done ? (
              <>
                <circle cx="8" cy="8" r="7" fill="currentColor" />
                <path d="M11.78 5.72a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L4.22 8.78a.75.75 0 1 1 1.06-1.06L7 9.44l3.72-3.72a.75.75 0 0 1 1.06 0Z" fill="var(--noggin-bg, #1e1e1e)" />
              </>
            ) : (
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none" />
            )}
          </svg>
        </button>

        <span className="noggin-details-title-path">{item.path}</span>

        {renaming && onRetitle ? (
          <input
            className="noggin-details-title-edit"
            autoFocus
            defaultValue={item.title}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim();
              setRenaming(false);
              if (v && v !== item.title) onRetitle(item.path, v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = e.currentTarget.value.trim();
                setRenaming(false);
                if (v && v !== item.title) onRetitle(item.path, v);
              }
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <h2
            className="noggin-details-title"
            onClick={() => { if (onRetitle) setRenaming(true); }}
            title={onRetitle ? 'Click to rename' : undefined}
          >
            {item.title || '(untitled)'}
          </h2>
        )}
      </div>

      <div className="noggin-details-actions">
        {!item.isActive && (
          <button type="button" onClick={() => onGoto(item.path)} title="Make this the active item">
            <Icon name="target" /> Goto
          </button>
        )}
        {onReorderUp && (
          <button
            type="button"
            onClick={() => onReorderUp(item.path)}
            disabled={!item.hasPrevSibling}
            title="Move before previous sibling"
          >
            <Icon name="arrow-up" /> Up
          </button>
        )}
        {onReorderDown && (
          <button
            type="button"
            onClick={() => onReorderDown(item.path)}
            disabled={!item.hasNextSibling}
            title="Move after next sibling"
          >
            <Icon name="arrow-down" /> Down
          </button>
        )}
      </div>

      <h3 className="noggin-details-section">
        Notes {item.notes.length > 0 ? `(${item.notes.length})` : ''}
      </h3>

      {item.notes.length === 0 && !composing && (
        <p className="noggin-no-notes">No notes yet.</p>
      )}

      <ul className="noggin-notes-list">
        {item.notes.map((n, i) => {
          const isSystem = n.text === 'closed' || n.text === 'reopened';
          return (
            <li key={`${n.timestamp}-${i}`} className={'noggin-note' + (isSystem ? ' system' : '')}>
              <div className="noggin-note-ts">{formatTs(n.timestamp)}</div>
              <div
                className="noggin-note-body markdown-body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(n.text) }}
              />
            </li>
          );
        })}
      </ul>

      {composing ? (
        <NogginNoteEditor
          onSubmit={(text) => {
            onAppendNote(item.path, text);
            setComposing(false);
          }}
          onCancel={() => setComposing(false)}
        />
      ) : (
        <button
          type="button"
          className="noggin-add-note-affordance"
          onClick={() => setComposing(true)}
        >
          <Icon name="add" /> Add note…
        </button>
      )}
    </div>
  );
}

function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    const diff = Date.now() - d.getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
    const days = Math.floor(h / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return ts;
  }
}
