// Details pane. Shows the selected (or active) item's metadata, notes
// (markdown-rendered), and an inline note editor. Lifted in spirit
// from extension/src/detailsView.ts but rewritten as React.

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  NogginDetailsItem,
  TreeContextMenuEntry,
  TreeContextMenuRenderProps,
  TreeGesture,
} from './types';
import { renderMarkdown } from './markdown';
import { NogginNoteEditor } from './NogginNoteEditor';
import { Icon } from './Icon';
import { gestureForKey } from './NogginTree';
import { cn } from './cn';
import { DetailsActionsMenu } from './internal/TreeContextMenuView';
import type { NogginActions } from './actions';
import { buildTreeMenuEntries } from './buildTreeMenuEntries';

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
  /** Collapse the entire pane. When omitted, the chevron is hidden. */
  onCollapse?: () => void;
  /** Codicon name for the collapse chevron — host picks based on the
   *  pane's docked direction (right vs below). Default 'chevron-right'. */
  collapseIcon?: string;
}

export interface NogginDetailsProps extends NogginDetailsHandlers {
  /** The selected (or active fallback) item; null when nothing's selected. */
  item: NogginDetailsItem | null;
  /**
   * The verb-dispatch surface. Built via
   * {@link import('./actions').createNogginActions} from a `Noggin`,
   * or provided directly by the host. Every action this pane
   * initiates — retitle, toggle-done, note-append, goto,
   * kebab-menu picks, keyboard gestures — goes through it.
   */
  actions: NogginActions;
  /**
   * Optional render override for the actions menu (mirrors
   * `NogginTree`'s prop of the same name). Lets a host render a
   * platform-native popup while keeping the contents canonical.
   */
  renderContextMenu?: (props: TreeContextMenuRenderProps) => ReactNode;
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
  actions,
  onCollapse,
  collapseIcon = 'chevron-right',
  renderContextMenu,
  classNames,
}: NogginDetailsProps) {
  const [composing, setComposing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // Imperative menu state is ONLY used when the host provides a
  // renderContextMenu override. The default path uses
  // <DetailsActionsMenu> (Radix DropdownMenu) which owns its open
  // state internally.
  const usingHostMenu = !!renderContextMenu;
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  const closeMenu = () => setMenuPos(null);

  /** Build the canonical entries for the current item. Shared by both
   *  paths so labels / disabled state stay identical. */
  const buildEntriesForItem = (onAfterClick: () => void): readonly TreeContextMenuEntry[] => {
    if (!item) return [];
    return buildTreeMenuEntries({
      actions,
      key: item.key,
      onRequestRename: () => { setRenaming(true); },
    }).map((entry) => entry.kind === 'item'
      ? { ...entry, onClick: () => { entry.onClick(); onAfterClick(); } }
      : entry);
  };

  const hostMenuEntries = useMemo<readonly TreeContextMenuEntry[] | null>(() => {
    if (!menuPos) return null;
    return buildEntriesForItem(closeMenu);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuPos, item, actions]);

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
          setRenaming(true);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (gesture === 'toggleDone') {
          void actions.toggleDone(item.key, item.done);
          return;
        }
        if (gesture === 'delete') {
          void actions.delete(item.key, false);
          return;
        }
        void dispatchPaneGesture(actions, item.key, gesture);
      }}
    >
      <div className={cn('noggin-details-title-row', classNames?.header)}>
        <button
          className={'noggin-details-state-icon ' + (item.done ? 'done' : 'open')}
          onClick={() => void actions.toggleDone(item.key, item.done)}
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

        {renaming ? (
          <div className="noggin-details-title-col">
            <input
              className="noggin-details-title-edit"
              autoFocus
              defaultValue={item.title}
              onBlur={(e) => {
                const v = e.currentTarget.value.trim();
                setRenaming(false);
                if (v && v !== item.title) void actions.rename(item.key, v);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = e.currentTarget.value.trim();
                  setRenaming(false);
                  if (v && v !== item.title) void actions.rename(item.key, v);
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
              onClick={() => setRenaming(true)}
              title="Click to rename"
            >
              {item.title || '(untitled)'}
            </h2>
            <span className={cn('noggin-details-title-path', classNames?.path)}>{item.path}</span>
          </div>
        )}

        <div className="noggin-details-row-actions">
          {usingHostMenu ? (
              <button
                type="button"
                className="noggin-details-iconbtn noggin-details-menu-btn"
                onClick={(e) => {
                  // Anchor the menu at the button's bottom-left corner
                  // so it drops down nicely instead of appearing under
                  // the cursor.
                  const r = e.currentTarget.getBoundingClientRect();
                  setMenuPos({ x: r.left, y: r.bottom + 2 });
                }}
                title="Actions"
                aria-label="Item actions"
                aria-haspopup="menu"
              >
                <Icon name="kebab-vertical" />
              </button>
            ) : (
              <DetailsActionsMenu
                buildEntries={() => buildEntriesForItem(() => { /* Radix dismisses itself */ })}
              />
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
            onClick={() => void actions.activate(item.key)}
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
            void actions.appendNote(item.key, text);
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
      {/* Host-override path only. The Radix DropdownMenu mounts its
          own popup inside <DetailsActionsMenu> above. */}
      {usingHostMenu && hostMenuEntries && menuPos && renderContextMenu?.({
        position: menuPos,
        entries: hostMenuEntries,
        onClose: closeMenu,
      })}
    </div>
  );
}

/**
 * Route a TreeGesture from the details pane to the corresponding
 * named action method. Mirror of NogginTree's keyboard dispatcher
 * for the actions surface (the details pane never wants the
 * tree's rename / focus-restoration UI moves \u2014 it just fires
 * the verb and lets the host's selection effect react).
 */
async function dispatchPaneGesture(
  actions: NogginActions,
  key: string,
  gesture: TreeGesture,
): Promise<void> {
  switch (gesture) {
    case 'addSiblingAfter':  await actions.addSiblingAfter(key); return;
    case 'addSiblingBefore': await actions.addSiblingBefore(key); return;
    case 'addChild':         await actions.addChild(key); return;
    case 'addFirstSibling':  await actions.addFirstSibling(key); return;
    case 'addLastSibling':   await actions.addLastSibling(key); return;
    case 'moveUp':           await actions.moveUp(key); return;
    case 'moveDown':         await actions.moveDown(key); return;
    case 'moveToFirst':      await actions.moveToFirst(key); return;
    case 'moveToLast':       await actions.moveToLast(key); return;
    case 'demote':           await actions.demote(key); return;
    case 'promote':          await actions.promote(key); return;
    case 'toggleDone':       // handled inline by caller
    case 'delete':           // handled inline by caller
    case 'rename':           // handled inline by caller
    case 'activate':         // handled inline by caller (the details pane's "Make active" button)
      return;
  }
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
