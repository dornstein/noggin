// @noggin/ui/errors — host-side error catalog for React UI consumers.
//
// Engine errors carry a stable `code` and a structured `data` payload
// (see `engine/noggin-api.d.mts`). This module turns those into the
// short user-facing strings the noggin webview (VS Code extension)
// and the desktop renderer render in banners, modals, and toasts.
//
// The CLI has its own catalog at `cli/error-messages.mjs` because its
// users speak `--flag` vocabulary. This catalog is for clickable UIs:
// it references gestures the user actually performs in the tree (drag,
// right-click, keyboard chords) rather than command-line switches.

import type { NogginErrorData } from '../../skills/noggin/noggin-api.mjs';

/** Shape of the engine error we render from. Mirrors the engine's
 *  `NogginError` + the `error` object inside a JSON envelope. */
export interface RenderableError {
  readonly code: string;
  readonly message: string;
  readonly data?: NogginErrorData;
}

/**
 * @public
 * Render an engine error as a user-friendly string suitable for a
 * UI banner / toast / modal. Falls back to the engine's `message`
 * when the code isn't in this catalog — that string is host-neutral
 * and short, but not necessarily polished.
 */
export function uiErrorMessage(err: RenderableError): string {
  const { code, message, data = {} } = err;
  switch (code) {
    case 'no-active-item':
      return 'No active item. Select an item in the tree first.';

    case 'no-location':
      return 'No noggin file specified.';

    case 'no-provider':
      if (data.scheme) return `No provider for ${data.scheme}://`;
      return 'Could not open this noggin (no default provider registered).';

    case 'path-not-found':
      return `Item not found: ${data.path ?? '(unknown)'}.`;

    case 'path-required':
      return 'No target item selected.';

    case 'cycle': {
      const title = data.title || 'this item';
      if (data.placementKind === 'into') {
        return `Can't move "${title}" into itself or a child of itself.`;
      }
      return `Can't move "${title}" next to a child of itself.`;
    }

    case 'placement-missing':
      return 'Choose where the item should go (before, after, or into).';

    case 'placement-invalid':
      return `Unknown placement: ${data.kind}.`;

    case 'title-required':
      return 'Title required.';

    case 'text-required':
      return 'Note text required.';

    case 'nothing-to-edit':
      return 'Nothing to change.';

    case 'option-misused':
      return message;

    case 'goto-unsupported':
      return `This verb doesn't take a navigation target.`;

    case 'goto-base-missing':
      return 'Select an item first.';

    case 'goto-path-required':
      return 'Pick a destination.';

    case 'goto-unresolved':
      return `Couldn't navigate to ${data.path ?? '(unknown)'}.`;

    case 'has-descendants': {
      const path = data.path ?? '(this item)';
      const n = data.descendantCount ?? 0;
      const subitem = n === 1 ? 'subitem' : 'subitems';
      return `${path} has ${n} ${subitem}. Delete the subtree to remove them too.`;
    }

    case 'open-descendants': {
      const title = data.title || 'this item';
      const n = data.openCount ?? 0;
      const sub = n === 1 ? 'open subitem' : 'open subitems';
      return `"${title}" has ${n} ${sub}. Close them first, or force-close to mark this item done anyway.`;
    }

    case 'pop-no-path':
      return 'Pop always closes the active item — pick a different verb to target another item.';

    case 'invalid-document':
      return `Noggin file is invalid: ${message}`;

    case 'unsupported-schema':
      return `Noggin file uses an unsupported schema: ${message}`;

    case 'invalid-note':
    case 'invalid-op':
      return message;

    case 'source-required':
    case 'dest-required':
      return message;

    case 'io':
      return `File error: ${message}`;

    case 'lock-timeout':
      return `Noggin file is locked by another process. Try again in a moment.`;

    default:
      return message;
  }
}
