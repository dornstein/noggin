// Type declarations for cli/backends/file.mjs.
//
// Importing this module side-effect-registers a factory under the
// `file://` scheme with the engine's `factories` registry. The
// `fileFactory` symbol is exposed for callers that want to register
// or unregister it programmatically.

import type { NogginFactory } from '../noggin-api.mjs';

/**
 * @public
 * The file backend's noggin factory. Registered automatically on
 * import under the `file` scheme (and as the default factory for
 * bare locations).
 */
export const fileFactory: NogginFactory;
