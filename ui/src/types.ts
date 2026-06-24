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
