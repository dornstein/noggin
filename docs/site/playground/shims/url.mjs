// Browser shim for node:url. Only referenced inside the file provider,
// which the playground never actually invokes (nothing in the demo
// opens a `file://` noggin). The shim's `fileURLToPath` returns the
// URL's pathname unchanged so if anything ever does slip through in
// dev, it fails loudly rather than silently.

export function fileURLToPath(input) {
  const s = String(input ?? '');
  const m = /^file:\/\/(.*)$/i.exec(s);
  return m ? decodeURIComponent(m[1]) : s;
}

export function pathToFileURL(p) {
  const s = String(p ?? '');
  return new URL(s.startsWith('/') ? `file://${s}` : `file:///${s.replace(/\\/g, '/')}`);
}

export default { fileURLToPath, pathToFileURL };
