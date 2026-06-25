// AUTO-SYNCED FROM engine/serializers/json.mjs — DO NOT EDIT HERE.
// Edit the source and run: node scripts/sync-skill.mjs

// JSON serializer for a NogginDocument.
//
// Pure: strings in, NogginDocument out (and back). No I/O. Same shape
// of contract as the YAML serializer; the two are interchangeable
// encodings of the same data model.

import { NogginError, SCHEMA_VERSION, normalizeNote } from '../noggin-api.mjs';

function invalid(message) {
  throw new NogginError(message, { code: 'invalid-document', exitCode: 2 });
}

function unsupported(message) {
  throw new NogginError(message, { code: 'unsupported-schema', exitCode: 2 });
}

/**
 * Parse a JSON noggin document. Throws `NogginError` with code
 * `'invalid-document'` for structural failures or `'unsupported-schema'`
 * when the document declares a schema version this build doesn't speak.
 *
 * Empty/whitespace input is treated as a fresh empty document.
 *
 * @param {string} text
 */
export function fromJson(text) {
  if (typeof text !== 'string') invalid('fromJson: expected a string');
  if (!text.trim()) {
    return { schemaVersion: SCHEMA_VERSION, active: null, items: [] };
  }
  let data;
  try { data = JSON.parse(text); }
  catch (e) { invalid(`failed to parse JSON: ${e.message}`); }
  return normalizeParsed(data);
}

/**
 * Serialize a NogginDocument to JSON. With `pretty: true` (the default)
 * the output is indented with two spaces and ends in a trailing newline
 * so diffs and content hashes are deterministic.
 *
 * @param {{schemaVersion: number, active: string|null, items: any[]}} doc
 * @param {{pretty?: boolean}} [opts]
 */
export function toJson(doc, opts = {}) {
  const pretty = opts.pretty !== false;
  const body = pretty ? JSON.stringify(doc, null, 2) : JSON.stringify(doc);
  return pretty ? body + '\n' : body;
}

function normalizeParsed(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    invalid('expected an object at the top level');
  }
  if (data.schemaVersion !== SCHEMA_VERSION) {
    unsupported(
      `schemaVersion ${data.schemaVersion} not supported by this build ` +
        `(expected ${SCHEMA_VERSION}).`,
    );
  }
  if (!Array.isArray(data.items)) invalid('expected items array');
  if (data.active === undefined) invalid('expected active field');
  for (const f of data.items) {
    if (!Array.isArray(f.notes)) invalid('item notes must be an array');
    f.notes = f.notes.map(normalizeNote);
    if ('closedAt' in f) delete f.closedAt;
    if ('pushedAt' in f) delete f.pushedAt;
  }
  data.schemaVersion = SCHEMA_VERSION;
  return data;
}
