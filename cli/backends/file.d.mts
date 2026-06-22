// Type declarations for cli/backends/file.mjs.

import type { Noggin } from '../noggin-api.mjs';

/**
 * @public
 * Open a noggin backed by a YAML file. Performs the initial load
 * asynchronously; the returned `Noggin` is ready to use.
 *
 * Pass `{ watch: true }` to subscribe to external file changes via
 * `fs.watch` — useful for live UIs (the VS Code extension), wasteful
 * for one-shot CLI invocations.
 */
export function fileNoggin(
  filePath: string,
  opts?: { watch?: boolean }
): Promise<Noggin>;

/**
 * @internal
 * Default location used when no file path is supplied. CLI-internal;
 * callers that need this should pass a path of their own.
 */
export const DEFAULT_NOGGIN_FILE: string;

/**
 * @internal
 * Resolve a noggin file path with the same priority the CLI uses:
 *   1. `opts.file`
 *   2. `opts.env.NOGGIN_FILE` (defaults to process.env)
 *   3. `DEFAULT_NOGGIN_FILE`
 *
 * Returns the resolved path plus diagnostic metadata. CLI-internal:
 * not part of the engine's public API.
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
