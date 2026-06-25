// AUTO-SYNCED FROM engine/backends/memory.d.mts — DO NOT EDIT HERE.
// Edit the source and run: node scripts/sync-skill.mjs

// Type declarations for the memory backend. The runtime registers a
// factory under the `memory://` scheme on import; the named exports
// here are also useful for callers that want to bypass `openNoggin`.

import type { Noggin, NogginDocument } from '../noggin-api.mjs';

/** @public Factory object registered on import. */
export const memoryFactory: {
  scheme: 'memory';
  open(location: string, opts?: unknown): Promise<Noggin>;
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
 * Open an in-memory noggin without going through the factory + URL
 * scheme dance. Equivalent to `openNoggin('memory://' + label, opts)`.
 */
export function openMemoryNoggin(opts?: OpenMemoryNogginOptions): Promise<Noggin>;
