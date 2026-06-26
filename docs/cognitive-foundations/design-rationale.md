# Design rationale: noggin decisions mapped to principles

For each significant decision noggin has made, this document
records: **what** the decision is, **which principle(s)** it serves,
and the **research basis** for those principles. If a decision is
listed here, it has a justification. If a decision isn't listed
here, either retrofit a reason or reconsider it.

The principle references are to [principles.md](principles.md);
the research references go through to
[`research/`](research/).

## Core data model

### Items form a tree

| | |
|---|---|
| **Principles** | P4 (match goal hierarchies) |
| **Research** | Card, Moran & Newell 1983 (GOMS); Anderson 1983 onwards (ACT-R's goal stack); Newell 1990 (Unified Theories of Cognition) |
| **Why** | A tree is the structure humans already use to represent nested in-flight work. A flat list collapses parent/child relationships the user is mentally tracking; a graph adds expressive power that doesn't match the mental model and pays for itself in extraneous load. |
| **What we deliberately did NOT do** | A flat todo list (too lossy); a tag-based / graph model (mismatched and high-load); a project-management hierarchy with rigid types (epic / story / task) (over-specified for working memory). |

See [`research/goal-hierarchies.md`](research/goal-hierarchies.md).

### Exactly one active item; spine from root to active

| | |
|---|---|
| **Principles** | P2 (reactivation cues), P4 (goal stack) |
| **Research** | Altmann & Trafton 2002 (memory for goals); ACT-R goal stack; Monsell 2003 (task switching). |
| **Why** | The current goal stack has a single tip. Making "active" a first-class concept mirrors that, and gives the user a single canonical answer to "where am I?" — which on return is the reactivation cue that brings the suspended goal-set back into working memory. |

### `push` vs `add` as distinct verbs

| | |
|---|---|
| **Principles** | P3 (capture cheaper than carrying), P4 (goal stack) |
| **Research** | Goal-stack semantics (ACT-R, GOMS); Einstein & McDaniel 1990, 2005 on the value of pre-positioned cues. |
| **Why** | These are the two distinct moves users make: "I'm pausing this to chase X" (descend a level, become active — `push`) and "while I'm here, don't let me forget Y" (capture without descending — `add`). They are different mental operations and need different verbs; collapsing them would force a placement decision at capture time that the user hasn't made yet. |
| **Default behaviour** | Both default to operating on / under the active item; placement flags (`--before`, `--after`, `--into`) are optional refinements. This is P3 in action: zero-arg paths are the common case. |

### Notes are append-only, timestamped

| | |
|---|---|
| **Principles** | P5 (preserve history), P8 (keep human in the loop) |
| **Research** | Schön 1983 (reflective practitioner); Flavell 1979 (metacognition); Zeigarnik 1927 and Ovsiankina 1928 — though see [open questions](open-questions.md) on Zeigarnik's mixed replication. |
| **Why** | A note is the trace of what the user (or agent) was thinking at a point in time. Editing or deleting earlier notes would destroy the reflection-on-action artifact and break the ability to look back. The cost of an immutable log (a slightly longer item) is much smaller than the cost of an unreliable one. |

### Closure recorded as a `closed` note, not a `closedAt` field

| | |
|---|---|
| **Principles** | P5 (preserve history), P8 (keep human in the loop) |
| **Research** | Schön 1983; Flavell 1979; general event-sourcing argument. |
| **Why** | Closure is an event with a timestamp, an actor, and a place in the chronology — not a binary state-flip. Storing it as a note keeps it in the same log as everything else the user did on that item, so reflection-on-action sees a coherent sequence ("created → tried X → decided Y → closed") instead of a state-stamp floating outside the narrative. |
| **And specifically** | `edit --open` *does not* rewrite or delete the close note. The historical close stays in the log; reopening adds new events on top of it. This is the rule that converts notes from "current state log" into "audit trail." |
| **History** | See [`docs/plans/2026-06-api-extraction.md`](../plans/2026-06-api-extraction.md) — the `closedAt` field was deliberately removed in that refactor. The [project copilot-instructions](../../.github/copilot-instructions.md) calls this out: "Don't introduce a `closedAt` field or anything similar." |

### `done` items stay visible under their parent

| | |
|---|---|
| **Principles** | P5 (preserve history), P8 (cognitive debt) |
| **Research** | Schön 1983; PIM literature on finding-vs-recall (Bergman & Whittaker 2016). |
| **Why** | Done work is part of the context. Hiding it forces the user to recall what was finished; leaving it in view turns it into a passive reactivation cue ("oh right, I already did that") and supports metacognitive review ("how did this branch actually go?"). The cost is visual density, which is bounded as long as we don't accumulate forever — and `delete` exists for the cleanup case. |

### Opaque `key` as the stable item identity

| | |
|---|---|
| **Principles** | Operational hygiene (no direct principle), serves P2 indirectly |
| **Why** | Paths (`/1/2/3`) are display coordinates that shift as items are added, moved, or closed; keys are stable. Storing a path long-term — in a tool, an agent message, or a future feature — would cause silent breakage. Using keys internally keeps the externalized model trustworthy over time (which is what P2 needs the model to be). |
| **What this enables** | Resumption notes can reference items reliably; the extension can hold a selection across user edits; the file watcher can survive reorders. |

## Path syntax and capture friction

### Path shorthand: `.`, `..`, `-`, `+`, `-/X`, `+/X`, bare positions

| | |
|---|---|
| **Principles** | P3 (capture cheaper than carrying) |
| **Research** | Cognitive-load theory (extraneous load — Chandler & Sweller 1991); Kirsh & Maglio 1994 on epistemic actions. |
| **Why** | The user is already thinking in deictic terms ("this", "the previous one", "under here"). Forcing them to type full absolute paths would add translation cost between thought and command, raising extraneous load on every interaction. The shorthand collapses that translation to zero for the common case. |
| **Constraint** | Output (`show`, JSON `activePath`, error messages) is always in canonical absolute form. Input is forgiving; output is unambiguous. |

### Verbs default to operating on the active item

| | |
|---|---|
| **Principles** | P3 (capture cheaper than carrying) |
| **Why** | `done` with no argument closes the active item. `note <text>` attaches to the active item. `edit --done` operates on the active item. Every required-argument removed is friction removed. |

### "Watch for switch phrases" in the SKILL

| | |
|---|---|
| **Principles** | P3 (capture cheaper than carrying), P2 (reactivation cues) |
| **Why** | The lowest-friction capture is the one the user doesn't have to initiate. By giving the agent a list of utterance patterns ("pause this", "where was I", "while we're here…") and a corresponding verb to invoke, the *agent* pays the capture cost while the user keeps their conversational momentum. |

### Resumption-note template (the structured "where I am / what I believe / ruled out / decisions in flight / resume by" shape)

| | |
|---|---|
| **Principles** | P2 (reactivation cues), P5 (preserve history) |
| **Research** | Altmann & Trafton 2002 (the cue at suspension is what reactivates at resumption); event-based prospective memory (Einstein & McDaniel 2005); Schön 1983 on reflection-in-action. |
| **Why** | A resumption note captured at the moment of context-switch is the most valuable kind of cue: the user's mental model is hot, so they can write down things that will be expensive to reconstruct (the rejected approaches, the in-flight question). The template is *offered, not imposed* (P3) — the user can always just write a free-form note. |

## Behaviour at runtime

### CLI is non-blocking; errors are surfaced and skipped

| | |
|---|---|
| **Principles** | P6 (memory aid, not a gate) |
| **Research** | Mark, Gudith & Klocke 2008 (cost of workplace interruption); attention-fragmentation literature. |
| **Why** | The instant the tool blocks the user's primary work to deal with the tool, it produces the very interruption it was supposed to mitigate. The SKILL is explicit: *"If the CLI errors, surface the error, fall back to plain conversation, and move on. Noggin is a memory aid, not a gate."* |

### Async verbs, internal serialization per Noggin

| | |
|---|---|
| **Principles** | P6 (memory aid, not a gate) |
| **Why** | The user's interaction is never blocked on file I/O; concurrent verbs within the same noggin queue cleanly so the document never races against itself. The user experience is that operations "just complete" while the conversation continues. |

### "Always echo CLI output in chat"; "always print `show` output by default"

| | |
|---|---|
| **Principles** | P2 (reactivation cues), P8 (keep human in loop) |
| **Research** | Sparrow, Liu & Wegner 2011 (Google effect: people encode less of what they expect to access externally); Kosmyna et al. 2025 (cognitive debt with AI assistants); Risko & Gilbert 2016 (offloading). |
| **Why** | If the tool's output is hidden behind a collapsed tool-call section, the user doesn't *see* the externalized state — they just trust that something happened. They stop encoding the structure, start forgetting it, and the agent becomes the only entity that knows what's on the noggin. P8 says: keep the user looking at the tree, every turn. |

### "The CLI is the only sanctioned interface"

| | |
|---|---|
| **Principles** | P6 (one trustworthy surface), P7 (user-owned plain text) |
| **Why** | Multiple write paths produce multiple race conditions and multiple inconsistencies. A single sanctioned surface keeps the externalized state coherent (so the user can trust it — see P2 and P8). Reads via the file are fine (the file *is* the truth), but writes go through one place. |

## Storage and ownership

### Single YAML file, atomic write, local disk

| | |
|---|---|
| **Principles** | P7 (plain text, local-first, user-owned) |
| **Research** | Bergman & Whittaker 2016 (PIM failure mode of walled-garden silos); Clark & Chalmers 1998 (extended mind: the user's filesystem is part of their cognition). |
| **Why** | A plain-text file in a known location is accessible by every tool the user already uses (editor, grep, git, backup). It survives the death of any one client (extension, CLI, MCP server, Electron app). Atomic write prevents corruption — without it, the trust required for P2 evaporates the first time the user loses a noggin to a crash. |

### Multiple noggins, location-required MCP

| | |
|---|---|
| **Principles** | P7 (user-owned) |
| **Why** | Different contexts (this project, that project, home) deserve different noggins. Forcing a single global one would either pollute every context with everything or push the user to a giant graph that exceeds the working-memory budget (P1) the tool exists to relieve. Location-required MCP keeps the choice explicit — the agent always knows which noggin it's writing to. |

### `SCHEMA_VERSION` and `RESPONSE_ENVELOPE_VERSION` versioned independently

| | |
|---|---|
| **Principles** | P7 (the data should outlive any one client) |
| **Why** | The on-disk shape and the wire envelope evolve at different rates. Independent versioning keeps the user's data forward-compatible even when the API around it changes. |

## Surfaces

### VS Code sidebar tree, status-bar item for the active item

| | |
|---|---|
| **Principles** | P2 (reactivation cues) |
| **Research** | Event-based prospective memory (Einstein & McDaniel 2005): a visible cue in the environment is the most reliable retrieval trigger. |
| **Why** | The sidebar tree turns the externalized spine into an *always-on environmental cue*. Glancing at the editor reactivates the goal without the user having to remember to look. The status bar item does the same for the single most important fact (what's active right now). |

### LM tools in VS Code; MCP tools in Copilot CLI / Claude / Codex

| | |
|---|---|
| **Principles** | P3 (capture cheaper than carrying), P6 (non-blocking) |
| **Why** | In-process LM tools and MCP both let the agent invoke verbs with no spawn cost, returning structured JSON. The agent can capture state mid-conversation without breaking flow — which is exactly when the user is most likely to drop a thought. |

### Bare CLI always available, in any terminal

| | |
|---|---|
| **Principles** | P7 (user-owned) |
| **Why** | Some contexts (a remote shell, a different host's agent, no extension installed) need a fallback. The CLI is the smallest viable surface; everything else builds on top of it. |

## Agent protocol

### "Default to `push` for active side-quests, `add` for everything that can wait"

| | |
|---|---|
| **Principles** | P3 (low cost of capture so users actually do it), P4 (verbs match the mental operation) |
| **Why** | When the agent has a default, the user gets capture-by-default. When the agent has no default, the user gets ambiguity and friction. The defaults match the mental operation: a side-quest *is* a push, a stray idea *is* an add. |

### "Acknowledge the change in one line; echo output"

| | |
|---|---|
| **Principles** | P2 (cues), P8 (keep human in loop) |
| **Why** | A silent capture is a future surprise. A loud one is a reactivation cue and a moment of human review. |

### "Don't background-sync; file is the user's"

| | |
|---|---|
| **Principles** | P6 (no surprise modifications), P7 (user-owned) |
| **Why** | Background modification breaks the user's mental model of the file ("I know what's in there because I put it there"). Every write must correspond to a user-visible action. |

### "If the CLI errors, surface the error, fall back to plain conversation, and move on"

| | |
|---|---|
| **Principles** | P6 (memory aid, not a gate) |
| **Why** | Literal statement of P6. |

---

## Decisions still without explicit principles (audit gaps)

These are decisions noggin has made that don't yet cleanly tie to a
principle. They may indicate a missing principle, a justified
operational concern, or a place to reconsider.

- **Tree depth is unbounded**. Convenient operationally; arguably
  in tension with P1 (a 12-deep spine probably exceeds the
  working-memory budget for "where am I in the stack"). Worth a
  future experiment: is there a depth at which users start losing
  track of their own spine?
- **No explicit "stale" detection for old open items**. A side-
  quest pushed three weeks ago is silently still in the tree.
  This is consistent with P6 (don't nag) but might miss an
  opportunity to gently surface long-paused items as P2-style
  reactivation cues. See [open-questions.md](open-questions.md).
- **The agent picks verbs; the user often doesn't see *why***.
  The SKILL is detailed but the user can't easily ask "why did
  you push instead of add here?". For P8 (human in loop), a
  brief rationale could matter. Open question.
