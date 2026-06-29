// Type declarations for the memory provider. The runtime registers a
// provider under the `memory://` scheme on import; the named exports
// here are also useful for callers that want to bypass `openNoggin`.

import type { NogginStore, NogginDocument } from '../noggin-api.mjs';

/** @public Provider object registered on import. */
export const memoryProvider: {
  scheme: 'memory';
  open(location: string, opts?: unknown): Promise<NogginStore>;
};

/** @public Options for `openMemoryNoggin`. */
export interface OpenMemoryNogginOptions {
  /** Human-readable label used in `describe()` (becomes `memory://<label>`). */
  label?: string;
  /** Seed the noggin with an existing NogginDocument. */
  initialDocument?: NogginDocument;
}

/**
 * @public
 * Open an in-memory noggin without going through the provider + URL
 * scheme dance. Equivalent to `openNoggin('memory://' + label, opts)`.
 */
export function openMemoryNoggin(opts?: OpenMemoryNogginOptions): Promise<NogginStore>;
