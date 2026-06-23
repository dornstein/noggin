// AUTO-SYNCED FROM cli/serializers/json.d.mts — DO NOT EDIT HERE.
// Edit the source and run: node scripts/sync-skill.mjs

// Type declarations for cli/serializers/json.mjs.

import type { NogginDocument } from '../noggin-api.mjs';

/**
 * @public
 * Parse a JSON noggin document. Throws `NogginError` with code
 * `'invalid-document'` for structural failures or `'unsupported-schema'`
 * when the document declares a schema version this build doesn't speak.
 *
 * Empty/whitespace input is treated as a fresh empty document.
 */
export function fromJson(text: string): NogginDocument;

/**
 * @public
 * Serialize a NogginDocument to JSON. With `pretty: true` (the default)
 * the output is indented with two spaces and ends in a trailing newline
 * so diffs and content hashes are deterministic.
 */
export function toJson(doc: NogginDocument, opts?: { pretty?: boolean }): string;
