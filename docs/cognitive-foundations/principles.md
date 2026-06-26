# Design principles

Eight principles, each grounded in a body of cognitive-science
research, that guide noggin's design. They are the explicit version
of judgements we've been making implicitly. New product decisions
should be checkable against this list.

The principles are listed roughly in the order they bind: violating
P1 makes the rest moot, violating P8 produces something that "works"
but quietly harms the user. Numbers are stable; if a principle is
retired or split, leave the old number deprecated rather than
renumbering.

---

## P1. Externalize the spine, don't recall it

Human working memory holds on the order of four chunks at once
(Cowan 2001, refining Miller 1956). Complex in-flight software work
— especially with an AI agent opening logical branches faster than
the human can close them — routinely exceeds that capacity, and
sustained excess produces **cognitive overload**: errors, dropped
threads, and degraded decisions (Sweller's cognitive load theory,
Sweller 1988; Sweller, van Merriënboer & Paas 1998).

The remedy is to move the *structure* of the work — current focus,
parent goals, paused side-quests, recent decisions — out of the head
and into a stable external artifact that the human can **look at**
instead of **remember**. This is the core finding of distributed
cognition and external cognition research (Hutchins 1995; Scaife &
Rogers 1996; Kirsh & Maglio 1994).

**Implies:**
- A persistent, viewable representation of the user's current spine,
  not a transient prompt or chat.
- Capture verbs (`push`, `add`, `note`) as the primary actions,
  cheaper than thinking-it-through-in-your-head would be.
- Output of every operation echoed back so the externalization is
  visible, not hidden in tool calls.

See [`research/working-memory.md`](research/working-memory.md) and
[`research/external-cognition.md`](research/external-cognition.md).

---

## P2. Reactivation cues, not recall

After an interruption, returning to a suspended task is not a
retrieval problem — it's a **goal-activation** problem. The memory-
for-goals theory (Altmann & Trafton 2002) holds that goal activation
decays over the interval; what reactivates it is *environmental
cues* that were associated with the goal when it was suspended. The
broader prospective-memory literature confirms this: **event-based**
cues (something in the world prompts the intention) outperform
**time-based** cues (you must remember on your own) almost
universally (Einstein & McDaniel 1990, 2005; Sellen et al. 1997).
Field studies of knowledge workers show interruptions are pervasive
and recovery is costly (Mark, Gudith & Klocke 2008; Czerwinski,
Horvitz & Wilhite 2004).

The implication for noggin: on return, the user should not have to
remember what they were doing. The tool should *show them*, in a way
that re-activates the suspended mental model.

**Implies:**
- The active item, the path to it, and the most recent activity must
  be the first thing the user sees on return.
- Resumption notes captured **at the time of switch** (when context
  is hot) become the reactivation cue **at the time of return** (when
  context is cold).
- The tree itself is the cue surface: each child item is a
  pre-positioned event-based prompt for the intention it names.

See [`research/interruption.md`](research/interruption.md) and
[`research/prospective-memory.md`](research/prospective-memory.md).

---

## P3. Capture must be cheaper than carrying

People externalize only when the cost of capture is lower than the
cognitive cost of holding the thought in their head — a basic
**cognitive-offloading** prediction (Risko & Gilbert 2016). If
`add`-ing a thought takes a paragraph of typing, a context-menu
hunt, or a decision about where it belongs, users will silently
choose to "just remember it" — and then forget it. Personal-
information-management research finds the same pattern in note-
taking and filing: people pile rather than file when filing is
expensive (Bergman & Whittaker 2016; Whittaker & Sidner 1996).

**Implies:**
- Single-verb capture: `push <title>`, `add <title>`, `note <text>`
  — no required placement decision, no metadata required.
- Sensible defaults: `add` lands under the active item; `note`
  attaches to the active item; placement flags (`--before`,
  `--after`, `--into`) are optional refinements, not requirements.
- The SKILL's "watch for switch phrases" rule automates capture
  before the user has to decide.
- Relative-path shorthand (`.`, `..`, `-`, `+`, bare positions) so
  the user can refer to "this" and "that one" the way they think.

