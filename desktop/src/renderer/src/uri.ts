// Helpers for converting raw OS-side strings into the URI shape the
// engine expects. The engine's `openNoggin` requires every location
// to carry an explicit scheme; native dialogs and OS drop events
// hand us bare filesystem paths, so we normalize them here at the
// host boundary.

/**
 * Convert a raw OS path (Windows backslashes or POSIX slashes) into
 * a `file://` URI.
 *
 *   Windows: `C:\\Users\\d\\x.yaml`  →  `file:///C:/Users/d/x.yaml`
 *   POSIX:   `/Users/d/x.yaml`       →  `file:///Users/d/x.yaml`
 *
 * If the input already carries a URI scheme, returns it unchanged.
 * If the input is empty, returns it unchanged (caller decides how
 * to handle that).
 */
export function pathToFileUri(raw: string): string {
  if (!raw) return raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  const normalized = raw.replace(/\\/g, '/');
  return normalized.startsWith('/')
    ? `file://${normalized}`
    : `file:///${normalized}`;
}

/** True iff `s` already looks like a noggin URI (has a `<scheme>://`). */
export function isUri(s: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
}
