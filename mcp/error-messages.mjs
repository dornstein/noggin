// MCP error catalog.
//
// Maps engine error `code` + `data` payloads to MCP-flavored user-facing
// messages. Mirrors the structure of `cli/error-messages.mjs`. Today this
// is a passthrough that returns the engine's neutral `message` — the seam
// exists so MCP can grow tool-vocabulary-specific phrasing (JSON keys like
// `before`/`after`/`into` instead of CLI `--before`/`--after`/`--into`)
// without touching the engine.

/**
 * @typedef {Object} McpErrorContext
 * @property {string} [verb]    — MCP tool verb (e.g. `'delete'`).
 * @property {string} code      — engine error code.
 * @property {string} message   — engine fallback message.
 * @property {Record<string, unknown>} [data] — engine structured payload.
 */

/**
 * Render an engine error code + data into an MCP-style message.
 * v0: passthrough — returns the engine's neutral message string.
 *
 * @param {McpErrorContext} ctx
 * @returns {string}
 */
export function mcpErrorMessage(ctx) {
  return ctx.message;
}
