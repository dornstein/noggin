// Public surface of @noggin/ui. Hosts import from here.
//
// Imports of plain `.ts` siblings carry explicit `.js` extensions so
// this file is consumable from TypeScript projects under
// `moduleResolution: node16/nodenext` (the VS Code extension's
// tsconfig). The `.tsx` component imports are left bare on purpose —
// adding `.js` would force consumers to set `"jsx"` in their tsconfig
// even when they only ever pull in pure-data types. Bundler resolution
// in ui's own tsconfig and in vite/esbuild bundles accepts both forms.

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
export {
  createNogginActions,
} from './actions';
export type {
  NogginActions,
  NogginItemKey,
  CreateNogginActionsOptions,
  RenameResult,
  ToggleDoneResult,
  DeleteResult,
  AddResult,
  MoveResult,
  ActivateResult,
  AppendNoteResult,
} from './actions';
export { buildTreeMenuEntries } from './buildTreeMenuEntries';
export type { BuildTreeMenuEntriesOptions } from './buildTreeMenuEntries';
export { cn } from './cn.js';
export type {
  NogginNode,
  NogginNoteData,
  NogginDetailsItem,
  NogginMoveIntent,
  TreeContextMenuEntry,
  TreeContextMenuRenderProps,
} from './types.js';
export { renderMarkdown } from './markdown.js';
export {
  projectTree,
  findByPath,
  siblingsOf,
  parentOf,
  prevSibling,
  nextSibling,
  firstSibling,
  lastSibling,
} from './treeOps.js';
// `RemoteNoggin` (and its `openRemoteNoggin` helper) live in
// `@noggin/rpc` \u2014 hosts that need it import from there directly so
// engine code (which imports `node:crypto`) never enters the
// browser-bundled barrel graph.

export { uiErrorMessage } from './errors.js';
export type { RenderableError } from './errors.js';
