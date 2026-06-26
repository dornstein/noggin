# Where the framework challenges current noggin

The companion to [design-rationale.md](design-rationale.md). That
file lists decisions that the literature supports. This file lists
decisions the literature *contradicts*, capabilities the literature
suggests noggin should have but doesn't, and tensions that the
current design resolves in one direction when the evidence is mixed.

This file exists because the first draft of the framework was
written one-directional (decision → find supporting research) and
produced an unrealistically clean confirmation. A real cognitive-
science basis must include the places the research disagrees with
the current shape. Items here aren't bugs to fix tomorrow; they're
*honest tensions* the framework should hold, and decisions worth
revisiting.

Each item:

- **What** noggin currently does.
- **What** the literature suggests.
- **Confidence** that the literature applies (high / medium / low).
- **What would resolve it** — without committing to a design.

The four high-confidence items are at the top.

---

## C1. Zero time-based cueing  ·  confidence: high

**What noggin does.** Items have a `createdAt` timestamp and notes
are timestamped, but the tool has no notion of *due date*, *remind
me at*, *remind me in N*, or any time-triggered surfacing. All
cueing is spatial (the visible sidebar tree, the status-bar item,
the agent echoing `show`).

**What the literature says.** The prospective-memory literature
spends substantial space distinguishing **event-based** and
**time-based** cues, and the consensus is that the most reliable
real-world aids *combine* both. Sellen et al. 1997 found event >
time on a per-cue basis, but did not conclude time-based is
useless — and smartphone calendars / location-triggered reminders
are repeatedly cited as effective prospective-memory supports
(see [research/prospective-memory.md](research/prospective-memory.md)).

**Tension with current framework.** The previous framework leaned
on "event-based outperforms time-based" to justify the spatial-
only approach. It quoted half the sentence; the literature's
actual position supports a combined approach.

