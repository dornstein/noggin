// Type declarations for engine/providers/file.mjs.
//
// Importing this module side-effect-registers a provider under the
// `file://` scheme with the engine's `providers` registry. The
// `fileProvider` symbol is exposed for callers that want to register
// or unregister it programmatically.

import type { NogginProvider, NogginStore } from '../noggin-api.mjs';

/**
 * @public
 * The file provider's Noggin implementation. Registered automatically
 * on import under the `file` scheme.
 */
export const fileProvider: NogginProvider;

/**
 * @public
 * Convenience factory: open a file-backed noggin from a raw filesystem
 * path. Accepts absolute paths, paths relative to `process.cwd()`,
 * and `~`-prefixed paths. The right entry point for hosts whose user
 * input is a real OS path (file dialogs, drop targets, CLI argv);
 * hosts that work with URIs end-to-end should prefer
 * `openNoggin('file://...')` instead.
 */
export function openFileNoggin(
  filePath: string,
  opts?: Record<string, unknown>,
): Promise<NogginStore>;
