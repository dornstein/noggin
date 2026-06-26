// Details pane. Shows the selected (or active) item's metadata, notes
// (markdown-rendered), and an inline note editor. Lifted in spirit
// from extension/src/detailsView.ts but rewritten as React.

import { useState } from 'react';
import type { NogginDetailsItem, TreeGesture } from './types';
import { renderMarkdown } from './markdown';
import { NogginNoteEditor } from './NogginNoteEditor';
import { Icon } from './Icon';
import { gestureForKey } from './NogginTree';
import { cn } from './cn';

/**
 * @public
 * Optional class-name overrides for {@link NogginDetails}.
 */
export interface NogginDetailsClassNames {
  /** Outer pane wrapper. */
  root?: string;
  /** Row containing the state icon, title, and action buttons. */
  header?: string;
  /** The item title element. */
  title?: string;
  /** The dotted-path caption under the title. */
  path?: string;
  /** The notes list (`<ul>`). */
  notes?: string;
  /** Each individual note item (`<li>`). */
  noteItem?: string;
  /** The "Add note" affordance button (collapsed state). */
  addNote?: string;
}

export interface NogginDetailsHandlers {
  onToggleDone: (path: string, currentlyDone: boolean) => void;
  onGoto: (path: string) => void;
  onAppendNote: (path: string, markdown: string) => void;
  onRetitle?: (path: string, title: string) => void;
  /** Open a contextual actions menu anchored at the given viewport
   *  coordinates. Host typically reuses the same menu rendered for
   *  tree-row right-click so users have one place to find every
   *  action. When omitted, the overflow button is hidden. */
  onOpenMenu?: (x: number, y: number, path: string) => void;
  /** Run a tree gesture against this item. Wired so the details pane
   *  responds to the same keyboard shortcuts as the tree (Enter,
   *  Ctrl+Enter, Alt+arrows, etc.) when focus is inside the pane but
   *  not in a text input or button. */
  onGesture?: (path: string, gesture: TreeGesture) => void;
  /** Collapse the entire pane. When omitted, the chevron is hidden. */
  onCollapse?: () => void;
  /** Codicon name for the collapse chevron \u2014 host picks based on the
   *  pane's docked direction (right vs below). Default 'chevron-right'. */
  collapseIcon?: string;
}

export interface NogginDetailsProps extends NogginDetailsHandlers {
  /** The selected (or active fallback) item; null when nothing's selected. */
  item: NogginDetailsItem | null;
  /** Per-slot class-name overrides. See {@link NogginDetailsClassNames}. */
  classNames?: NogginDetailsClassNames;
}

// Gestures we deliberately do NOT handle when focus is inside the
// details pane. Tab / Shift+Tab move focus among the pane's buttons
// (Make active, kebab, Add note) and stealing them would surprise
// users who are navigating within the pane.
const PANE_SKIP: ReadonlySet<TreeGesture> = new Set(['demote', 'promote']);

export function NogginDetails({
  item,
  onToggleDone,
  onGoto,
  onAppendNote,
  onRetitle,
  onOpenMenu,
  onGesture,
  onCollapse,
  collapseIcon = 'chevron-right',
  classNames,
}: NogginDetailsProps) {
  const [composing, setComposing] = useState(false);
  const [renaming, setRenaming] = useState(false);

  if (!item) {
    return (
      <div className={cn('noggin-details', classNames?.root)}>
        <div className="noggin-details-empty">
          Select an item in the tree to see its notes and metadata.
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn('noggin-details', classNames?.root)}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (!onGesture) return;
        // Defer to interactive descendants. Inputs / textareas handle
        // their own keys (rename input has its own auto-commit logic;
        // the note editor is CodeMirror). Buttons handle Enter/Space
        // as click. We only act on keys that bubbled past all of
        // those.
        const t = e.target as HTMLElement | null;
        if (!t) return;
        if (/^(INPUT|TEXTAREA|BUTTON)$/.test(t.tagName)) return;
        if (t.isContentEditable) return;
        const gesture = gestureForKey(e.nativeEvent);
        if (!gesture || PANE_SKIP.has(gesture)) return;
        // Rename is the keyboard form of "click the title". Route
        // locally instead of asking the host to round-trip.
        if (gesture === 'rename') {
          e.preventDefault();
          e.stopPropagation();
          if (onRetitle) setRenaming(true);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onGesture(item.path, gesture);
      }}
    >
      <div className={cn('noggin-details-title-row', classNames?.header)}>
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
                <path d="M11.78 5.72a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L4.22 8.78a.75.75 0 1 1 1.06-1.06L7 9.44l3.72-3.72a.75.75 0 0 1 1.06 0Z" fill="var(--noggin-canvas-bg)" />
              </>
            ) : (
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none" />
            )}
          </svg>
        </button>

        {renaming && onRetitle ? (
          <div className="noggin-details-title-col">
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
            <span className={cn('noggin-details-title-path', classNames?.path)}>{item.path}</span>
          </div>
        ) : (
          <div className="noggin-details-title-col">
            <h2
              className={cn('noggin-details-title', !item.title && 'untitled', classNames?.title)}
              onClick={() => { if (onRetitle) setRenaming(true); }}
              title={onRetitle ? 'Click to rename' : undefined}
            >
              {item.title || '(untitled)'}
            </h2>
            <span className={cn('noggin-details-title-path', classNames?.path)}>{item.path}</span>
          </div>
        )}

        <div className="noggin-details-row-actions">
          {onOpenMenu && (
            <button
              type="button"
              className="noggin-details-iconbtn noggin-details-menu-btn"
              onClick={(e) => {
                // Anchor the menu at the button's bottom-left corner
                // so it drops down nicely instead of appearing under
                // the cursor.
                const r = e.currentTarget.getBoundingClientRect();
                onOpenMenu(r.left, r.bottom + 2, item.path);
              }}
              title="Actions"
              aria-label="Item actions"
              aria-haspopup="menu"
            >
              <Icon name="kebab-vertical" />
            </button>
          )}
          {onCollapse && (
            <button
              type="button"
              className="noggin-details-iconbtn noggin-details-collapse-btn"
              onClick={onCollapse}
              title="Collapse details pane"
              aria-label="Collapse details pane"
            >
              <Icon name={collapseIcon} />
            </button>
          )}
        </div>
      </div>

      {!item.isActive && (
        <div className="noggin-details-actions">
          <button
            type="button"
            className="noggin-details-primary"
            onClick={() => onGoto(item.path)}
            title="Make this the active item"
          >
            <Icon name="pinned" /> <span>Make active</span>
          </button>
        </div>
      )}

      <ul className={cn('noggin-notes-list', classNames?.notes)}>
        {item.notes.map((n, i) => (
          <li key={`${n.timestamp}-${i}`} className={cn('noggin-note', classNames?.noteItem)}>
            <div className="noggin-note-ts">{formatTs(n.timestamp)}</div>
            <div
              className="noggin-note-body markdown-body"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(n.text) }}
            />
          </li>
        ))}
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
          className={cn('noggin-add-note-affordance', classNames?.addNote)}
          onClick={() => setComposing(true)}
        >
          <Icon name="add" /> <span>Add note</span>
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
