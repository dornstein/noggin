// Tiny className combinator. No deps; falsy values dropped.
//
//     cn('foo', cond && 'bar', undefined)  →  'foo bar'
//
// Internal to @noggin/ui — not exported. Components use this when
// composing a built-in class with an optional `classNames` slot
// override from the consumer.

export function cn(...parts: Array<string | false | null | undefined>): string {
  let out = '';
  for (const p of parts) {
    if (!p) continue;
    if (out) out += ' ';
    out += p;
  }
  return out;
}
