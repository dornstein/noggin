// AUTO-SYNCED FROM cli/serializers/yaml.mjs — DO NOT EDIT HERE.
// Edit the source and run: node scripts/sync-skill.mjs

// YAML serializer for a NogginDocument.
//
// Pure: strings in, NogginDocument out (and back). No I/O. The file
// backend (or any other byte-shoveling code) is responsible for
// actually touching disks or sockets.

import yaml from 'js-yaml';
import { NogginError, SCHEMA_VERSION, normalizeNote } from '../noggin-api.mjs';

function invalid(message) {
  throw new NogginError(message, { code: 'invalid-document', exitCode: 2 });
}

function unsupported(message) {
  throw new NogginError(message, { code: 'unsupported-schema', exitCode: 2 });
}

/**
 * Parse a YAML noggin document. Throws `NogginError` with code
 * `'invalid-document'` for structural failures or `'unsupported-schema'`
 * when the document declares a schema version this build doesn't speak.
 *
 * Empty/whitespace input is treated as a fresh empty document.
 *
 * @param {string} text
 * @returns {{schemaVersion: number, active: string|null, items: any[]}}
 */
export function fromYaml(text) {
  if (typeof text !== 'string') invalid('fromYaml: expected a string');
  if (!text.trim()) {
    return { schemaVersion: SCHEMA_VERSION, active: null, items: [] };
  }
  let data;
  try { data = yaml.load(text); }
  catch (e) { invalid(`failed to parse YAML: ${e.message}`); }
  return normalizeParsed(data);
}

/**
 * Serialize a NogginDocument to YAML. The resulting bytes round-trip
 * cleanly back through `fromYaml`.
 *
 * @param {{schemaVersion: number, active: string|null, items: any[]}} doc
 * @returns {string}
 */
export function toYaml(doc) {
  return yaml.dump(doc, { noRefs: true, lineWidth: 100, sortKeys: false });
}

// ── Internal validation ──────────────────────────────────────────────────────

/**
 * Validate the structural shape of a parsed document and return a
 * normalized copy. Does *not* check referential integrity (unique keys,
 * parentKey resolves, active resolves) — that's the engine's job, done
 * after the serializer hands the doc off.
 */
function normalizeParsed(data) {
  if (!data || typeof data !== 'object') invalid('expected a mapping at the top level');
  if (data.schemaVersion !== SCHEMA_VERSION) {
    unsupported(
      `schemaVersion ${data.schemaVersion} not supported by this build ` +
        `(expected ${SCHEMA_VERSION}).`,
    );
  }
  if (!Array.isArray(data.items)) invalid('expected items array');
  if (data.active === undefined) invalid('expected active field');
  // Normalize each item's notes; strip legacy fields.
  for (const f of data.items) {
    if (!Array.isArray(f.notes)) invalid('item notes must be an array');
    f.notes = f.notes.map(normalizeNote);
    if ('closedAt' in f) delete f.closedAt;
    if ('pushedAt' in f) delete f.pushedAt;
  }
  data.schemaVersion = SCHEMA_VERSION;
  return data;
}
