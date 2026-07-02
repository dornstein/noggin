/**
 * Shape of a tree node the components consume. Mirrors the engine's
 * ViewNode but only the fields the UI actually renders, so callers
 * can adapt their own snapshots to it without coupling to the engine
 * type directly.
 */
export interface NogginNode {
  /** Stable opaque key. Used as the react-arborist node id. */
  key: string;
  /** Display label / breadcrumb path (1-based, slash-separated). */
  path: string;
  /** The item's title. */
  title: string;
  /** Lifecycle state. */
  done: boolean;
  /** Number of notes attached. */
  noteCount: number;
  /** Children (recursive). Empty array = leaf in the arborist sense. */
  children: NogginNode[];
}

/** A timestamped, append-only note. Markdown body. */
export interface NogginNoteData {
  timestamp: string;
  text: string;
}

/** Item shape the details pane expects. Subset of the engine's Item. */
export interface NogginDetailsItem {
  key: string;
  path: string;
  title: string;
  done: boolean;
  notes: NogginNoteData[];
  /** Whether this item is the active item right now. */
  isActive: boolean;
  /** Whether the item has a previous / next sibling (for reorder buttons). */
  hasPrevSibling: boolean;
  hasNextSibling: boolean;
}

/** A move intent the tree emits on drag-drop. */
export interface NogginMoveIntent {
  /** Path of the item being moved (snapshot at drag-start). */
  fromPath: string;
  /** Whether the user dropped the item between rows (line) or onto a row. */
  kind: 'before' | 'after' | 'into';
  /** Path of the anchor row the drop targeted. */
  anchorPath: string;
}

/**
 * Keyboard gestures the tree forwards to the host when a row has focus.
 *
 * Naming convention:
 *   - `addX` gestures create a new item relative to the focused row.
 *     Hosts typically run a verb, capture the new item's key, and
 *     switch the new row into inline-rename mode.
 *   - `moveX` gestures relocate the focused row. The host should keep
 *     selection/focus on the moved item afterwards.
 *   - `delete`, `toggleDone`, `rename` are local edits of the focused row.
 */
export type TreeGesture =
  | 'addSiblingAfter'   // Enter
  | 'addSiblingBefore'  // Shift+Enter
  | 'addChild'          // Ctrl+Enter
  | 'addFirstSibling'   // Ctrl+Home  (new item becomes first among focused row's siblings)
  | 'addLastSibling'    // Ctrl+End   (new item becomes last among focused row's siblings)
  | 'moveUp'            // Alt+Up
  | 'moveDown'          // Alt+Down
  | 'demote'            // Tab        (nest under previous sibling)
  | 'promote'           // Shift+Tab  (out to parent's level)
  | 'moveToFirst'       // Alt+Home
  | 'moveToLast'        // Alt+End
  | 'rename'            // F2
  | 'toggleDone'        // Space
  | 'delete';           // Delete

/**
 * @public
 * One entry in the tree's right-click context menu (and the details
 * pane's actions menu). The menu vocabulary is owned by `NogginTree`
 * and `NogginDetails` — hosts receive these via the optional
 * `renderContextMenu` prop and decide how to display them, but they
 * cannot construct, reorder, or relabel entries.
 *
 * Kinds:
 *   - `'item'`: a real menu item. Call `onClick()` to run the
 *     action; the component dismisses itself.
 *   - `'checkbox'`: a toggleable item with a tick on the left when
 *     `checked` is true. `onCheckedChange(next)` fires the toggle.
 *   - `'radio'`: identical look to `checkbox` but semantically a
 *     mutually-exclusive choice within a group. `groupKey` ties the
 *     radios together; only the entry whose `value` matches
 *     `groupValue` renders selected. `onSelectValue(value)` fires
 *     the choice.
 *   - `'header'`: an in-menu section label. Not interactive.
 *   - `'separator'`: a visual separator.
 */
export type TreeContextMenuEntry =
  | {
      readonly kind: 'item';
      readonly key: string;
      readonly label: string;
      /** Codicon name. */
      readonly icon?: string;
      /** Display-only keyboard shortcut hint, e.g. `'Ctrl+Enter'`. */
      readonly shortcut?: string;
      /** Render as a destructive action (red text). */
      readonly danger?: boolean;
      /** Grey out; clicks ignored. */
      readonly disabled?: boolean;
      /** Run the verb AND dismiss the menu. Idempotent if `disabled`. */
      readonly onClick: () => void;
    }
  | {
      readonly kind: 'checkbox';
      readonly key: string;
      readonly label: string;
      readonly checked: boolean;
      readonly disabled?: boolean;
      readonly shortcut?: string;
      /** Fires with the new state. The menu stays open after a toggle
       *  so the user can flip several at once. */
      readonly onCheckedChange: (next: boolean) => void;
    }
  | {
      readonly kind: 'radio';
      readonly key: string;
      readonly label: string;
      /** Identifies the mutually-exclusive group. Every radio in a
       *  contiguous block sharing a `groupKey` is one group; the
       *  consumer hands back the selected `value` via
       *  `onSelectValue`. */
      readonly groupKey: string;
      readonly value: string;
      /** The currently-selected value within `groupKey`. Set this to
       *  the same value on every radio in the group so the rendered
       *  state is consistent. */
      readonly groupValue: string;
      readonly disabled?: boolean;
      readonly onSelectValue: (value: string) => void;
    }
  | {
      readonly kind: 'header';
      readonly key: string;
      readonly label: string;
    }
  | {
      readonly kind: 'separator';
      readonly key: string;
    };

/**
 * @public
 * Argument bag passed to a host's `renderContextMenu` override on
 * `NogginTree` / `NogginDetails`. The host renders the popup however
 * it wants (native VS Code menu, custom themed popup, mobile sheet,
 * etc.) and dispatches `entry.onClick()` when the user picks an
 * item. The host must call `onClose()` when dismissed without a pick
 * (outside-click, Escape, blur). Item picks dismiss automatically.
 */
export interface TreeContextMenuRenderProps {
  /** Viewport-relative anchor in CSS pixels. Pre-clamped by the caller. */
  readonly position: { x: number; y: number };
  /** The canonical menu entries the surrounding component produced. */
  readonly entries: readonly TreeContextMenuEntry[];
  /** Dismiss the menu without firing any action. */
  readonly onClose: () => void;
}

