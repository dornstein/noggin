// Type declarations for the http(s) provider. The runtime registers
// providers under `https://` and `http://` on import; the named
// exports here are also useful for callers that want to bypass
// `openNoggin`.

import type { NogginStore } from '../noggin-api.mjs';

/** @public Provider object registered on import for `https://`. */
export const httpsProvider: {
  scheme: 'https';
  open(location: string, opts?: unknown): Promise<NogginStore>;
};

/** @public Provider object registered on import for `http://`. */
export const httpProvider: {
  scheme: 'http';
  open(location: string, opts?: unknown): Promise<NogginStore>;
};

/**
 * @public
 * Convenience: open a remote noggin by URL without going through the
 * scheme registry. The returned store satisfies the same `Noggin`
 * interface every other provider does, but it is read-only — every
 * `apply(ops)` call rejects with `NogginError({ code: 'read-only' })`.
 *
 * The returned store carries a `readOnly: true` flag UI code can read
 * to gate mutation affordances preemptively.
 */
export function openHttpNoggin(
  url: string,
  opts?: unknown,
): Promise<NogginStore & { readonly readOnly: true }>;
