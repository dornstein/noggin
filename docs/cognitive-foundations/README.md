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
  protocol, the engine-as-only-mutating-path model, the documented
  `NogginDocument` shape with pluggable providers, …) mapped to the
  principle(s) it serves and the research that justifies it.
- **[challenges.md](challenges.md)** — the deliberate counterweight
  to the rationale. Places the literature *contradicts* what noggin
  currently does, capabilities the literature suggests noggin
  should have but doesn't, and tensions the current design resolves
  in one direction when the evidence is mixed. If a feature has
  been declared "out of scope" on framework grounds, check here
  before relying on that.
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

## How this folder is maintained

The framework is principle-driven by intent, but it's easy to slide
back into "concrete current implementation" framing when writing.
The first draft of this folder did exactly that — for example, it
stated P7 as "single YAML file on local disk" instead of "the user's
externalized cognition must stay reachable," which excluded the
memory provider that already ships in
[engine/providers/memory.mjs](../../engine/providers/memory.mjs).
These four rules exist so that slip doesn't recur.

1. **Invariance test.** Every principle must be stated so that it
   survives swapping the most-plausible alternatives the
   architecture already admits. Concretely, for any principle ask:
   *"Is this still true with the memory provider? With the desktop's
   RPC-to-main engine? With a hypothetical future SQLite or HTTP
   provider?"* If only one of those satisfies the wording, the
   wording is a decision rationale, not a principle — rewrite it
   one level more abstract.
2. **"What does this exclude?" pass.** For each principle, list
   what it would forbid. If it forbids something the engine
   already supports, the principle is wrong (worked example:
   "single YAML file" forbade `memory://`, which ships).
3. **Audience tags on borrowed quotes.** SKILL.md is written for
   an agent in a particular host (a terminal with the CLI, or a
   chat with MCP/LM tools). The READMEs are written for users.
   When quoting either, tag the audience and strip audience-
   specific framing before promoting the quote to a principle.
   The SKILL's "the CLI is the only interface you should use,"
   for instance, is agent-in-terminal-host advice; the underlying
   architectural truth is "the engine is the only mutating path,"
   which holds in every host.
4. **Ground-truth hierarchy.** When the artifact disagrees with
   itself or with the code, the order of authority is:
   1. The engine source (`engine/noggin-api.mjs`,
      `engine/providers/`) — what is actually true.
   2. [.github/copilot-instructions.md](../../.github/copilot-instructions.md)
      — verified, dated meta-documentation.
   3. [`docs/plans/`](../plans/) — historical intent; may be
      stale by design.
   4. The READMEs and SKILL.md — audience-facing contracts,
      often specific to one context.
   Never lift framing from level 4 as if it were level 1.

4. **Run the search in both directions.** When proposing or
   reviewing a principle, don't just search for research that
   supports current decisions — search for research that suggests
   what *should* be there and isn't. The first pass through this
   folder ran only the first direction and produced an
   unrealistically clean confirmation; the [challenges.md](challenges.md)
   file is the artifact of running it the other way. Both passes
   are required for a principle to stand: "current design is
   consistent with the literature" *and* "the literature would
   not suggest a significantly different design."

When proposing a new principle, or revising one, run all four
checks before merging.
