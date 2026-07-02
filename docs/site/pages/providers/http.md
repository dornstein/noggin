---
title: HTTP(S) provider
slug: "providers/http/"
---

# HTTP(S) provider

The HTTP(S) provider loads a noggin from a remote URL. It's
**read-only** by design: there's no portable, authenticated write
protocol that fits every server, so the provider rejects every
`apply(ops)` with `code: 'read-only'`. Hosts use this to display
shared noggins (GitHub-hosted YAML files, raw URLs) without giving
the user a misleading "I can edit this" experience.

## At a glance

| | |
| --- | --- |
| **Schemes** | `https://`, `http://` |
| **Module** | `@noggin/engine/providers/http` |
| **Persistent** | Source-controlled (whoever owns the URL) |
| **Read-only** | **Yes** — `apply()` always rejects |
| **Auth** | None — only public URLs (or whatever the runtime's `fetch` allows) |
| **Runs in** | Node (≥18), browsers, Deno — anywhere with `fetch` |

## When to use

Use this when you want to **read** a noggin that lives somewhere
else — a sample noggin on GitHub, a teammate's URL, a snapshot from
a CI artifact. The desktop app's "Open from URL…" picker drives this
provider; so does any host that wants to preview a noggin without
copying it locally.

If you need to mutate the remote noggin, sync it back to a file
first (download → edit → push) or use a different backend behind a
custom provider.

## Quick start

```ts
import { openNoggin } from '@noggin/engine';
import '@noggin/engine/providers/http';

const noggin = await openNoggin('https://example.com/sample.yaml');

console.log(noggin.items.map((i) => i.title));
console.log(noggin.readOnly); // true

await noggin.dispose();
```

Or directly:

```ts
import { openHttpNoggin } from '@noggin/engine/providers/http';

const noggin = await openHttpNoggin(
  'https://raw.githubusercontent.com/dornstein/noggin/main/docs/site/playground/sample.yaml',
);
```

The provider fetches whatever URL you give it. It doesn't rewrite
or massage the input — host UIs that want to translate friendly
forms (a `github.com/.../blob/...` URL into the `raw.` equivalent,
a bare hostname into `https://...`) do that at the picker boundary
before calling `openNoggin`.

## Read-only contract

Every mutation rejects with `NogginError({ code: 'read-only' })`.
Including the bound shortcuts:

```ts
await noggin.push({ title: 'nope' });
// → NogginError: code 'read-only', "remote noggin is read-only"
```

The returned noggin also carries a `readOnly: true` flag. UI code
should read it and disable mutation affordances preemptively rather
than waiting for an error round-trip:

```tsx
{!noggin.readOnly && <AddButton onClick={...} />}
```

## Behaviour

- **Fetch on open.** The provider issues exactly one `fetch(url)`
  call during `openNoggin`. The response body is parsed as YAML and
  validated against the schema. There's no polling; if the source
  changes after you opened it, you won't see the change until you
  re-open.
- **No watcher.** `onDidChange` is wired but never fires. Hosts that
  want freshness implement their own re-open loop.
- **Synchronous reads** against the loaded snapshot, same as every
  other provider.

## Error codes you might see

| Code | When |
| --- | --- |
| `http-fetch-failed` | The fetch threw (network down, DNS, CORS in a browser) |
| `http-error` | The server replied with a non-2xx status |
| `http-invalid-yaml` | The body parsed as something that wasn't a valid noggin document (e.g. HTML) |
| `schema-version-mismatch` | The document declares an unknown `schemaVersion` |
| `read-only` | Any `apply()` call |

## Security notes

- The provider trusts whatever the URL serves. Treat a remote noggin
  the way you'd treat any user-supplied YAML: don't `eval` titles,
  don't execute notes as commands, etc.
- In browsers, CORS rules apply. Public URLs hosted on a permissive
  origin (raw.githubusercontent.com, most CDNs) work; URLs that
  require auth headers or set `Access-Control-Allow-Origin: null`
  surface as `http-fetch-failed`.
- The provider does not follow Auth challenges. Use a downstream
  proxy or save the file locally if you need authenticated reads.

## Related

- [`file://`](../file/) for local, mutable copies
- [Playground](../../playground/) — uses a sibling read-only
  approach for sample data
