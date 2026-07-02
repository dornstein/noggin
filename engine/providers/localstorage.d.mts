// Type declarations for the localStorage provider. The runtime
// registers a provider under the `localstorage://` scheme on import;
// the named exports here are also useful for callers that want to
// bypass `openNoggin` or compute the underlying storage key.

import type { NogginStore, NogginDocument } from '../noggin-api.mjs';

/**
 * @public
 * Minimal Storage shape consumed by the provider. Matches the DOM
 * `Storage` interface but stays standalone so non-DOM hosts (Node
 * tests using `node-localstorage`) don't need the full lib.dom.d.ts.
 */
export interface NogginLocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** @public Default slot used when no path is supplied. */
export const DEFAULT_STORAGE_SLOT: string;

/** @public Provider object registered on import. */
export const localStorageProvider: {
  scheme: 'localstorage';
  open(location: string, opts?: OpenLocalStorageNogginOptions): Promise<NogginStore>;
};

/** @public Options for `openLocalStorageNoggin` / `localStorageProvider.open`. */
export interface OpenLocalStorageNogginOptions {
  /** Storage slot. Falls back to `DEFAULT_STORAGE_SLOT`. Maps to the
   *  full key `noggin:<slot>` in storage. */
  slot?: string;
  /** Storage implementation. Defaults to `globalThis.localStorage`.
   *  Pass an in-memory shim for tests. */
  storage?: NogginLocalStorageLike;
  /** Optional `Window`-like object for cross-tab `storage` events.
   *  Defaults to `globalThis.window`. */
  window?: { addEventListener(type: string, handler: (e: { key: string | null; storageArea?: NogginLocalStorageLike | null }) => void): void; removeEventListener(type: string, handler: (e: unknown) => void): void };
  /** How often (ms) to poll the slot for same-tab out-of-band writes
   *  (dev-tools, secondary scripts, node-localstorage shims that
   *  don't fire `storage`). Defaults to 500. Pass `0` to disable
   *  polling entirely — cross-tab sync via the DOM `storage` event
   *  keeps working either way. */
  pollIntervalMs?: number;
}

/**
 * @public
 * Open a localStorage-backed noggin without going through the
 * provider + URL scheme dance.
 */
export function openLocalStorageNoggin(opts?: OpenLocalStorageNogginOptions): Promise<NogginStore>;

/**
 * @public
 * Compute the storage key (`noggin:<slot>`) a `localstorage://` URI
 * maps to. Hosts that want to clear / inspect the raw storage use
 * this to avoid hard-coding the prefix.
 */
export function localStorageKeyFor(location: string): string;

/**
 * @public
 * `NogginStore` subclass returned by the provider. Adds three
 * convenience methods on top of the standard `Noggin` interface.
 *
 * Most consumers should call `openLocalStorageNoggin()` and treat
 * the result as a plain `NogginStore`; only the playground-style
 * demo flows that want to wipe / bulk-replace the slot need these.
 */
export interface LocalStorageNoggin extends NogginStore {
  /** Read the current document directly. */
  snapshot(): NogginDocument;
  /** Wipe the slot. Fires `onDidChange`. */
  reset(): Promise<void>;
  /** Replace the slot's document wholesale. */
  loadDocument(doc: NogginDocument): Promise<void>;
  /** True if the slot has non-empty data. */
  hasData(): boolean;
}

export const LocalStorageNoggin: new (...args: never[]) => LocalStorageNoggin;
