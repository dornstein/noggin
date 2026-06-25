// Type declarations for engine/providers/file.mjs.
//
// Importing this module side-effect-registers a provider under the
// `file://` scheme with the engine's `providers` registry. The
// `fileProvider` symbol is exposed for callers that want to register
// or unregister it programmatically.

import type { NogginProvider } from '../noggin-api.mjs';

/**
 * @public
 * The file provider's Noggin implementation. Registered automatically
 * on import under the `file` scheme (and as the default provider for
 * bare locations).
 */
export const fileProvider: NogginProvider;
