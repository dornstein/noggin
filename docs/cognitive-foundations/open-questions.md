# Open questions

Things we have taken a position on but where the underlying
evidence is contested, mixed, or evolving. Not failures —
disagreements worth keeping visible so the framework can evolve
when the evidence does.

Each entry: the question, our current stance, the tension, and what
would change our mind.

---

## Q1. Does the Zeigarnik effect actually motivate noggin's design?

**The classical claim.** Bluma Zeigarnik (1927) reported that
unfinished tasks are remembered better than completed ones — a
finding often cited to justify externalized task capture ("get it
out of your head so the brain stops nagging you about it").

**Our current stance.** We cite Zeigarnik with a hedge. The
distributed-cognition / cognitive-offloading argument for
externalization stands on its own (P1, P3) and doesn't require
Zeigarnik to be robust.

**The tension.** A 2025 meta-analysis (Ghibellini & Meier, *Humanities
and Social Sciences Communications*) of accumulated Zeigarnik
research found *no* reliable memory advantage for unfinished tasks,
though the related **Ovsiankina effect** (the tendency to *resume*
interrupted tasks when given the chance) replicates. So:
"interrupted tasks pull on us to be resumed" — yes; "interrupted
tasks are encoded more deeply" — maybe not.

**What would change our mind.** If a follow-up meta-analysis or
preregistered replication restored confidence in the memory
effect, we'd lean on it more in P5 (preserve history) and in the
PIM rationale. Either way, the Ovsiankina effect remains good
support for the "we surface paused items so the user can act on
their natural pull-to-resume" argument.

---

## Q2. Is cognitive offloading good for users, or are we accelerating cognitive debt?

**The classical claim.** Distributed cognition / external cognition
research (Hutchins 1995, Scaife & Rogers 1996, Risko & Gilbert
2016) treats offloading as a net win: humans + tools outperform
humans alone on complex tasks.

**The new worry.** The MIT "Your Brain on ChatGPT" study (Kosmyna
et al. 2025) and the Melumad & Yun PNAS Nexus study (2025) both
suggest that *heavy* offloading to LLMs produces measurable
shallow-processing effects (weaker brain engagement; lower
depth-of-learning; lower retention). Sparrow et al. 2011's "Google
effect" found the same pattern with web search before LLMs.

**Our current stance.** P8 (keep human in loop) is the response.
We deliberately make the human do the small acts of structuring
(picking the verb, writing the note, naming the item) rather than
letting the agent silently do everything. We also force the agent
to echo every change back into the chat so the user *sees* the
structure they are building. The hypothesis is that noggin's
offloading is the good kind (structure, scheduling, persistence)
while preserving the cognitive acts that build the model (naming,
deciding, reflecting).

**The tension.** This is a hypothesis, not a finding. We don't yet
have evidence that *noggin's specific design* protects against
cognitive debt. It could turn out that the human acts noggin asks
for are too lightweight to matter — that just clicking "push" is
not enough rehearsal.

**What would change our mind.** Evidence that users of noggin show
deskilling in task-decomposition or planning relative to users who
don't use it. Conversely, evidence that heavy noggin users retain
*more* of the work they did (because they can reflect on the trace)
would strengthen P8.

---

## Q3. Should noggin surface stale / long-paused items?

**The case for.** P2 says reactivation cues are the mechanism by
which paused goals come back. An open item pushed three weeks ago
is, definitionally, a goal that's still active in the user's
intent but has lost its activation. A gentle "you have an open item
that hasn't moved in a while" could reactivate it.

**The case against.** P6 says don't nag. The instant noggin starts
producing notifications, it has become an interruption source —
the very thing it exists to mitigate. The user's other channels
(calendar, manager, customer) already nag; noggin's neutrality is
part of its value.

**Our current stance.** Don't nag. The tree's persistent visibility
is itself a passive cue; that's enough.

**What would change our mind.** Field evidence (from our own usage,
or from analogous tools) that users routinely lose work to
"silently abandoned side-quests" in a way that a gentle surface-up
would prevent. The implementation would need to be a *display*
choice (e.g., highlight in the sidebar) rather than a
*notification* — never something that pulls attention out of band.

---

## Q4. Is tree depth a hidden cognitive-load cost we should bound?

**The case for bounding.** If P1 says the working-memory limit is
~4 chunks, a 12-deep active spine asks the user to mentally
represent more chunks than they have. At some depth the spine
itself stops being intelligible and the tool starts hurting.

**The case against bounding.** Real work goes deep. Arbitrary
limits break the tool exactly when the user needs it most. And in
practice the user usually only needs the *top* of the spine
("what am I in the middle of") plus the *active leaf* ("what am
I literally typing right now"); the middle is reactivation cues
when needed.

**Our current stance.** No hard limit. The display can fold deep
chains, but the data model is unbounded.

**What would change our mind.** Empirical evidence — even informal —
that real users get into 8+ deep spines and report losing track.
Anything from "the display compresses past N levels" to "we
suggest closing levels above N" could follow. Until then, this is
a speculative concern.

---

## Q5. Should we record agent rationale alongside verb invocations?

**The case for.** P8 says keep the human in the loop. The agent
chose `push` over `add` for a reason; making that reason visible
gives the user a moment to disagree and a record to look back at.
Without it, agent decisions are opaque structural changes the user
just absorbs.

**The case against.** P3 says capture must be cheap. Adding required
rationale to every verb call would balloon the trace and slow the
loop. P6 says don't nag — long agent monologues for every micro-
operation become noise.

**Our current stance.** The SKILL asks for a one-line acknowledgement
of every change (e.g., "Pushed `/1/2/3 — spike storage layer`.
Spine: …"). That's the rationale surface — implicit in the verb
choice and the named item.

**What would change our mind.** Cases where users misunderstood
what the agent did and missed a chance to correct it. The fix
could be richer per-verb summaries, or surfacing the agent's
chain-of-thought as an optional `note` on the item.

---

## Q6. Multi-noggin: convenience or cognitive cost?

**The case it's convenience.** P7 says user-owned, local-first.
Different projects in different repos with their own noggins
respect that. The user knows where their stuff is.

**The case it's a cost.** Splitting attention across N noggins is
exactly the multi-thread cognitive challenge noggin exists to
mitigate. If a side-quest in repo A is invisible from repo B,
the user might forget repo A's open thread entirely.

**Our current stance.** Multi-noggin is the right default; the
extension and MCP server both make the *current* noggin obvious
(status bar, `noggin where`, `noggin_providers`). But this is a
live question.

**What would change our mind.** A use case where a cross-noggin
"what's open everywhere" view becomes the dominant question. If
that emerges, a federated read view (without violating P6 / P7)
becomes worth designing.

---

## Q7. Does the AI-cognition literature replicate?

**The honest worry.** Most of the "AI harms cognition" papers we
cite in P8 and in [`research/ai-and-cognition.md`](research/ai-and-cognition.md)
are very recent (2024–2025), small-N, and in some cases not yet
peer-reviewed. The earlier "Google effect" literature has also
seen mixed replication.

**Our current stance.** P8 is a deliberately defensive design
choice. Even if the literature softens, the principle of
"don't let the agent be the only entity that knows what's
happening" is good practice on operational/oversight grounds
alone — agents make mistakes, humans need to catch them.

**What would change our mind.** If high-quality replications show
no cognitive-debt effect from LLM assistance, P8 could be relaxed
(less aggressive echo-back, more silent agent action). Conversely,
if effects strengthen, P8 might need a sharper claim — e.g., the
agent should explicitly *not* be the entity that names items
(only suggests names), or `show` output should be even more
prominent.

---

## How to add to this document

When making a product decision that:

- relies on a contested claim,
- contradicts a principle but seems right anyway,
- depends on evidence we don't yet have,

…add a `Q<n>` entry here with current stance and falsification
condition. Better to have an open question logged than a quiet
assumption.
