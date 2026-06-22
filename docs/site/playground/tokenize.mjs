// Tokenize a single CLI input line into argv. Handles double-quoted
// strings (with backslash escapes) and single-quoted strings (literal).
// Everything else is split on whitespace. Returns [] for empty input.
//
// This is intentionally small — the docs-site CLI demo doesn't need a
// full POSIX-shell parser, just enough to let titles with spaces work:
//
//   noggin add "ship v1" --into /1   →  ['add', 'ship v1', '--into', '/1']
//   noggin note "needs review"        →  ['note', 'needs review']

export function tokenize(line) {
  const out = [];
  let cur = '';
  let inDouble = false;
  let inSingle = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (inDouble) {
      if (ch === '\\' && i + 1 < line.length) { cur += line[i + 1]; i += 2; continue; }
      if (ch === '"') { inDouble = false; i++; continue; }
      cur += ch; i++; continue;
    }
    if (inSingle) {
      if (ch === "'") { inSingle = false; i++; continue; }
      cur += ch; i++; continue;
    }
    if (ch === '"') { inDouble = true; i++; continue; }
    if (ch === "'") { inSingle = true; i++; continue; }
    if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ''; }
      i++; continue;
    }
    cur += ch; i++;
  }
  if (inDouble || inSingle) {
    throw new Error('unterminated quoted string');
  }
  if (cur) out.push(cur);
  return out;
}
