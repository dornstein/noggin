// AUTO-SYNCED FROM cli/backends/file.d.mts — DO NOT EDIT HERE.
// Edit the source and run: node scripts/sync-skill.mjs

// Type declarations for cli/backends/file.mjs.

import type { Noggin } from '../noggin-api.mjs';

/**
 * Open a noggin backed by a YAML file. Performs the initial load
 * asynchronously; the returned `Noggin` is ready to use.
 */
export function fileNoggin(
  filePath: string,
  opts?: { watch?: boolean }
): Promise<Noggin>;

/** Default location used when no file path is supplied. */
export const DEFAULT_NOGGIN_FILE: string;

/**
 * Resolve a noggin file path with the same priority the CLI uses:
 *   1. `opts.file`
 *   2. `opts.env.NOGGIN_FILE` (defaults to process.env)
 *   3. `DEFAULT_NOGGIN_FILE`
 *
 * Returns the resolved path plus diagnostic metadata. CLI-internal:
 * not exported as part of the engine's public API.
 */
export function resolveFilePath(opts?: {
  file?: string;
  env?: Record<string, string | undefined>;
}): {
  file: string;
  source: 'flag' | 'env' | 'default';
  exists: boolean;
  defaultFile: string;
  env: string | null;
};
