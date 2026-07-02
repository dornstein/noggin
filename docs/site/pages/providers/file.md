---
title: File provider
slug: "providers/file/"
---

# File provider

The file provider backs a noggin with a single YAML document on
disk, atomically writes on every mutation, and watches the file
for outside changes so live noggins stay in sync when another
process (the CLI, a peer editor) updates the same file.

## At a glance

| | |
| --- | --- |
| **Scheme** | `file://` |
| **Module** | `@noggin/engine/providers/file` |
| **Loaded by** | CLI, MCP, desktop, extension (on import) |
| **Persistent** | Yes — single YAML file on disk |
| **Read-only** | No |
| **Cross-process** | Lock-coordinated atomic writes + filesystem watcher |
| **Read accessors** | Synchronous against the last-known document |

## When to use

This is the workhorse. Use it when you want a real noggin you can
commit, share via a shared drive, edit in a text editor, or open
from multiple processes simultaneously (CLI + extension + agent).

## Quick start

```ts
import { openNoggin } from '@noggin/engine';
import '@noggin/engine/providers/file';

const noggin = await openNoggin('file:///work/today.yaml');
await noggin.push({ title: 'ship v1' });
await noggin.dispose();
```

Got a raw filesystem path (from a file-open dialog, a CLI flag, a
drop event)? Use the direct factory — it accepts absolute,
relative, and `~`-prefixed paths and skips the URI construction:

```ts
import { openFileNoggin } from '@noggin/engine/providers/file';

const noggin = await openFileNoggin('~/.noggin.yaml');
```

The file is created on first write if it doesn't exist. An empty
or missing file yields an empty noggin (no items, no active).

## URL syntax

| Form | Meaning |
| --- | --- |
| `file:///absolute/path.yaml` | Standard `file://` URL |
| `file://./relative/path.yaml` | Relative path embedded after `file://` (resolved against `process.cwd()`) |
| `file://~/.noggin.yaml` | `~` expansion is performed at open time |

Raw filesystem paths (`/abs/path.yaml`, `./relative.yaml`,
`~/x.yaml`) do **not** work with `openNoggin` — every URI requires
an explicit scheme. Use `openFileNoggin(path)` or convert the path
to a `file://` URI at your host's boundary.

## Persistence and behaviour

- **Atomic writes.** Every `apply(ops)` serializes the new document
  to a sibling temp file, fsyncs it, then renames over the target.
  Readers never see a half-written file.
- **Cross-process locking.** A `.lock` sentinel beside the file is
  held for the duration of each `apply`. Concurrent CLI invocations
  against the same file queue up; nothing interleaves.
- **Filesystem watcher.** `onDidChange` fires not only for in-process
  mutations but also when another process (the CLI, an editor) writes
  to the same file. The provider re-reads, diffs against the last
  known document, and fires a `ChangeEvent` describing exactly what
  changed — same shape as an in-process mutation.
- **Polling safety net.** `fs.watch` is best-effort: it silently
  drops events on some network filesystems and inside some
  containers, and on macOS can take a few hundred milliseconds to
  notice a rename-based atomic write. So the provider also runs a
  short `fs.statSync` poll (default 2000 ms) alongside the watcher.
  On the fast path it's a single `mtimeMs` compare and returns
  immediately; only when the mtime moves does it schedule a full
  re-read + diff. Set `pollIntervalMs: 0` to disable.
- **Schema versioning.** The on-disk document carries a
  `schemaVersion` field. The provider rejects unknown versions with
  `NogginError({ code: 'schema-version-mismatch' })` rather than
  silently truncating future fields.

## Options

`openFileNoggin(path, opts?)` (and the equivalent
`openNoggin('file://...', opts?)`) accept:

| Option | Default | Purpose |
| --- | --- | --- |
| `watch` | `false` | Attach the `fs.watch` fast-path listener. Set to `true` for hosts that want near-instant reaction to external writes. |
| `pollIntervalMs` | `2000` | Interval (ms) for the safety-net stat poll. Set to `0` to disable. |
| `lockTimeout` | `5000` | Max ms to wait for the cross-process advisory lock during `apply()` before failing with `code: 'lock-timeout'`. |

## Error codes you might see

| Code | When |
| --- | --- |
| `no-location` | `openNoggin('file://')` with no path |
| `schema-version-mismatch` | The YAML on disk declares a `schemaVersion` the engine doesn't know |
| `invalid-document` | The YAML parses but fails structural validation (e.g. dangling `parentKey`) |
| `lock-timeout` | A peer process held the lock past the configured timeout |

## Related

- [`memory://`](../memory/) for a non-persistent equivalent
- [Noggin schema](../../schema/) — the on-disk format
- [CLI reference → `where`](../../cli/) — show which file a CLI
  invocation resolves to
