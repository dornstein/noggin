# Cognitive foundations of noggin

noggin is a tool for the cognitive demands of working *with* AI on
software — keeping track of in-flight work when the AI sprints down
many logical branches faster than a human can hold them all, when
multiple parallel agent sessions accumulate loose ends, and when
context-switching back to "where was I?" is a recurring tax.

These design choices have not been arbitrary. This folder makes the
underlying theory explicit: what we know from cognitive science about
working memory, interruption, prospective memory, distributed
cognition, and the emerging cognitive costs of LLM use — and how
that knowledge has shaped (and should continue to shape) noggin.

## How to read this folder

- **[principles.md](principles.md)** — the framework. Eight
  scannable design principles, each tied to a body of research and
  to product behaviour. Start here.
- **[design-rationale.md](design-rationale.md)** — an audit of
  noggin's current shape: every significant decision (tree, active
  spine, append-only notes, closure-as-note, opaque keys, the SKILL
  protocol, the file-as-source-of-truth model, …) mapped to the
  principle(s) it serves and the research that justifies it.
- **[research/](research/)** — short summaries of the underlying
  literature, organized by topic. Each one cites the key papers and
  pulls out the implication for noggin. Use these to ground a new
  product decision, or to verify a claim made elsewhere in this
  folder.
- **[open-questions.md](open-questions.md)** — disputed claims,
  things we should revisit as the evidence base evolves, and
  questions where we've taken a position but reasonable people
  disagree. Kept honest so the framework doesn't ossify.

## How this folder is meant to be used

- **Before a major product decision**, check whether one of the
  principles already speaks to it. If a proposed change works
  *against* a principle, that's not necessarily a veto — but it
  needs an explicit justification.
- **When auditing an existing decision**, look it up in
  [design-rationale.md](design-rationale.md). If it isn't listed,
  it's an unjustified decision: either retrofit a reason or
  reconsider it.
- **When new cognitive-science evidence appears** (especially in the
  fast-moving AI-and-cognition literature), update the relevant
  research note and check whether any principle needs revising.
  Cross-link the change to a dated entry in
  [open-questions.md](open-questions.md) if it's contested.

## What this folder is *not*

- Not a literature review for academic purposes. The research
  summaries are pragmatic — enough to make a decision, not enough to
  publish.
- Not a roadmap. Product priorities live elsewhere (in
  [`docs/plans/`](../plans/) and on issues). This folder explains
  *why* certain things are the shape they are, not what to build
  next.
- Not frozen. Unlike the snapshots in [`docs/plans/`](../plans/),
  these documents are meant to evolve. Update them when the
  evidence does.
