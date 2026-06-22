// AUTO-SYNCED FROM cli/serializers/yaml.d.mts — DO NOT EDIT HERE.
// Edit the source and run: node scripts/sync-skill.mjs

// Type declarations for cli/serializers/yaml.mjs.

import type { NogginDocument } from '../noggin-api.mjs';

/**
 * @public
 * Parse a YAML noggin document. Throws `NogginError` with code
 * `'invalid-document'` for structural failures or `'unsupported-schema'`
 * when the document declares a schema version this build doesn't speak.
 *
 * Empty/whitespace input is treated as a fresh empty document.
 */
export function fromYaml(text: string): NogginDocument;

/**
 * @public
 * Serialize a NogginDocument to YAML. The resulting bytes round-trip
 * cleanly back through `fromYaml`.
 */
export function toYaml(doc: NogginDocument): string;
