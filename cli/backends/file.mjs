// File backend for noggin.
//
// `fileNoggin(path, opts?)` is the public entry point for opening a
// noggin that lives in a YAML file on the local filesystem. Returns
// a live `Noggin` instance — see ../noggin-api.mjs for the surface.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Noggin } from '../noggin-api.mjs';

/**
 * Open a noggin backed by a YAML file. The first load runs
 * synchronously inside the constructor; subsequent reads come from the
 * in-memory snapshot. Pass `{ watch: true }` to subscribe to external
 * file changes via `fs.watch`.
 *
 * @param {string} filePath Absolute path to the noggin file.
 * @param {{ watch?: boolean }} [opts]
 */
export function fileNoggin(filePath, opts) {
  if (!filePath) throw new TypeError('fileNoggin: file path required');
  const noggin = new Noggin(filePath, opts);
  // Tag the instance so describe() can identify the backend without
  // forcing every Noggin to carry backend-specific state.
  noggin._backend = { kind: 'file' };
  return noggin;
}

// Re-exported so the CLI can resolve a default path without reaching
// into the engine package. Not part of the public Noggin surface.

/** Default location used when no file path is supplied. */
export const DEFAULT_NOGGIN_FILE = path.join(os.homedir(), '.noggin.yaml');

/**
 * Resolve a noggin file path with the same priority the CLI uses:
 *   1. `opts.file`
 *   2. `opts.env.NOGGIN_FILE` (defaults to process.env)
 *   3. `DEFAULT_NOGGIN_FILE`
 *
 * Returns the resolved path plus diagnostic metadata. CLI-internal:
 * not exported as part of the engine's public API.
 *
 * @param {{ file?: string, env?: Record<string, string|undefined> }} [opts]
 */
export function resolveFilePath(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  let file, source;
  if (o.file) { file = o.file; source = 'flag'; }
  else if (env.NOGGIN_FILE) { file = env.NOGGIN_FILE; source = 'env'; }
  else { file = DEFAULT_NOGGIN_FILE; source = 'default'; }
  return {
    file,
    source,
    exists: fs.existsSync(file),
    defaultFile: DEFAULT_NOGGIN_FILE,
    env: env.NOGGIN_FILE || null,
  };
}
