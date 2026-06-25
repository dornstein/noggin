# Plans

This folder holds **design proposals** — point-in-time snapshots of
what we *intended* to build before we built it.

Plans are intentionally **not maintained**. Once a plan is implemented
(or abandoned), it captures the thinking from that moment. The actual
current behaviour lives in code and in the regular docs under
[`../`](../) and the per-package READMEs. If a plan and the code
disagree, the code is correct.

## Convention

Each plan is a markdown file with YAML frontmatter:

```yaml
---
title: Short human title
status: proposed | implemented | abandoned | superseded
date: YYYY-MM-DD            # when the plan was written
implemented:                # commits/PRs that landed it (when status: implemented)
  - <sha> - <short message>
superseded_by: <filename>   # when status: superseded
---
```

File naming: `YYYY-MM-<slug>.md`. The date prefix sorts them
chronologically; the slug should be a short topic.

## Index

| Plan | Status | Topic |
|---|---|---|
| [`2026-06-api-extraction.md`](2026-06-api-extraction.md) | implemented | Extracting `cli/noggin-api.mjs` out of `cli/cli.mjs`; making the extension import the API in-process instead of shelling out |
| [`2026-06-public-api-and-backends.md`](2026-06-public-api-and-backends.md) | implemented | Formalizing the public API; pluggable providers; async verbs |
| [`2026-06-noggin-rpc.md`](2026-06-noggin-rpc.md) | proposed | Unified `noggin-rpc` protocol; host-side providers; optimistic UI |

## Adding a plan

1. Draft the design document with the frontmatter above (status:
   proposed).
2. Discuss / iterate. Land the file on `main` once the design is
   stable enough to start building from.
3. As you implement, leave the plan unchanged. The code is the
   source of truth for *what's true*; the plan is the source of
   truth for *why we did it that way*.
4. When the work lands, update frontmatter to `status: implemented`
   and add the commit SHAs under `implemented:`.
5. Add a row to the index above.

If the plan never ships, mark it `status: abandoned` with a one-line
note in the body about why. Don't delete it — the "we considered this
and rejected it for X" record is the point.
