// Wire protocol between the extension host and the tree webview.
// Both sides import these types; only the host imports them as runtime values
// (they are pure types — no runtime behavior).

export interface TreeNodeData {
  /** Stable opaque item key. Used as the arborist node id. */
  id: string;
  /** Absolute 1-based path at snapshot time. */
  path: string;
  title: string;
  done: boolean;
  /** Number of timestamped notes (controls the ✏️ decoration). */
  noteCount: number;
  /** Always present, may be empty. arborist treats [] as a leaf vs a folder. */
  children: TreeNodeData[];
}

export interface TreeSnapshot {
  /** True iff a noggin file is open. */
  isOpen: boolean;
  /** Path of the active item, or null. */
  activePath: string | null;
  /** Stable identifier for the open file; the webview resets state when it changes. */
  fileId: string | null;
  roots: TreeNodeData[];
}

/** Messages host → webview. */
export type HostMessage =
  | { type: 'snapshot'; snapshot: TreeSnapshot };

/** Messages webview → host. */
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'invoke'; command: 'noggin.goto' | 'noggin.toggleDone' | 'noggin.addChild' | 'noggin.delete' | 'noggin.note' | 'noggin.retitle' | 'noggin.addBefore' | 'noggin.addAfter'; path: string }
  | { type: 'invoke'; command: 'noggin.push' | 'noggin.add' | 'noggin.openFile' | 'noggin.new' | 'noggin.openWorkspaceNoggin'; path?: undefined }
  /**
   * Drag-and-drop move. The webview reports the raw arborist intent plus the
   * cursor visual type at drop time. The host translates keys+index+cursor
   * into a noggin placement; doing the disambiguation host-side means we can
   * apply it against the live store (avoids stale-path races mid-drag).
   */
  | { type: 'move'; dragKeys: string[]; parentKey: string | null; index: number; cursorType: 'line' | 'highlight' };