**What would resolve it.** Either a time-based cueing mechanism
(item-level "remind", time-based surfacing of paused branches,
…), or an explicit narrowed claim ("noggin is the event-cue half
of a complete prospective-memory aid; users still need a calendar
for time-based intentions") wired into the framework.

---

## C2. Done items perpetually visible  ·  confidence: high

**What noggin does.** Completed items stay in the tree under
their parent, visually marked, indefinitely. There is no
archival, no fold-by-default, no visual de-emphasis past
strikethrough.

**What the literature says.** Cognitive-load theory (Chandler &
Sweller 1991) is unambiguous: every visual element on screen
consumes working-memory budget, and extraneous load crowds out
germane load. A heavily-used noggin will accumulate done items
faster than open ones; once the ratio inverts, open work is
buried in noise that doesn't help with the active task.

**Tension with current framework.** [P5](principles.md#p5-preserve-history-closure-is-an-event-not-a-state-flip)
says preserve history; the rationale conflated *preserve* with
*always visible*. Reflection-on-action requires the past be
*reachable*, not *front-and-centre at all times*. The current
design picks P5 and pays the load.

**What would resolve it.** Visual de-emphasis or fold-by-default
for done items past some threshold (per parent, or by age) while
keeping them in the data and reachable on demand. The data-model
invariant (notes log, no `closedAt`) stays; only the default
display changes.

---

## C3. No surfacing of paused or stale items  ·  confidence: high

**What noggin does.** Items in non-active branches are passive —
they sit in the tree until the user actively looks. There is no
notion of a paused side-quest being surfaced, no gentle "this
hasn't moved in a while," no Ovsiankina-style pull-to-resume
support.

**What the literature says.** The **Ovsiankina effect** (the
tendency to resume interrupted tasks when given the chance) *did*
replicate in Ghibellini & Meier's 2025 meta-analysis even though
the Zeigarnik memory effect did not — see
[open-questions.md Q1](open-questions.md#q1-does-the-zeigarnik-effect-actually-motivate-noggins-design).
That is, the literature supports the existence of a natural pull
to resume, which means surfacing paused work feeds a real
mechanism rather than imposing one.

**Tension with current framework.** [open-questions.md Q3](open-questions.md#q3-should-noggin-surface-stale--long-paused-items)
treated this as a wash between P2 (cues reactivate) and P6 (don't
nag). That was too symmetric: the Ovsiankina evidence tips the
scale toward "calibrated surfacing helps," and P6's no-nag posture
was treated as absolute when the literature treats it as
calibration.

**What would resolve it.** A *visual* surfacing mechanism (e.g.,
highlight long-paused items in the sidebar) — never a
notification, which would re-create the P6 problem. The bar for
turning notifications on should remain very high; the bar for
in-tree visual emphasis is much lower.

---

## C4. No agent attribution on notes  ·  confidence: high

**What noggin does.** Every note is `{ timestamp, text }`. There
is no author field; nothing distinguishes a note the user wrote
from a note an agent wrote on the user's behalf.

**What the literature says.** [P8 (keep human in loop)](principles.md#p8-keep-the-human-in-the-loop-against-cognitive-debt)
is justified largely by the cognitive-debt literature *and* by
the operational need for an audit trail against agent error. An
audit trail requires distinguishing who said what; otherwise the
user cannot tell whether a piece of state came from their own
judgment or from an LLM's confabulation.

**Tension with current framework.** This is the framework's
flagship AI-era principle directly contradicted by the data
model. The framework cited the notes log as the mechanism for
P8 without checking that the log actually supports that role.

**What would resolve it.** Add an optional `author` (or
`source`) field on `Note` distinguishing `'user'` from
`'agent:<name>'`. Backward-compatible (missing field = unknown).
Default UI treatment can be a small icon or muted prefix.

---

## C5. No review / audit surface for the history  ·  confidence: medium

**What noggin does.** `show` renders the current tree with notes
inline per item. There is no timeline view, no "what closed this
week," no per-item history filter, no review tooling.

**What the literature says.** Schön's reflection-on-action and
Kolb's experiential-learning cycle both require the user to
actually *look at* the past in a structured way for the
reflective benefit to materialize. Just preserving the data
doesn't, by itself, produce reflection; the user has to engage
with it.

**Tension with current framework.** P5's claim that noggin
supports reflection-on-action is half-true: the data is
preserved, but the tool doesn't help the user use it. The
benefit is theoretical until tooling supports it.

**What would resolve it.** A `show --timeline`, a `noggin
review` verb, an extension panel that surfaces "what got done in
this branch / this week / this session." The data is already
there; this is a display problem.

---

## C6. Implementation intentions are not first-class  ·  confidence: medium

**What noggin does.** Items have a title and a `done` flag. No
notion of *when* this should happen, *what triggers* it, *what
it depends on*, or *what condition would make it actionable*.
Users can write these into notes, but the tool doesn't model or
help with them.

**What the literature says.** Gollwitzer's (1999) "implementation
intentions" — the if-then form ("when I open the editor next,
I will do X") — produces substantially higher follow-through than
bare intentions, replicated across many domains.

**Tension with current framework.** A tool whose explicit
purpose is prospective memory has nothing modeled on the
intervention with the largest documented effect size in the
prospective-memory literature. The current design treats this as
out of scope; the literature suggests it should be in scope.

**What would resolve it.** Optional `trigger` / `condition` /
`when` fields on items, even just as freeform-but-typed; agent
prompts that ask "what would trigger this?" when `add`-ing.
Could start as a convention in the resumption-note template
before becoming first-class.

---

## C7. Cue habituation isn't accounted for  ·  confidence: medium

**What noggin does.** The SKILL asks the agent to print `show`
output every turn; the sidebar tree is always-on. The agent
echoes every operation back to chat. The intent is high cue
salience.

**What the literature says.** Standard attention research:
*repeated identical cues lose salience over time*. A constant
stream of identical tree output in chat is the textbook
condition for habituation. Over a long session the cue value
likely drops below noise.

**Tension with current framework.** P2 was framed as if more cue
exposure = better reactivation. The dose-response curve for
attention is non-monotonic; past a certain point more exposure
*reduces* the reactivation value of the cue.

**What would resolve it.** Conditional output — print `show`
only when something material changed; agent acknowledgements
that vary in form and depth depending on the significance of
the operation; degrading the cue *intentionally* when nothing
new has happened so the cue retains salience for when it does.

---

## C8. Single-active-item over-constrains  ·  confidence: medium

**What noggin does.** Exactly one item can be active; the spine
is a single path from root to that item. No notion of background
monitoring, parallel focal goals, or "watching for X while doing
Y."

**What the literature says.** ACT-R's goal stack is a *model*,
not a literal claim that humans only have one active goal.
Salvucci & Taatgen's *The Multitasking Mind* (2010) explicitly
develops the cognitive-architecture account of parallel goal-
maintenance. Real work routinely involves "I'm focused on X
but watching for Y to complete in the background."

**Tension with current framework.** [P4](principles.md#p4-match-the-structure-of-how-people-already-represent-work)
took "exactly one active" as a feature aligning with the goal
stack. The literature is more permissive than that, and the
constraint excludes legitimate patterns (background monitoring,
quick-glance parallel tasks).

**What would resolve it.** Multiple active items, or a "watching"
state distinct from "active," or a "pinned" affordance. Probably
worth ergonomic prototyping before committing to a model.

---

## C9. Notes are unstructured  ·  confidence: low–medium

**What noggin does.** Notes are free-text. The resumption-note
template ("Where I am / What I believe / Ruled out / Decisions
in flight / Resume by") is offered but not enforced and not
modeled in the data structure.

**What the literature says.** Schön and Kolb consistently find
that *structured* reflection produces better learning than
free-form reflection. Structured-reflection prompts
(template-driven, sectioned, time-segmented) produce more durable
metacognitive benefits than open journaling.

**Tension with current framework.** [P5](principles.md#p5-preserve-history-closure-is-an-event-not-a-state-flip)
treats the notes log as sufficient for reflection. The structure
of the entries is part of what determines reflective value;
unstructured may be substantially weaker than the framework
implied.

**What would resolve it.** Optional note `kind` (decision /
observation / question / blocker / handoff / …), or first-class
support for the resumption template as a verb (`noggin handoff`).
Trade-off: increased structure raises capture cost (P3) — needs
careful design.

**Why this is medium-low rather than higher.** The cost of
structure (P3 friction) is real, and skilled users get good
reflection from unstructured notes. The literature is clear
that structure helps for novices and on average; less clear that
it helps everyone in every condition.

---

## C10. Depth and breadth are unbounded with no signal  ·  confidence: medium

**What noggin does.** The tree can be arbitrarily deep and
arbitrarily wide. No warning when depth exceeds working-memory
chunking limits, no compression aid, no "this branch has gotten
big" cue.

**What the literature says.** Cowan 2001's ~4 chunks; Miller's
7±2. A 6–10 deep spine asks the user to mentally hold more chunks
than working memory can manage. Display compression helps
slightly but the underlying load is in the model.

**Tension with current framework.** [open-questions.md Q4](open-questions.md#q4-is-tree-depth-a-hidden-cognitive-load-cost-we-should-bound)
treated this as speculative. Given the strength of the working-
memory evidence (P1's foundation), the speculation should be the
other way: the *absence* of a depth signal is the design choice
that needs justification.

**What would resolve it.** A visual cue at depth ≥ N
("you're 6 deep"), progressive disclosure of intermediate spine
levels (show top + active leaf, fold the middle on demand), or a
gentle suggestion to lift sub-trees out into siblings when a
branch gets too deep.

---

## How these items relate to the framework

These aren't add-on critiques; they belong inside the framework.
Specifically:

- **P5 (preserve history)** has been over-applied — used to
  justify perpetual visibility (C2) and assumed-as-sufficient
  for reflection without tooling (C5) or structure (C9).
- **P6 (memory aid, not a gate)** has been treated as absolute
  when the literature supports calibration (C3, C7).
- **P8 (keep human in loop)** is the most defensible principle
  on operational grounds *but* the current data model
  (unattributed notes) directly contradicts the audit-trail role
  it was supposed to play (C4).
- **P1 (externalize the spine)** is the foundation; its working-
  memory basis suggests stronger guardrails than the framework
  currently asserts (C10).
- **P2 (reactivation cues)** is real, but its dose-response is
  non-monotonic (C7) and its single-modality (event-based)
  implementation is incomplete (C1).

The principles still hold. The implementations that follow
from them are weaker than the previous design-rationale claimed.

## How to use this file

- **Before declaring a feature "out of scope" on framework
  grounds**, check this file. If the feature is on this list,
  the framework doesn't support the exclusion.
- **When updating the framework**, add to this file any new
  challenge that emerges; rotate items off (into changelog notes
  or into design-rationale) when they are addressed.
- **When citing a principle to justify a current design**, check
  whether the same principle generates a challenge here. If it
  does, name the trade-off explicitly rather than ignoring it.
