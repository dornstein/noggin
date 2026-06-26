// CLI error catalog.
//
// Maps engine error `code` + `data` payloads to CLI-flavored user-facing
// messages, including the `--flag` vocabulary the CLI exposes. Engine
// errors are intentionally vocabulary-neutral (see `engine/noggin-api.mjs`);
// every host that renders an error to a user has its own catalog like
// this one.
//
// If `code` is unknown to this catalog, callers fall back to the
// engine's `message` field (which is the short, host-neutral fact).

/**
 * @typedef {Object} CliErrorContext
 * @property {string} [verb]    — CLI verb that was running (e.g. `'delete'`).
 * @property {string} code      — engine error code.
 * @property {string} message   — engine fallback message.
 * @property {Record<string, unknown>} [data] — engine structured payload.
 */

/**
 * Render an engine error code + data into a CLI-style message.
 * Returns the string to print on stderr (without the `noggin: ` prefix
 * — the caller adds that).
 *
 * @param {CliErrorContext} ctx
 * @returns {string}
 */
export function cliErrorMessage(ctx) {
  const { code, data = {}, message } = ctx;
  const verb = (data && data.verb) || ctx.verb || '';
  const v = verb ? `${verb}: ` : '';

  switch (code) {
    case 'no-active-item':
      return `${v}no active item; pass a path`;

    case 'no-location':
      return `${v}location required`;

    case 'no-provider':
      if (data.scheme) {
        return `${v}no provider registered for scheme '${data.scheme}://'`;
      }
      return `${v}no default provider registered; cannot open '${data.location ?? ''}'`;

    case 'path-not-found':
      return `${v}${data.detail || message}`;

    case 'path-required':
      return `${v}path required`;

    case 'cycle':
      if (data.placementKind === 'into') {
        if (data.title) {
          return `${v}cannot move ${data.path} into ${data.path === '/' ? 'itself' : 'itself or its subtree'} (would create a cycle)`;
        }
      }
      // Distinguish the three flavors via the engine's message, which is
      // already short and code-derived.
      return `${v}${message}`;

    case 'placement-missing':
      return `${v}choose exactly one of --before, --after, or --into`;

    case 'placement-invalid':
      return `${v}unknown placement kind '${data.kind}'`;

    case 'title-required':
      return `${v}title required`;

    case 'text-required':
      return `${v}text required`;

    case 'nothing-to-edit':
      return `${v}nothing to edit; pass at least one of --done, --open, --title`;

    case 'option-misused':
      // Two variants share the same code; engine message distinguishes.
      if (/force/.test(message)) {
        return `${v}--force only applies when closing (with --done)`;
      }
      if (/close-all/.test(message)) {
        return `${v}--close-all only applies when closing (with --done)`;
      }
      return `${v}${message}`;

    case 'goto-unsupported':
      return `${v}--goto is not supported`;

    case 'goto-base-missing':
      return `${v}--goto has no base item`;

    case 'goto-path-required':
      return `${v}--goto requires a path`;

    case 'goto-unresolved':
      return `${v}--goto ${data.detail || message}`;

    case 'has-descendants':
      return `${v}${data.path} has ${data.descendantCount} descendant(s); ` +
        `pass --recursive to delete the whole subtree`;

    case 'open-descendants':
      return `${v}${data.path} has ${data.openCount} open descendant(s); ` +
        `pass --closeall to close them too, or --force to close ${data.title} anyway`;

    case 'pop-no-path':
      return `${v}takes no path; pop always operates on the active item`;

    case 'invalid-note':
    case 'invalid-op':
    case 'invalid-document':
    case 'unsupported-schema':
      return `${v}${message}`;

    case 'source-required':
    case 'dest-required':
      return `${v}${message}`;

    case 'io':
      return `${v}${message}`;

    case 'lock-timeout':
      return `${v}${message}`;

    default:
      return `${v}${message}`;
  }
}