See [`research/external-cognition.md`](research/external-cognition.md)
and [`research/personal-information-management.md`](research/personal-information-management.md).

---

## P4. Match the structure of how people already represent work

Decades of cognitive-architecture research (Card, Moran & Newell
1983 — GOMS; Anderson 1983 onwards — ACT-R's goal stack) converge
on the same picture: humans plan and execute complex tasks as
**hierarchies of nested goals with one focal sub-goal at a time**.
You push a sub-goal, do it, pop back. The mental data structure is a
stack of activations, not a flat list and not a graph.

If the tool's primitives mirror that mental structure, the
**extraneous cognitive load** of using the tool (Chandler & Sweller
1991) drops toward zero — the user doesn't have to translate between
how they think about the work and how they tell the tool about it.
If the primitives mismatch (a flat todo list, an undifferentiated
graph, a Kanban board), every interaction adds translation cost on
top of the work itself.

**Implies:**
- A tree, not a list and not a graph.
- Exactly one **active** item; the path from a root to that item is
  the user's current spine — the analogue of the cognitive goal
  stack.
- `push` (descend a level, become active) and `add` (queue a sibling
  or child without descending) as the two basic structural verbs:
  one moves the focal point, the other captures intent without
  moving focus. They are the verbs the user is already thinking in.
- `pop` / `done` finishes the active item and surfaces back to its
  parent — the mental "I'm done with that, where was I" move.

See [`research/goal-hierarchies.md`](research/goal-hierarchies.md).

---

## P5. Preserve history; closure is an event, not a state-flip

Reflection on past work is itself a cognitive activity that supports
learning, debugging, and decision review — Schön's **reflection-on-
action** (Schön 1983); Flavell's broader picture of **metacognition**
as monitoring one's own cognitive processes (Flavell 1979). For
reflection to work, the past must be *visible*: not a binary
"done/not done" but the actual sequence of what happened, when, and
why.

This is also a guard against AI-era failure modes. When the agent
makes a structural change ("I closed that out for you"), the user
needs to be able to look back and verify *what was closed and why* —
the log is part of how the human stays in the loop against an agent
that has too much autonomy.

**Implies:**
- Closure is recorded as an append-only `note` with a timestamp,
  not as a `closedAt` field. The notes log *is* the history.
- Reopening (`edit --open`) does not rewrite the historical close
  note — it adds a new event. The past stays true.
- Done items stay in the tree under their parent so finished work is
  visible to the eye, not hidden by the tool.
- Edits, moves, and renames are user-visible operations, not silent
  background rewrites.

See [`research/metacognition.md`](research/metacognition.md).

---

## P6. The tool is a memory aid, not a gate

The cognitive value of an external aid evaporates the moment the
aid itself becomes a source of interruption or load. Gloria Mark's
work on workplace interruptions (Mark, Gudith & Klocke 2008; Mark
2023) and the broader attention-fragmentation literature show that
*any* tool that blocks, nags, or demands attention out of band
produces measurable harm to the very focus it was meant to protect.

Cognitive-load theory says the same thing in different vocabulary:
the tool itself produces **extraneous cognitive load** (Chandler &
Sweller 1991), and that load eats into the working-memory budget
available for the actual work.

**Implies:**
- No blocking. If a verb errors, surface the error and move on —
  the SKILL tells the agent this for the CLI/MCP case; the same
  rule applies in every host.
- No background sync, no nags, no "you have unprocessed items" pop-
  ups. The noggin is the user's; never modify it without an
  explicit user-visible action.
- No required fields, no required structure. Items have a title
  and a `done` flag; everything else is optional.
- Async, non-blocking verbs (every verb returns a `Promise`; the
  engine serializes concurrent calls per-noggin internally so the
  document never races against itself, and the user-visible
  interaction is never blocked on persistence).

---

## P7. The user's externalized cognition must stay reachable

Externalized cognition is only useful if the externalization
*stays accessible* over time and across the user's tools. Bergman
& Whittaker's "Science of Managing Our Digital Stuff" (2016) traces
the long-term failure mode of walled-garden personal-information
tools: when data lives only inside one app, finding it again becomes
its own cognitive burden, the user loses trust, and eventually the
data is abandoned.

There is also a deeper distributed-cognition argument: the user's
file system, editor, version control, and grep are already part of
their extended mind (Clark & Chalmers 1998). A tool that opts out of
that ecosystem opts out of the user's existing cognitive
infrastructure.

The invariant is *reachability and sovereignty*, not any one
storage technology. The current default (a YAML file the user can
`cat`, `grep`, version-control) is one way to satisfy it; an
in-memory provider for tests, a future SQLite provider, or any
provider whose backing data the user can introspect and export
would all satisfy it. A proprietary cloud-only provider with no
export would not.

**Implies:**
- The data shape (`NogginDocument`) is documented, versioned
  (`schemaVersion`), and has a public JSON schema. The shape is
  the contract; the format that encodes it is a detail of the
  provider.
- The engine is provider-agnostic. The shipping default is
  a local YAML file (`file://` provider), but a memory provider
  (`memory://`) already exists in the engine and the
  `providers.register()` extension point is part of the public
  API. Persistence is a plug-in concern.
- No surface ever owns the user's data: not a server, not an
  account, not a vendor format. Every provider that ships must
  preserve the user's ability to reach the underlying state
  through tools they already have (read it out, copy it
  elsewhere, swap providers).
- Multi-noggin: one per project, one per home directory — the
  user decides where their externalized cognition lives and how
  many they keep.
- For the default file provider specifically: atomic write, no
  proprietary serialization tricks, human-readable YAML. These
  are *consequences* of the principle in that provider, not the
  principle itself.

See [`research/personal-information-management.md`](research/personal-information-management.md).

---

## P8. Keep the human in the loop against cognitive debt

This is the newest principle and the one most specific to working
with LLMs. Recent evidence suggests that heavy reliance on AI to
do the structuring and writing produces measurable cognitive costs:
the MIT "cognitive debt" study (Kosmyna et al. 2025) found weaker
brain engagement and lower retention when essays were drafted with
an LLM versus with web search or unaided; the Melumad & Yun PNAS
Nexus study (2025) found shallower depth-of-learning under LLM use
than under traditional web search. These join an older literature
on the **Google effect** / digital amnesia (Sparrow, Liu & Wegner
2011) showing that people deeply encode less when they expect
information to be externally accessible.

For a tool whose explicit purpose is *cognitive offloading*, this is
a real tension. The way out is to ensure the human still does the
small acts of structuring and naming that build and maintain the
mental model — choosing the verb, writing the note, naming the item,
picking the placement. Those small acts are exactly the **desirable
difficulty** (Bjork & Bjork 1992) that protects against atrophy.

**Implies:**
- The agent doesn't silently `add` things for the user; it either
  asks ("want me to push that as a side-quest?") or echoes the
  action prominently so the user notices.
- Every verb's outcome is surfaced to the user. In agent-driven
  hosts (CLI, MCP, LM tools) the SKILL's "echo output" and
  "always print `show` output" rules carry this; in UI hosts
  (the VS Code sidebar, the desktop tree) the always-visible tree
  carries it. The user sees the structure they are building.
- Titles and notes are written by the human (or proposed by the
  agent and approved by the human) — they are not auto-generated
  from chat transcripts in the background.
- The tree is small enough to fit on a screen. If it grew without
  bound, the user would stop reading it and the tool would have
  optimized them into not-thinking. (This is also why `done` items
  stay visible — they're part of what the user is reading.)

See [`research/ai-and-cognition.md`](research/ai-and-cognition.md).

---

## How the principles relate

| Concern | Primary principles |
|---|---|
| Why externalize at all | P1, P7 |
| Why a tree of items | P4 |
| Why one active item / spine | P2, P4 |
| Why append-only notes | P5, P8 |
| Why closure-as-note (no `closedAt`) | P5 |
| Why low-friction verbs and defaults | P3 |
| Why non-blocking, non-nagging behaviour | P6 |
| Why a documented data shape with pluggable providers | P7 |
| Why echo-back and "print `show` in chat" | P2, P8 |
| Why resumption notes | P2 |

If a future feature lands on a row that doesn't yet exist, write the
row. If it can't be placed against *any* principle, that's a signal —
either retrofit a principle or rethink the feature.
