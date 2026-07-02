// AUTO-SYNCED FROM engine/providers/memory.d.mts — DO NOT EDIT HERE.
// Edit the source and run: node scripts/sync-skill.mjs

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
  /**
   * Determinism seam: clock used by verbs for `createdAt` and note
   * timestamps. A `Date` (fixed) or `() => Date` (advancing). Defaults
   * to the wall clock. Injected so tests get reproducible timestamps.
   */
  now?: Date | (() => Date);
  /**
   * Determinism seam: id generator used by verbs for new item keys.
   * `() => string`. Defaults to a timestamp+random key. Injected so
   * tests get reproducible keys.
   */
  newKey?: () => string;
}

/**
 * @public
 * Open an in-memory noggin without going through the provider + URL
 * scheme dance. Equivalent to `openNoggin('memory://' + label, opts)`.
 */
export function openMemoryNoggin(opts?: OpenMemoryNogginOptions): Promise<NogginStore>;
