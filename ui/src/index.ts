// Public surface of @noggin/ui. Hosts import from here.

export { Icon } from './Icon';
export { NogginTree, gestureForKey, shouldInterceptFromRename } from './NogginTree';
export type {
  NogginTreeProps,
  NogginTreeHandlers,
  NogginTreeClassNames,
} from './NogginTree';
export { NogginDetails } from './NogginDetails';
export type {
  NogginDetailsProps,
  NogginDetailsHandlers,
  NogginDetailsClassNames,
} from './NogginDetails';
export { NogginNoteEditor } from './NogginNoteEditor';
export type {
  NogginNoteEditorProps,
  NogginNoteEditorClassNames,
} from './NogginNoteEditor';
export { NogginQuickAdd } from './NogginQuickAdd';
export type {
  NogginQuickAddProps,
  NogginQuickAddClassNames,
} from './NogginQuickAdd';
export { NogginContextMenu } from './NogginContextMenu';
export type {
  NogginContextMenuItem,
  NogginContextMenuEntry,
  NogginContextMenuClassNames,
} from './NogginContextMenu';
export { cn } from './cn';
export type {
  NogginNode,
  NogginNoteData,
  NogginDetailsItem,
  NogginMoveIntent,
  TreeGesture,
} from './types';
export { renderMarkdown } from './markdown';
export {
  findByPath,
  siblingsOf,
  parentOf,
  prevSibling,
  nextSibling,
  firstSibling,
  lastSibling,
} from './treeOps';
// `executeGesture` and the RemoteNoggin adapter both live behind
// subpath exports (`@noggin/ui/gestures`, `@noggin/ui/remote`) so
// engine code (which imports node:crypto) doesn't enter the barrel
// graph for browser-bundled consumers like the VS Code extension
// webview.

export { uiErrorMessage } from './errors';
export type { RenderableError } from './errors';
